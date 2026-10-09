// @vitest-environment jsdom

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as chatPOST } from "@/app/api/chat/route";
import { POST as rootsPOST } from "@/app/api/roots/route";
import { Chat } from "@/components/chat";
import { findEndpoint } from "@/lib/endpoints/registry";
import { setEnvVar } from "@/lib/testing/temporary-project";

/**
 * A read outside the Root, from the question to whatever the reader answers.
 *
 *   Chat → useChat → /api/chat → the three Tools → the approval policy → a stub
 *   Endpoint that asks to read a file the Root does not cover → back up again,
 *   with the reader's answer in between
 *
 * Nothing in the model layer is stubbed but the Endpoint itself, which is a real
 * `node:http` server speaking the OpenAI-compatible stream. Everything asserted
 * below — which question appears, what the reader is sent, whether the read
 * happened, and how many Requests the server received — is produced by the
 * shipping code.
 *
 * **Requests are counted, not Turns looked at.** The SDK's completeness helper
 * counts an `approval-responded` part as finished *before* the tool has run, so
 * an automatic resume can fire while the read is still outstanding — and a
 * duplicate Turn is invisible from the reader's side: the answer still arrives,
 * the transcript still looks right, and the only symptom is that the Endpoint
 * was asked twice for a Turn the reader answered once. So the claim is made by
 * counting what the server received.
 */

vi.setConfig({ testTimeout: 20_000 });

const REAL_BASE_URL = "http://localhost:11434/v1";

/** A file the Model will want and the Root does not cover. */
const SECRET = "the key is hunter2";

/** What the Endpoint is planned to answer, one plan per call. */
type Plan = { tool?: { name: string; arguments: string }; words?: string[] };

let stubURL = "";
let plans: Plan[] = [];
let stubCalls = 0;
/** Every request the chat route received, the message histories it was sent. */
let chatRequests: unknown[][] = [];
/** Whether a rewrite was arranged for the next chat request, and what it does. */
let tamper: ((body: unknown) => unknown) | null = null;
let sockets = new Set<Socket>();
const REAL_FETCH = globalThis.fetch;

/** One chunk of an OpenAI-compatible stream. */
function chunk(delta: object, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id: "1",
    object: "chat.completion.chunk",
    created: 0,
    model: "stub",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function streamPlan(res: ServerResponse, plan: Plan, call: number): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  if (plan.tool) {
    const { name, arguments: args } = plan.tool;
    // A fresh id per call, as a real Endpoint mints one. A Tool Call is matched by
    // its id across the whole Conversation, so reusing one would have the second
    // Turn's read overwrite the first Turn's settled row.
    const id = `call_${call}`;
    // Split across two deltas, the way a real Endpoint streams an argument it has
    // not finished writing: a single whole-string chunk would not exercise the
    // half-built input the transcript renders while a call is running.
    const cut = Math.floor(args.length / 2);
    res.write(
      chunk(
        {
          tool_calls: [
            { index: 0, id, type: "function", function: { name, arguments: args.slice(0, cut) } },
          ],
        },
        null,
      ),
    );
    res.write(
      chunk(
        {
          tool_calls: [{ index: 0, function: { arguments: args.slice(cut) } }],
        },
        null,
      ),
    );
    res.write(chunk({}, "tool_calls"));
  } else {
    // Space-separated so the assembled text reads as prose, the way a reader
    // will be reading it.
    (plan.words ?? []).forEach((word, index) => {
      res.write(chunk({ content: index === 0 ? word : ` ${word}` }, null));
    });
    res.write(chunk({}, "stop"));
  }

  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (!req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }

  let raw = "";
  req.on("data", (part) => (raw += part));
  req.on("end", () => {
    const call = stubCalls++;
    streamPlan(res, plans[call] ?? { words: ["nothing", "planned"] }, call);
  });
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
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
      sockets.forEach((socket) => socket.destroy());
      server.close(() => resolve());
    }),
);

/* -----------------------------------------------------------------------
 * A real Reading Root on a real disk, in a throwaway project.
 *
 * The route reads its target from the working directory, so the test runs the
 * app in a temporary one and points HOME at it as well: the walk that bounds
 * every folder this feature can name is the reader's home folder, so the Grant
 * being recorded has to be inside it.
 * --------------------------------------------------------------------- */

let project = "";
let root = "";

const realHome = process.env.HOME;
const realCwd = process.cwd();
const realNodeEnv = process.env.NODE_ENV;

