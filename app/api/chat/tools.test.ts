import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST, maxDuration } from "@/app/api/chat/route";
import { findEndpoint } from "@/lib/endpoints/registry";
import { declareRoot } from "@/lib/roots/reading-root";
import { temporaryProject, type TemporaryProject } from "@/lib/testing/temporary-project";
import { READING_INSTRUCTIONS } from "@/lib/tools/instructions";

/**
 * The Tools, seen from the only place they can be seen: what the Endpoint is
 * sent, and what reaches the interface.
 *
 * A real HTTP server speaks the OpenAI-compatible streaming format, and nothing
 * in the model layer is mocked, so a read in these tests is a read of a file
 * that is really on disk and a step is a request the Endpoint really answered.
 * That is what makes "the Root comes from the file and nowhere else" testable
 * rather than merely asserted: a Root that could be steered from the request
 * would show up as a file's contents in the second request to the stub.
 */

const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/** What the stub Endpoint does on one turn. */
type Step =
  /** Calls `read_file` on this path. */
  | { read: string }
  /** Calls `search_files` for this text. */
  | { search: string }
  /** Answers in prose, having used nothing. */
  | "text"
  /** Refuses the request, as an Endpoint does when its Model cannot call Tools. */
  | "refuse-tools";

const REFUSAL_WORDS = "this build of llama3.2 has no tool support";

let stubURL = "";
let plan: Step[] = [];
let seen: Record<string, unknown>[] = [];

