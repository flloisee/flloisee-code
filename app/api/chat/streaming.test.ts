import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/chat/route";
import { findEndpoint } from "@/lib/endpoints/registry";
import { temporaryProject, type TemporaryProject } from "@/lib/testing/temporary-project";

/**
 * Exercises the chat Route Handler against a real HTTP server speaking the
 * OpenAI-compatible streaming format.
 *
 * Nothing in the model layer is mocked: the request travels the same path it
 * would with a running Ollama, so what is asserted here is what the Endpoint
 * actually receives and what actually reaches the browser.
 */

const DELTAS = ["Hello", " from", " the", " stub"];
const CONVERSATION = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
  { id: "m2", role: "assistant", parts: [{ type: "text", text: "Hello from the stub" }] },
  { id: "m3", role: "user", parts: [{ type: "text", text: "and again" }] },
];

let stubURL = "";
let stubSaw: { model: string; messages: { role: string; content: string }[]; stream: boolean };

function handleChatCompletion(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    stubSaw = JSON.parse(body);

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    const chunk = (delta: object, finishReason: string | null) =>
      res.write(
        `data: ${JSON.stringify({
          id: "1",
          object: "chat.completion.chunk",
          created: 0,
          model: "stub",
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`,
      );

    // Each delta is written on its own tick so progressive arrival is real.
    DELTAS.forEach((delta, index) => setTimeout(() => chunk({ content: delta }, null), index * 20));
    setTimeout(() => {
      chunk({}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    }, DELTAS.length * 20);
  });
}

const server = createServer((req, res) => {
  if (req.url?.endsWith("/chat/completions")) {
    handleChatCompletion(req, res);
    return;
  }
  res.writeHead(404).end();
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
 * A project of its own to run the app in, with no folder it may read.
 *
 * The route reads the Root from a file in the working directory, so these tests
 * are only about carrying a Conversation if no Root is declared — and that has to
 * be this suite's doing rather than the developer's. A reader who has picked a
 * folder in the running app has `.reading-root.json` in this very checkout, and
 * a Turn then carries the instructions for reading as well as the Conversation.
 * That is correct behaviour and the wrong thing for these assertions, which are
 * about what the reader said reaching the Endpoint intact.
 *
 * `temporaryProject` puts the working directory somewhere empty, so "no Root" is
 * a fact the suite establishes rather than one it hopes for.
 */
const project: TemporaryProject = await temporaryProject("chat-streaming-");

beforeEach(async () => {
  await project.begin();
});

afterEach(async () => {
  findEndpoint("ollama")!.baseURL = "http://localhost:11434/v1";
  await project.end();
});

async function sendConversation(): Promise<{ raw: string; chunks: number }> {
  findEndpoint("ollama")!.baseURL = stubURL;

  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        endpointId: "ollama",
        modelId: "llama3.2",
        messages: CONVERSATION,
      }),
    }),
  );

  expect(response.status).toBe(200);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks += 1;
    raw += decoder.decode(value, { stream: true });
  }

  return { raw, chunks };
}

describe("a Response reaching the interface", () => {
  it("arrives progressively rather than all at once on completion", async () => {
    const { raw, chunks } = await sendConversation();

    const deltas = [...raw.matchAll(/"type":"text-delta","id":"[^"]+","delta":"([^"]*)"/g)].map(
      (match) => match[1],
    );

    // One delta per text part, reassembled in order by the interface.
    expect(deltas).toEqual(DELTAS);
    // Distinct network chunks, not a single buffered wall of text.
    expect(chunks).toBeGreaterThan(1);
  });

  it("carries the whole Conversation so a second message accounts for the first", async () => {
    await sendConversation();

    expect(stubSaw.model).toBe("llama3.2");
    expect(stubSaw.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello from the stub" },
      { role: "user", content: "and again" },
    ]);
  });

  it("is requested from the Endpoint as a stream, proxied through the server", async () => {
    await sendConversation();

    expect(stubSaw.stream).toBe(true);
  });
});