beforeEach(async () => {
  await rm(project, { recursive: true, force: true });
  project = await realpath(await mkdtemp(path.join(tmpdir(), "approval-flow-")));

  process.env.HOME = project;
  process.chdir(project);

  // Writing a Grant is a development-only capability, exactly as naming a Root
  // is, and the route refuses it everywhere else. The test runs the app the way a
  // reader does rather than reaching past the guard — through `setEnvVar`, which
  // exists because Next declares NODE_ENV read-only and a test sets it on purpose.
  setEnvVar("NODE_ENV", "development");

  root = path.join(project, "project");
  await mkdir(root);
  await mkdir(path.join(project, "elsewhere"));
  await writeFile(path.join(project, "elsewhere", "notes.md"), `${SECRET}\n`, "utf8");
  await writeFile(path.join(project, ".reading-root.json"), `${JSON.stringify({ root, grants: [] }, null, 2)}\n`, "utf8");

  stubCalls = 0;
  chatRequests = [];
  tamper = null;
  sockets = new Set();
  plans = [];
  findEndpoint("ollama")!.baseURL = stubURL;

  // The browser → Route Handler hop and nothing else. The chat route's own call
  // out to the Endpoint falls through to the captured real fetch.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.endsWith("/api/chat") || url.endsWith("/api/roots")) {
      const handler = url.endsWith("/api/chat") ? chatPOST : rootsPOST;
      return handler(new Request(new URL(url, "http://localhost").href, init));
    }

    return REAL_FETCH(input, init);
  }) as typeof fetch;

  // The server has to receive the history the browser actually sent, or the
  // count below would be counting a rewritten request.
  const counting = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (!url.endsWith("/api/chat")) return counting(input, init);

    const sent = JSON.parse(String(init?.body ?? "{}")) as { messages: unknown[] };
    chatRequests.push(sent.messages);

    if (tamper) {
      const rewritten = tamper({ messages: sent.messages }) as { messages: unknown[] };
      return counting(input, { ...init, body: JSON.stringify(rewritten) });
    }

    return counting(input, init);
  }) as typeof fetch;

  render(<Harness />);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = REAL_FETCH;
  findEndpoint("ollama")!.baseURL = REAL_BASE_URL;
  process.env.HOME = realHome;
  setEnvVar("NODE_ENV", realNodeEnv);
  process.chdir(realCwd);
  return rm(project, { recursive: true, force: true });
});

function Harness() {
  return (
    <Chat
      endpointId="ollama"
      endpointName="Ollama"
      modelId="llama3.2"
      conversation={null}
      onSave={() => {}}
    />
  );
}

/** A Turn asking to read a file the Root does not cover. */
const ASKS_FOR = {
  tool: { name: "read_file", arguments: JSON.stringify({ path: "../elsewhere/notes.md" }) },
};

/**
 * Arranges the Endpoint's next two answers: a Tool Call, then whatever comes
 * after it once the reader has answered.
 *
 * Indexed from the call counter rather than from zero, because the plans are
 * consumed by position and the Conversation is usually several calls in by the
 * time a second Turn is sent.
 */
function planNext(question: Plan = ASKS_FOR, follow: Plan = { words: ["It", "says", "hunter2."] }): void {
  plans[stubCalls] = question;
  plans[stubCalls + 1] = follow;
}

