import { createServer, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/models/route";
import { ENDPOINTS, findEndpoint } from "@/lib/endpoints/registry";
import type { LocalEndpoint } from "@/lib/endpoints/types";

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

/**
 * The Registry is a readonly list by design, so a test that needs a second
 * Endpoint declares one for its own length. Nothing else observes the Registry
 * between tests, and `afterEach` removes it again.
 */
const declared = ENDPOINTS as LocalEndpoint[];

/**
 * An address where nothing listens, standing in for an Ollama that has not been
 * started. Arranged deliberately rather than assumed: whether the developer
 * happens to have Ollama running must not decide whether this suite passes.
 */
let silentBaseURL = "";

const silent = createServer();

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      // Bound only long enough to claim a port nothing else is using, then
      // released so that nothing is listening there for the tests below.
      silent.listen(0, "127.0.0.1", () => {
        const address = silent.address();
        const port = typeof address === "object" && address ? address.port : 0;
        silent.close(() => {
          silentBaseURL = `http://127.0.0.1:${port}/v1`;
          findEndpoint("ollama")!.baseURL = silentBaseURL;
          resolve();
        });
      });
    }),
);

afterEach(async () => {
  findEndpoint("ollama")!.baseURL = silentBaseURL;
  respond = (res) => res.writeHead(404).end();
  for (let index = declared.length - 1; index >= 0; index -= 1) {
    if (declared[index]!.id === "second-stub") declared.splice(index, 1);
  }
  if (second) {
    await new Promise<void>((resolve) => second!.close(() => resolve()));
    second = undefined;
  }
});

/**
 * Stands up a second Endpoint on its own port, serving its own Models.
 *
 * Two Endpoints reporting different Models is the whole reason discovery is a
 * POST: were this a GET, the answer would be frozen at build time and both
 * Endpoints would report whichever one was asked first.
 */
async function secondEndpointServing(ids: string[]): Promise<void> {
  const other = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: ids.map((id) => ({ id })) }));
  });

  second = other;
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", () => resolve()));

  const address = other.address();
  const port = typeof address === "object" && address ? address.port : 0;

  declared.push({
    id: "second-stub",
    name: "Second Stub",
    baseURL: `http://127.0.0.1:${port}/v1`,
    defaultModelId: ids[0]!,
  });
}

/** The second Endpoint's server, kept so it can be shut down after its test. */
let second: Server | undefined;

async function ask(
  endpointId: string,
  baseURL?: string,
): Promise<{ status: number; body: unknown }> {
  if (baseURL !== undefined) findEndpoint(endpointId)!.baseURL = baseURL;

  const response = await POST(
    new Request("http://localhost/api/models", {
      method: "POST",
      body: JSON.stringify({ endpointId }),
    }),
  );

  return { status: response.status, body: await response.json() };
}

/** Points the declared Endpoint at the stub and asks it what it has. */
function askStub(): Promise<{ status: number; body: unknown }> {
  return ask("ollama", stubURL);
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
    // The address arranged above, where nothing is listening — the same state
    // as an Ollama that has not been started.
    const { status, body } = await ask("ollama");

    expect(status).toBe(200);
    expect(body).toEqual({ endpointId: "ollama", result: { status: "unreachable" } });
  });

  it("reports each Endpoint's own Models, never one Endpoint's answer for another", async () => {
    servingModels(["llama3.2:latest", "qwen2.5-coder:7b"]);
    findEndpoint("ollama")!.baseURL = stubURL;
    await secondEndpointServing(["mistral-small:latest", "phi-4"]);

    const first = await ask("ollama");
    const second = await ask("second-stub");

    // Asked in both orders, so a cached answer could not pass by luck.
    expect(first.body).toEqual({
      endpointId: "ollama",
      result: { status: "found", models: ["llama3.2:latest", "qwen2.5-coder:7b"] },
    });
    expect(second.body).toEqual({
      endpointId: "second-stub",
      result: { status: "found", models: ["mistral-small:latest", "phi-4"] },
    });

    const reversed = await ask("second-stub");
    expect(reversed.body).toMatchObject({
      result: { models: ["mistral-small:latest", "phi-4"] },
    });
  });
});