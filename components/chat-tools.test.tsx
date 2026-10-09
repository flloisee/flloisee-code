// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { IDBFactory } from "fake-indexeddb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/chat/route";
import { POST as ENDPOINTS_POST } from "@/app/api/endpoints/route";
import { Workspace } from "@/components/workspace";
import { isToolCall } from "@/lib/chat/tool-part";
import { listConversations, readConversation } from "@/lib/conversations/store";
import { backendFor } from "@/lib/conversations/use-conversations";
import { findEndpoint } from "@/lib/endpoints/registry";
import { declareRoot } from "@/lib/roots/reading-root";
import { temporaryProject, type TemporaryProject } from "@/lib/testing/temporary-project";
import { MAX_READ_LINES } from "@/lib/tools/file-tools";

/**
 * The save debounce, with a real read in the middle of a Turn.
 *
 * A Turn that reads files is not one that arrives in a piece. The Model writes
 * some prose, names a file, and then waits — and the save timer the chat arms is
 * 300ms, so it fires in that wait, with a Tool Call on screen and no Tool Result
 * under it. Everything about saving is worth re-asserting once that is true: the
 * Turn is saved once rather than on every chunk, and what lands in the database
 * during the wait is not a record the next Turn cannot use.
 *
 * The whole path is driven the way a reader drives it, against a real HTTP
 * Endpoint speaking the streaming format and a real file on disk, with only the
 * browser → Route Handler hop rewired. A delay is put into the stub's second
 * answer, because that gap is the one that matters: it is where a real Model
 * loads, and where the Model that called a Tool waits for the result to come
 * back before it writes another word.
 */

// Generous for the file rather than per test: every wait below is awaited on what
// it is actually waiting for, so a failure surfaces as a failed assertion rather
// than as a timeout landing here first.
vi.setConfig({ testTimeout: 20_000 });

/** How long the stub holds its second answer, past the chat's 300ms debounce. */
const GAP_MS = 500;

/** Words the stub streams after the read came back. */
const REPLY = "It is the route that answers, and it refuses anything else.".split(" ");

const DELTA_INTERVAL_MS = 40;

let stubURL = "";
/** Every request the Endpoint received, in order. */
let requests: string[] = [];
/** Every chunk written to the interface, which is what a save could hang off. */
let deltas = 0;
let sockets = new Set<import("node:net").Socket>();
const REAL_FETCH = globalThis.fetch;

function chunk(res: ServerResponse, delta: object, finishReason: string | null) {
  deltas += 1;
  res.write(
    `data: ${JSON.stringify({
      id: "1",
      object: "chat.completion.chunk",
      created: 0,
      model: "stub",
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`,
  );
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (piece) => (body += piece));
  req.on("end", () => {
    requests.push(body);

    res.writeHead(200, { "content-type": "text/event-stream" });

    // First: the Model names the file. Second: the answer it writes having read
    // it — held first, so the interface is left sitting on a Tool Call with
    // nothing under it for longer than the save takes to fire.
    if (requests.length === 1) {
      chunk(
        res,
        {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "read_file", arguments: JSON.stringify({ path: "src/big.log" }) },
            },
          ],
        },
        "tool_calls",
      );
    } else {
      const answer = () => {
        REPLY.forEach((word, index) =>
          setTimeout(
            () => chunk(res, { content: index === 0 ? word : ` ${word}` }, null),
            index * DELTA_INTERVAL_MS,
          ),
        );
        setTimeout(() => {
          chunk(res, {}, "stop");
          res.write("data: [DONE]\n\n");
          res.end();
        }, REPLY.length * DELTA_INTERVAL_MS);
      };

      if (res.writableEnded) return;
      setTimeout(answer, GAP_MS);
      return;
    }

    res.write("data: [DONE]\n\n");
    res.end();
  });
});

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        stubURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
);

/**
 * A project the app runs in, with one file large enough to be worth reading.
 *
 * `temporaryProject` puts the working directory somewhere of its own, which is
 * what lets the Root be read from a file without any test declaring the
 * developer's own folder as readable.
 */
const project: TemporaryProject = await temporaryProject("chat-tools-debounce-");

/**
 * A file long enough that what comes back is unmistakably large.
 *
 * Inside the Tools' byte ceiling rather than filling it: a file over it is
 * refused with a sentence and read never runs, which would leave this suite
 * testing a refusal. The largest read the Tools will answer with is pinned in
 * `store.test.ts`, where nothing has to stream it first.
 */
const WIDTH = 400;
const LINES = Array.from(
  { length: MAX_READ_LINES },
  (_, index) => `${index + 1}: ${"a".repeat(WIDTH)}`,
);
const BIG = LINES.join("\n");

/**
 * One line of the file, which nothing in a Turn carries until the read answers.
 *
 * The path is no use as a marker: the Tool Call names it before the read has
 * happened, so a Turn holding nothing of the file would still carry it.
 */
const A_LINE_OF_THE_FILE = LINES[MAX_READ_LINES - 1];

let factory: IDBFactory;
/** The Turns handed to the store, in the order they were written. */
let writes: UIMessage[][] = [];

