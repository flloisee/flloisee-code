import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { discoverModels } from "./discover";

/**
 * Exercises discovery against a real HTTP server speaking the models-listing
 * format Ollama and LM Studio serve.
 *
 * The model layer is not mocked: the request crosses a real socket to the
 * conventional `GET {baseURL}/models` path, so what is asserted is what an
 * Endpoint would actually receive and answer.
 */

interface Seen {
  url: string | undefined;
  authorization: string | undefined;
}

/** Rewritten per test to make the stub answer however that test needs. */
let respond: (res: ServerResponse) => void;
let seen: Seen;

function readRequest(req: IncomingMessage, res: ServerResponse) {
  seen = { url: req.url, authorization: req.headers.authorization };
  respond(res);
}

const server = createServer(readRequest);

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
  respond = (res) => res.writeHead(404).end();
});

let stubURL = "";

describe("asking an Endpoint which Models it has", () => {
  it("reports the identifiers the Endpoint currently offers", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "llama3.2:latest" }, { id: "qwen2.5-coder:7b" }],
        }),
      );
    };

    const result = await discoverModels({ baseURL: stubURL });

    expect(result).toEqual({ status: "found", models: ["llama3.2:latest", "qwen2.5-coder:7b"] });
  });

  it("asks the Endpoint's conventional models path on the base URL it was given", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
    };

    // stubURL is the Registry's base URL shape: host, port, and the /v1 prefix.
    await discoverModels({ baseURL: stubURL });

    expect(seen.url).toBe("/v1/models");
  });

  it("asks the models path without doubling the separator when the base URL ends in one", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
    };

    await discoverModels({ baseURL: `${stubURL}/` });

    expect(seen.url).toBe("/v1/models");
  });

  it("distinguishes an Endpoint that offers nothing from one that answered", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
    };

    // Both cases end in the free-text Model field, but the reader is told which
    // happened — an Endpoint with nothing loaded reads differently from one
    // that cannot be asked at all.
    const result = await discoverModels({ baseURL: stubURL });

    expect(result).toEqual({ status: "empty" });
  });

  it("reports an Endpoint that answers its models path with an error as unavailable", async () => {
    respond = (res) => res.writeHead(404).end("no such route");

    const result = await discoverModels({ baseURL: stubURL });

    expect(result).toEqual({ status: "unavailable" });
  });

  it("reports an Endpoint that answers with something other than a listing as unavailable", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>LM Studio</title>");
    };

    const result = await discoverModels({ baseURL: stubURL });

    expect(result).toEqual({ status: "unavailable" });
  });

  it("reports an Endpoint that is not running as unreachable, so I know to start it", async () => {
    // A port nothing listens on: the same state as Ollama being stopped.
    const result = await discoverModels({ baseURL: "http://127.0.0.1:1/v1" });

    expect(result).toEqual({ status: "unreachable" });
  });

  it("carries a Credential when the Endpoint needs one, and omits it when it does not", async () => {
    respond = (res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }));
    };

    await discoverModels({ baseURL: stubURL, credential: "sk-secret" });
    expect(seen.authorization).toBe("Bearer sk-secret");

    await discoverModels({ baseURL: stubURL });
    // A Local Endpoint needs no Credential, so none is invented for it.
    expect(seen.authorization).toBeUndefined();
  });
});