/** Sends a message the way a person does, and waits for the question to appear. */
async function askQuestion(text: string, follow?: Plan): Promise<void> {
  planNext(ASKS_FOR, follow ?? { words: ["It", "says", "hunter2."] });

  fireEvent.change(screen.getByPlaceholderText(/send a message/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("button", { name: /allow once/i });
}

function control(name: RegExp): HTMLButtonElement {
  const found = screen.queryByRole<HTMLButtonElement>("button", { name });
  if (!found) throw new Error(`no control named ${name}`);
  return found;
}

/** Everything the Conversation has on screen. */
function transcript(): string {
  return document.body.textContent ?? "";
}

/** How many Requests the chat route has received. */
function requests(): number {
  return chatRequests.length;
}

/** Waits for something to reach the screen, giving the resume room to happen. */
async function settled(assertion: () => void): Promise<void> {
  await waitFor(assertion, { timeout: 8_000 });
}

describe("a read the Model is asking to make outside the Root", () => {
  it("asks the reader, naming the file in full rather than a relative version of it", async () => {
    await askQuestion("what is in my notes?");

    // A relative path would not tell the reader which file is being asked about,
    // and the whole decision turns on that.
    expect(transcript()).toContain(path.join(project, "elsewhere", "notes.md"));
    expect(transcript()).toContain("Needs your answer");
  });

  it("holds the reader's Send back until the question is answered", async () => {
    await askQuestion("what is in my notes?", { words: ["nothing", "more"] });

    // With a message written and ready to go. A Turn started behind an open
    // question would send a history in which the Model has asked for something
    // and been told nothing — which reads downstream as yes.
    fireEvent.change(screen.getByPlaceholderText(/send a message/i), {
      target: { value: "and my config?" },
    });
    expect(control(/^Send$/).disabled).toBe(true);

    fireEvent.click(control(/allow once/i));

    await settled(() => expect(control(/^Send$/).disabled).toBe(false));
  });

  it("completes the Turn when the reader allows it once, and resumes it exactly once", async () => {
    await askQuestion("what is in my notes?");

    fireEvent.click(control(/allow once/i));

    // The answer echoes the file, so the Model's Response can only be here if the
    // read really happened and really was used to answer.
    await settled(() => expect(transcript()).toContain("It says hunter2."));

    // Two Requests and two: the one the reader started and the one the answer
    // resumed. A third would be the completeness helper firing again after the
    // read had already finished — a duplicate Turn, which looks like nothing at
    // all from where the reader is sitting.
    await settled(() => expect(stubCalls).toBe(2));
    expect(requests()).toBe(2);
  });

  it("records a Grant before it answers, so the next read of the same path asks nothing", async () => {
    await askQuestion("what is in my notes?");

    fireEvent.click(control(/always allow/i));

    await settled(() => expect(transcript()).toContain("It says hunter2."));

    // Written before the read ran, and written by the server rather than by the
    // browser: the browser cannot resolve a path it was never told the Root of.
    const recorded = JSON.parse(await readFile(path.join(project, ".reading-root.json"), "utf8"));
    expect(recorded.grants).toEqual([path.join(project, "elsewhere", "notes.md")]);
    expect(requests()).toBe(2);
  });

  it("asks again on the next Turn when the reader allowed it once only", async () => {
    // "Once" means once. A reader who allowed one read has said nothing about the
    // next Turn, and a Turn that quietly stopped asking would be a boundary the
    // reader widened by pressing a button whose label says they did not.
    await askQuestion("what is in my notes?");
    fireEvent.click(control(/allow once/i));
    await settled(() => expect(transcript()).toContain("It says hunter2."));

    await askQuestion("and now?");

    expect(transcript()).toContain("Needs your answer");
  });

  it("reads the same path without asking on the next Turn, once a Grant covers it", async () => {
    // The reason "always allow" exists at all: the reader answered once and is not
    // asked the same question every Turn afterwards.
    await askQuestion("what is in my notes?");
    fireEvent.click(control(/always allow/i));
    await settled(() => expect(transcript()).toContain("It says hunter2."));

    plans[stubCalls] = ASKS_FOR;
    plans[stubCalls + 1] = { words: ["Still", "hunter2."] };
    fireEvent.change(screen.getByPlaceholderText(/send a message/i), {
      target: { value: "and now?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // No question this time, and the read says on its row that a decision was
    // already made — a file outside the Root must never arrive looking like one
    // inside it.
    await settled(() => expect(transcript()).toContain("Still hunter2."));
    expect(transcript()).toContain("Approved automatically");
    expect(screen.queryByRole("button", { name: /allow once/i })).toBeNull();
  });

  it("resumes the Turn when the reader says no, and reads nothing", async () => {
    await askQuestion("what is in my notes?", { words: ["I", "cannot", "read", "that", "one."] });

    fireEvent.click(control(/deny/i));

    // The Turn carries on: a refusal ends the line the Model was on, not the
    // Turn, and the reader is not made to start a new one to say so.
    await settled(() => expect(transcript()).toContain("I cannot read that one."));
    expect(requests()).toBe(2);

    // Nothing left the disk. This is the claim the whole feature is stood on, so
    // it is asserted on what the reader can see rather than on a state.
    expect(transcript()).not.toContain("hunter2");
    expect(transcript()).toContain("Denied by you");
  });

  it("tells the Model the read was refused, so it does not simply ask again", async () => {
    await askQuestion("what is in my notes?", { words: ["Understood."] });

    fireEvent.click(control(/deny/i));
    await settled(() => expect(requests()).toBe(2));

    // The second Request is the whole history with the reader's answer in it, and
    // the answer reaches the Model as a denied result rather than as something the
    // interface decided on its behalf.
    const replayed = JSON.stringify(chatRequests[1]);
    expect(replayed).toContain("You chose not to let this read happen.");
    expect(replayed).toContain('"approved":false');
  });

  it("refuses an approval this server did not issue, rather than obeying it", async () => {
    await askQuestion("what is in my notes?", { words: ["nothing", "more"] });

    // What a modified client does: keep the question, forge an approval for it,
    // and change nothing the signature was computed over — which is impossible,
    // because the signature covers the tool name, the call id and a digest of the
    // input as well as the approval's own id.
    tamper = (body) => {
      const { messages } = body as { messages: { parts: { approval?: { signature?: string } }[] }[] };
      for (const message of messages) {
        for (const part of message.parts) {
          if (part.approval?.signature) part.approval.signature = `${part.approval.signature}x`;
        }
      }
      return body;
    };

    fireEvent.click(control(/allow once/i));

    // The resume is sent and refused, so the read never happens: the Turn fails
    // rather than answering a question the server asked nobody. The failure is a
    // stream error at HTTP 200 — the SDK throws inside `streamText` rather than
    // refusing the Request — which is what the reader sees as an error.
    await settled(() => expect(requests()).toBe(2));
    await settled(() => expect(transcript()).not.toContain("hunter2"));
    expect(stubCalls).toBe(1);
  });
});