function chunk(res: ServerResponse, delta: object, finishReason: string | null) {
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

function callTool(res: ServerResponse, name: string, args: object) {
  chunk(
    res,
    {
      tool_calls: [{ index: 0, id: `call_${seen.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    },
    "tool_calls",
  );
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (piece) => (body += piece));
  req.on("end", () => {
    seen.push(JSON.parse(body) as Record<string, unknown>);
    const step = plan[Math.min(seen.length - 1, plan.length - 1)];

    if (step === "refuse-tools") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: REFUSAL_WORDS, code: "model_not_supported" } }));
      return;
    }

    res.writeHead(200, { "content-type": "text/event-stream" });

    if (step === "text") {
      chunk(res, { content: "here is the answer" }, "stop");
    } else if ("read" in step) {
      callTool(res, "read_file", { path: step.read });
    } else {
      callTool(res, "search_files", { query: step.search });
    }

    res.write("data: [DONE]\n\n");
    res.end();
  });
});

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        stubURL = `http://127.0.0.1:${port}/v1`;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/**
 * A project the app runs in, with a folder it may read and a folder it may not.
 *
 * `temporaryProject` puts the working directory somewhere of its own, which is
 * what lets the Root be read from a file without any test declaring the
 * developer's own folder as readable.
 */
const project: TemporaryProject = await temporaryProject("chat-tools-");

/** The folder inside the project the reader shared, with one file in it. */
const NOTES = "the line the reader wants explained";

beforeEach(async () => {
  await project.begin();
  await mkdir(path.join(project.dir, "project", "src"), { recursive: true });
  await mkdir(path.join(project.dir, "secrets"), { recursive: true });
  await writeFile(path.join(project.dir, "project", "src", "notes.md"), `${NOTES}\n`, "utf8");
  await writeFile(path.join(project.dir, "secrets", "token.txt"), "hunter2\n", "utf8");

  findEndpoint("ollama")!.baseURL = stubURL;
  plan = ["text"];
  seen = [];
});

afterEach(async () => {
  findEndpoint("ollama")!.baseURL = OLLAMA_BASE_URL;
  await project.end();
});

/** Declares the folder the reader shared, through the writer of ticket 01. */
async function declareSharedFolder() {
  await declareRoot({ dir: project.dir, root: path.join(project.dir, "project") });
}

async function turn(
  body: Record<string, unknown> = {},
  options: { signal?: AbortSignal; onChunk?: (raw: string) => void } = {},
): Promise<{ raw: string; status: number }> {
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        endpointId: "ollama",
        modelId: "llama3.2",
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "what does this do?" }] }],
        ...body,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    options.onChunk?.(raw);
  }

  return { raw, status: response.status };
}

/** The tools named in a request the Endpoint received. */
function toolsNamedIn(request: Record<string, unknown> | undefined): string[] {
  const tools = (request?.tools ?? []) as { function: { name: string } }[];
  return tools.map((tool) => tool.function.name);
}

/** One thing the interface was sent, as it arrived on the wire. */
type Sent = Record<string, unknown> & { type: string };

/**
 * Every chunk in a raw SSE body, in the order they arrived.
 *
 * `[DONE]` is the end of the stream rather than a chunk, so it is taken out
 * before anything is parsed — a terminator is not a JSON document.
 */
function chunksIn(raw: string): Sent[] {
  return [...raw.matchAll(/^data: (.+)$/gm)]
    .map((match) => match[1])
    .filter((line) => line !== "[DONE]")
    .map((line) => JSON.parse(line) as Sent);
}

/** Every chunk type in a raw SSE body, in the order they arrived. */
function chunkTypes(raw: string): string[] {
  return chunksIn(raw).map((sent) => sent.type);
}

/** The one chunk of this type, which a test is about and can therefore rely on. */
function chunkOf(raw: string, type: string): Sent {
  const found = chunksIn(raw).find((sent) => sent.type === type);
  if (found === undefined) throw new Error(`no ${type} in the stream: ${chunkTypes(raw).join(", ")}`);
  return found;
}

describe("a Turn with no Reading Root", () => {
  it("sends the Endpoint a request carrying no Tools at all", async () => {
    await turn();

    expect(toolsNamedIn(seen[0])).toEqual([]);
  });

  it("tells the Model nothing about files, because there are none it may read", async () => {
    await turn();

    expect(JSON.stringify(seen[0])).not.toContain("read_file");
    expect(JSON.stringify(seen[0])).not.toContain("list_files");
  });

  it("answers as it did before any of this, with nothing tool-shaped in the stream", async () => {
    const { raw, status } = await turn();

    expect(status).toBe(200);
    expect(chunkTypes(raw)).toEqual(["start", "start-step", "text-start", "text-delta", "text-end", "finish-step", "finish"]);
  });
});

describe("a Turn with a Reading Root", () => {
  it("gives the Model the three Tools", async () => {
    await declareSharedFolder();
    await turn();

    expect(toolsNamedIn(seen[0])).toEqual(["list_files", "read_file", "search_files"]);
  });

  it("tells the Model about them, in one system message", async () => {
    await declareSharedFolder();
    await turn();

    const system = seen[0].messages as { role: string; content: string }[];

    expect(system.filter((message) => message.role === "system")).toHaveLength(1);
    expect(system[0].content).toBe(READING_INSTRUCTIONS);
  });

  it("reads a file inside the Root and puts what it found in front of the Model", async () => {
    await declareSharedFolder();
    plan = [{ read: "src/notes.md" }, "text"];

    const { raw } = await turn();

    // The read is real: the second request carries the line that was on disk.
    expect(seen[1]).toBeDefined();
    expect(JSON.stringify(seen[1])).toContain(NOTES);
    expect(chunkTypes(raw)).toContain("tool-output-available");
  });

  it("carries on when a Tool refuses, rather than ending the Turn on a refusal", async () => {
    await declareSharedFolder();
    plan = [{ read: "src/not-here.md" }, "text"];

    const { raw } = await turn();

    // A refusal is a result, so the Model is asked again rather than the reader
    // being handed a Turn that stopped over a filename.
    expect(seen[1]).toBeDefined();
    expect(JSON.stringify(seen[1])).toContain("There is nothing at");
    expect(chunkTypes(raw)).toContain("finish");
  });
});

describe("the step limit", () => {
  it("stops after eight steps, because a Model that keeps asking would otherwise loop for ever", async () => {
    await declareSharedFolder();
    plan = Array.from({ length: 40 }, () => ({ read: "src/notes.md" }) as Step);

    await turn();

    // Each step is one request, so the number of requests is the ceiling itself
    // rather than a restatement of it.
    expect(seen).toHaveLength(8);
  });
});

describe("a path in the request", () => {
  /** Everything a caller might try to steer a Root with, none of it read. */
  function steering(root: string, file: string): Record<string, unknown> {
    return { path: file, root, readingRoot: root, grants: [root] };
  }

  it("reads the folder a file declared, not one the request named", async () => {
    await declareSharedFolder();
    // The Model reads a file inside the folder the Root file names and outside
    // the folder the caller names. The two answers differ, so this can tell a
    // Root read from a file and a Root read from a request.
    plan = [{ read: "src/notes.md" }, "text"];

    await turn(steering(path.join(project.dir, "secrets"), "../secrets/token.txt"));

    // A Root taken from the request would have refused this path as outside.
    expect(JSON.stringify(seen[1])).toContain(NOTES);
  });

  it("reaches nothing the caller named, so posting a path here gets the reader nothing", async () => {
    await declareSharedFolder();
    plan = [{ read: "../secrets/token.txt" }];

    const { raw } = await turn(steering(path.join(project.dir, "secrets"), "../secrets/token.txt"));

    // The read is stopped and asked about, and the bytes never appear in
    // anything: not in the Turn the Endpoint was sent, and not in what came
    // back to the reader.
    expect(chunkTypes(raw)).toContain("tool-approval-request");
    expect(raw).not.toContain("hunter2");
    expect(JSON.stringify(seen)).not.toContain("hunter2");
  });
});

describe("a read outside the Reading Root", () => {
  it("stops and asks the reader rather than happening", async () => {
    await declareSharedFolder();
    plan = [{ read: "../secrets/token.txt" }, "text"];

    const { raw } = await turn();

    const types = chunkTypes(raw);
    expect(types).toContain("tool-approval-request");
    expect(types).not.toContain("tool-output-available");
    expect(raw).not.toContain("hunter2");
    // Stopping on the question *is* the approval mechanism: the SDK does not run
    // a Tool Call that is waiting on an answer, so the Model is sent no second
    // Turn until the reader has decided. Until ticket 06 gives the reader a way
    // to decide, this is as far as an out-of-Root read goes.
    expect(seen).toHaveLength(1);
  });

  it("asks about the whole path, because a relative one would not say which file", async () => {
    await declareSharedFolder();
    plan = [{ read: "../secrets/token.txt" }];

    const { raw } = await turn();

    const request = chunkOf(raw, "tool-approval-request");

    expect(request.approvalId).toMatch(/^aitxt-/);
    expect(request.toolCallId).toMatch(/^call_/);
    expect(request.reason).toContain(path.join(project.dir, "secrets", "token.txt"));
  });
});

describe("a failure inside a Turn", () => {
  it("describes a Tool Call that was never answered, rather than passing it raw", async () => {
    await declareSharedFolder();

    const { raw, status } = await turn({
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "what does this do?" }] },
        {
          id: "m2",
          role: "assistant",
          parts: [
            {
              type: "tool-read_file",
              toolCallId: "call_1",
              state: "input-available",
              input: { path: "src/notes.md" },
            },
          ],
        },
        { id: "m3", role: "user", parts: [{ type: "text", text: "and again" }] },
      ],
    });

    // It arrives inside a stream rather than as a status, so nothing upstream
    // of the SDK ever sees it. What the reader is shown is our own sentence.
    expect(status).toBe(200);
    expect(chunkTypes(raw)).toEqual(["start", "error"]);
    expect(raw).toMatch(/Tool Call/);
    expect(raw).not.toContain("MissingToolResults");
    expect(raw).not.toContain("call_1");
  });

  it("names the Endpoint and the Model when a Model cannot call Tools, quoting nothing", async () => {
    await declareSharedFolder();
    plan = ["refuse-tools"];

    const { raw } = await turn();

    const described = String(chunkOf(raw, "error").errorText);

    expect(described).toContain("Ollama");
    expect(described).toContain("llama3.2");
    expect(described).not.toContain(REFUSAL_WORDS);
    expect(described).not.toContain("model_not_supported");
  });

  it("does not read a file the reader stopped before it could", async () => {
    await declareSharedFolder();
    const controller = new AbortController();
    plan = [{ read: "src/notes.md" }];

    const { raw } = await turn(
      {},
      {
        signal: controller.signal,
        // Stopped once the Model has finished asking and before the read could
        // have run: the moment a reader watching a Tool row would press it.
        onChunk: (soFar) => {
          if (soFar.includes('"type":"tool-input-available"')) controller.abort();
        },
      },
    );

    // The abortSignal the route already passed covers the Tools and not only
    // the generation, so Stop stops a read rather than merely stopping the
    // words around it. Nothing of the file's reaches the Model or the reader.
    expect(chunkTypes(raw)).toContain("abort");
    expect(chunkTypes(raw)).not.toContain("tool-output-available");
    expect(raw).not.toContain(NOTES);
  });

  it("ends the Turn when the reader presses Stop, rather than only the generation", async () => {
    await declareSharedFolder();
    const controller = new AbortController();
    plan = Array.from({ length: 40 }, () => ({ read: "src/notes.md" }) as Step);

    const { raw } = await turn(
      {},
      {
        signal: controller.signal,
        // Stopped once the read came back, so the Turn is between steps rather
        // than mid-generation — which is the moment the claim is about.
        onChunk: (soFar) => {
          if (soFar.includes("tool-output-available")) controller.abort();
        },
      },
    );

    expect(seen).toHaveLength(1);
    expect(chunkTypes(raw)).toContain("abort");
  });
});

describe("the ceiling on a Turn", () => {
  it("still covers a Turn of several steps, which is not one generation", () => {
    // Eight steps against a loaded local Model is eight round trips, not one.
    expect(maxDuration).toBeGreaterThanOrEqual(300);
  });
});
