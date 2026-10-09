import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDiscoveryAnswer, requestModels } from "./request";

/**
 * `readDiscoveryAnswer` is handed exactly what the discovery Route Handler
 * answered, including a failing status, and returns the outcome to show. The
 * bodies below are the ones the Route Handler in `app/api/models/route.ts`
 * produces.
 */

describe("reading what the discovery Route Handler answered", () => {
  it("reports the identifiers a discovered Endpoint offers", () => {
    const answer = readDiscoveryAnswer({
      status: 200,
      body: { endpointId: "ollama", result: { status: "found", models: ["llama3.2:latest"] } },
    });

    expect(answer).toEqual({ status: "found", models: ["llama3.2:latest"] });
  });

  it("reports an Endpoint with nothing loaded as empty rather than as a failure", () => {
    const answer = readDiscoveryAnswer({
      status: 200,
      body: { endpointId: "ollama", result: { status: "empty" } },
    });

    // Distinct from `unavailable`: this Endpoint answered, it simply has
    // nothing loaded, which is a different thing to go and do about it.
    expect(answer).toEqual({ status: "empty" });
  });

  it("passes through an Endpoint reported unreachable", () => {
    const answer = readDiscoveryAnswer({
      status: 200,
      body: { endpointId: "ollama", result: { status: "unreachable" } },
    });

    expect(answer).toEqual({ status: "unreachable" });
  });

  it("passes through an Endpoint that cannot be asked", () => {
    const answer = readDiscoveryAnswer({
      status: 200,
      body: { endpointId: "ollama", result: { status: "unavailable" } },
    });

    expect(answer).toEqual({ status: "unavailable" });
  });

  it("reports the Route Handler's own error, naming the Credential to set", () => {
    const answer = readDiscoveryAnswer({
      status: 400,
      body: { error: "OpenRouter has no Credential. Set OPENROUTER_API_KEY and try again." },
    });

    // Discovery could not even be attempted. This is not a chat failure and
    // must not read as one.
    expect(answer).toEqual({
      status: "refused",
      message: "OpenRouter has no Credential. Set OPENROUTER_API_KEY and try again.",
    });
  });

  it("reports a discovery route that could not be reached at all", () => {
    const answer = readDiscoveryAnswer({ status: 0, body: null });

    expect(answer).toEqual({
      status: "unreachable",
      message: "Could not reach the app's Model Discovery route.",
    });
  });

  it("reports an answer it does not recognise, rather than showing an empty list", () => {
    const answer = readDiscoveryAnswer({ status: 200, body: { unexpected: true } });

    // An empty control with no explanation is exactly what this ticket exists to
    // prevent, so anything unrecognised becomes a stated outcome.
    expect(answer).toEqual({
      status: "unavailable",
      message: "The app's Model Discovery route answered in an unexpected form.",
    });
  });
});

/**
 * The rest stands up the real Route Handler over a real socket, so the shape of
 * the request the interface makes is asserted rather than assumed. Only the
 * browser's own origin is stubbed, by pointing global fetch at the stub; the
 * Route Handler in `app/api/models/route.ts` runs exactly as it does in the app.
 */

let stubURL = "";
let seen: { method: string | undefined; url: string | undefined; body: string };

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    seen = { method: req.method, url: req.url, body };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        endpointId: "ollama",
        result: { status: "found", models: ["llama3.2:latest", "qwen2.5-coder:7b"] },
      }),
    );
  });
});

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        stubURL = `http://127.0.0.1:${port}/api/models`;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("asking the app to discover Models", () => {
  it("asks by POST, because a GET would be prerendered at build time", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(stubURL, init)) as typeof fetch;

    try {
      const answer = await requestModels("ollama");
      expect(answer).toEqual({ status: "found", models: ["llama3.2:latest", "qwen2.5-coder:7b"] });
      expect(seen.method).toBe("POST");
      expect(seen.url).toBe("/api/models");
      expect(JSON.parse(seen.body)).toEqual({ endpointId: "ollama" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});