beforeEach(async () => {
  await project.begin();
  await mkdir(path.join(project.dir, "project", "src"), { recursive: true });
  await writeFile(path.join(project.dir, "project", "src", "big.log"), BIG, "utf8");
  await declareRoot({ dir: project.dir, root: path.join(project.dir, "project") });

  factory = new IDBFactory();
  writes = [];
  requests = [];
  deltas = 0;
  sockets = new Set();
  window.localStorage.clear();
  findEndpoint("ollama")!.baseURL = stubURL;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/chat")) {
      return POST(new Request(new URL(url, "http://localhost").href, init));
    }
    if (url.endsWith("/api/endpoints")) return ENDPOINTS_POST();
    return REAL_FETCH(input, init);
  }) as typeof fetch;
});

afterEach(async () => {
  cleanup();
  globalThis.fetch = REAL_FETCH;
  findEndpoint("ollama")!.baseURL = "http://localhost:11434/v1";
  await project.end();
});

/**
 * The page as it ships, with the store pointed at this test's database and every
 * write recorded.
 *
 * The recording wraps the real backend rather than replacing it, so what is
 * counted is what the store was actually given.
 */
function renderApp() {
  const real = backendFor(factory);
  return render(
    <Workspace
      endpointId="ollama"
      backend={{
        ...real,
        write: (conversation) => {
          writes.push(conversation.messages);
          return real.write(conversation);
        },
      }}
    />,
  );
}

function send(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/send a message/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

/**
 * Whether the file's contents are anywhere in a Turn.
 *
 * Not the path: the Tool Call names the path before the read has happened, so a
 * Turn holding nothing of the file would still carry it, and a test that passed
 * on the path would be passing on the very thing that had not arrived yet.
 */
function holdsTheFile(messages: UIMessage[]): boolean {
  return JSON.stringify(messages).includes(A_LINE_OF_THE_FILE);
}

/** The read in a saved Turn, if it carries one that came back. */
function readIn(messages: UIMessage[]) {
  const parts = messages.flatMap((message) => message.parts);
  const read = parts.find((part) => isToolCall(part) && part.state === "output-available");
  return read && isToolCall(read) ? read : null;
}

/** How many lines of the file the read answered with. */
function linesIn(read: ReturnType<typeof readIn>): number {
  const output = read && isToolCall(read) ? (read.output as { lines?: unknown }) : null;
  return Array.isArray(output?.lines) ? output.lines.length : 0;
}

describe("a Turn that reads a file", () => {
  it("is saved more than once as it arrives, and once it has settled", async () => {
    renderApp();

    send("what is in src/big.log?");

    // Worth seeing rather than assuming: the whole reason a Turn that is still
    // arriving can reach the store holding a call with no result under it is
    // that the debounce fires while the Turn is still arriving. A save that only
    // ever landed at the end would make the problem hypothetical.
    await waitFor(() => expect(writes.length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
    await waitFor(() => expect(writes.filter(holdsTheFile)).not.toHaveLength(0), { timeout: 8000 });
  });

  it("is not saved once per chunk, however many chunks the Response took", async () => {
    renderApp();

    send("what is in src/big.log?");
    await waitFor(() => expect(screen.getByText(/It is the route that answers/)).toBeTruthy(), {
      timeout: 8000,
    });
    // Held past the debounce rather than asserted on straight away, so a save
    // that was going to come late is counted rather than missed.
    await new Promise((resolve) => setTimeout(resolve, 800));

    // The debounce is why the file's contents are not re-written for every word
    // of the Response: each of these chunks re-arms the timer, so it fires when
    // the Turn stops changing rather than when it changes. Counted against the
    // chunks rather than a fixed number, because the number is what could drift.
    expect(writes.length).toBeLessThan(deltas);
  });

  it("writes the file's contents on the settled Turn rather than on each tick", async () => {
    renderApp();

    send("what is in src/big.log?");
    await waitFor(() => expect(writes.filter(holdsTheFile)).not.toHaveLength(0), { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Bounded, and checked against the chunks rather than a number: a save per
    // chunk would put the megabyte into the reader's database once per word of
    // the answer, which is what "re-written on each tick" means for a store this
    // app asks a browser to keep.
    const carrying = writes.filter(holdsTheFile).length;
    expect(carrying).toBeLessThan(deltas);
    expect(carrying).toBeGreaterThan(0);
  });

  it("ends up holding the read and the file that was read", async () => {
    renderApp();

    send("what is in src/big.log?");
    await waitFor(() => expect(screen.getByText(/It is the route that answers/)).toBeTruthy(), {
      timeout: 8000,
    });

    // Read back out of the database rather than off the array of writes, because
    // what has to survive is the record, not the call that made it.
    const [id] = (await listConversations(factory)).map((c) => c.id);
    const stored = await readConversation(factory, id);

    // One call, one copy of what it returned — the whole thing, not the part the
    // transcript draws. A Turn that read four files would carry four calls here,
    // each with its own contents, rather than one file four times over.
    expect(linesIn(readIn(stored!.messages))).toBe(MAX_READ_LINES);
    expect(stored!.messages.flatMap((message) => message.parts).filter(isToolCall)).toHaveLength(1);
  });

  it("saves under one name, because the name is derived from the first message", async () => {
    renderApp();

    send("what is in src/big.log?");
    await waitFor(() => expect(screen.getByText(/It is the route that answers/)).toBeTruthy(), {
      timeout: 8000,
    });

    const names = [...document.querySelectorAll("[data-conversation]")].map(
      (row) => row.querySelector("button")?.textContent ?? "",
    );
    await waitFor(() => expect(names).toHaveLength(1));
    expect(names[0]).toBe("what is in src/big.log?");
  });
});