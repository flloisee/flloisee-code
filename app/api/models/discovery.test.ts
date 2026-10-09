import { createServer, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/models/route";
import { findEndpoint } from "@/lib/endpoints/registry";

/**
 * Drives the discovery Route Handler against a real HTTP server standing in
 * for a running Ollama.
 *
 * Nothing in the model layer is mocked: the Endpoint is addressed by the base
 * URL the Registry declares, over a real socket, so what is asserted is what a
 * server with Models loaded would actually answer.
 */

let stubURL = "";

/** Rewritten per test so the stub Endpoint answers however that test needs. */
let respond: (res: ServerResponse) => void;

const server = createServer((req, res) => {
  if (req.url?.endsWith("/models")) {
    respond(res);
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

afterEach(() => {
  findEndpoint("ollama")!.baseURL = "http://localhost:11434/v1";
  respond = (res) => res.writeHead(404).end();
});

async function ask(baseURL: string): Promise<{ status: number; body: unknown }> {
  findEndpoint("ollama")!.baseURL = baseURL;

  const response = await POST(
    new Request("http://localhost/api/models", {
      method: "POST",
      body: JSON.stringify({ endpointId: "ollama" }),
    }),
  );

  return { status: response.status, body: await response.json() };
}

/** Points the declared Endpoint at the stub and asks it what it has. */
function askStub(): Promise<{ status: number; body: unknown }> {
  return ask(stubURL);
}

function servingModels(ids: string[]) {
  respond = (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }));
  };
}

describe("a Model discovered through the interface", () => {
  it("is the identifier the running Endpoint reports as loaded", async () => {
    servingModels(["llama3.2:latest", "qwen2.5-coder:7b"]);

    const { status, body } = await askStub();

    expect(status).toBe(200);
    expect(body).toEqual({
      endpointId: "ollama",
      result: { status: "found", models: ["llama3.2:latest", "qwen2.5-coder:7b"] },
    });
  });

  it("picks up a Model loaded after the first discovery, when asked again", async () => {
    // The point of re-running discovery on demand: a Model pulled after the page
    // was first opened becomes reachable without restarting anything.
    servingModels(["llama3.2:latest"]);
    await expect(askStub()).resolves.toMatchObject({
      body: { result: { models: ["llama3.2:latest"] } },
    });

    servingModels(["llama3.2:latest", "gemma3:4b"]);
    await expect(askStub()).resolves.toMatchObject({
      body: { result: { models: ["llama3.2:latest", "gemma3:4b"] } },
    });
  });

  it("tells the reader the Endpoint has nothing loaded, rather than showing an empty control", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
    };

    const { status, body } = await askStub();

    expect(status).toBe(200);
    expect(body).toEqual({ endpointId: "ollama", result: { status: "empty" } });
  });

  it("tells the reader an Endpoint that is not running is unreachable", async () => {
    // The Registry's declared address, where nothing is listening.
    const { status, body } = await ask("http://localhost:11434/v1");

    expect(status).toBe(200);
    expect(body).toEqual({ endpointId: "ollama", result: { status: "unreachable" } });
  });
});