import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/chat/route";
import { findEndpoint } from "@/lib/endpoints/registry";

/**
 * Drives the chat Route Handler against a real HTTP Endpoint that fails in each
 * of the ways a reader needs told apart.
 *
 * Nothing in the model layer is stubbed: each request travels the same path it
 * would with a running Ollama, so what is asserted is what the Endpoint actually
 * returns and what actually reaches the browser.
 */

/**
 * A Credential the stub Endpoint deliberately echoes back in every error body,
 * exactly as a real provider does when it rejects a key.
 *
 * It is deliberately distinctive so a leak is unmistakable, and so a test can
 * assert on the secret's absence rather than on a message's exact wording.
 */
const SECRET = "sk-SECRET-abc123-do-not-show";

const REAL_BASE_URL = "http://localhost:11434/v1";

/** Every failure mode the stub can produce, chosen by the base URL path. */
const MODES = [
  "unauthorized",
  "forbidden",
  "unknown-model",
  "garbage",
  "server-error",
] as const;

type FailureMode = (typeof MODES)[number];

let origin = "";
const sockets = new Set<Socket>();

function respond(mode: FailureMode, res: ServerResponse) {
  // Every body below echoes the Credential, the way a real provider does when
  // it rejects a request. Nothing may reach the browser from any of them.
  const errorBody = { error: { message: `rejected with key ${SECRET}`, code: "invalid_api_key" } };

  switch (mode) {
    case "unauthorized":
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify(errorBody));
      return;
    case "forbidden":
      res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify(errorBody));
      return;
    case "unknown-model":
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify(errorBody));
      return;
    case "server-error":
      res.writeHead(500, { "content-type": "text/plain" }).end(`boom, key ${SECRET}`);
      return;
    case "garbage":
      // An Endpoint answering in a form the app cannot read: prose, not a stream.
      res.writeHead(200, { "content-type": "text/event-stream" }).end("not a stream at all\n\n");
      return;
  }
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const segment = (req.url ?? "").split("/").find((part) =>
    (MODES as readonly string[]).includes(part),
  ) as FailureMode | undefined;
  if (segment) {
    req.resume();
    req.on("end", () => respond(segment, res));
    return;
  }
  res.writeHead(404).end();
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

afterEach(() => {
  const endpoint = findEndpoint("ollama")!;
  endpoint.baseURL = REAL_BASE_URL;
  // The Registry object is shared, so a Credential requirement left on it by
  // one test would silently make the next Local Endpoint demand a Credential.
  delete endpoint.credentialEnvVar;
  delete process.env.SECRET_PROBE_KEY;
});

/** A port nothing is listening on, so the connection is genuinely refused. */
let closedPort = 0;
beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        closedPort = (probe.address() as AddressInfo).port;
        probe.close(() => resolve());
      });
    }),
);

/** Points the Local Endpoint at a base URL, optionally requiring a Credential. */
function endpointAt(baseURL: string, { withCredential = false } = {}) {
  const endpoint = findEndpoint("ollama")!;
  endpoint.baseURL = baseURL;
  if (withCredential) {
    endpoint.credentialEnvVar = "SECRET_PROBE_KEY";
    process.env.SECRET_PROBE_KEY = SECRET;
  }
  return endpoint;
}

/** Sends one Turn and returns everything the browser would receive. */
async function sendTurn(): Promise<{ status: number; raw: string }> {
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        endpointId: "ollama",
        modelId: "llama3.2",
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
    }),
  );

  return { status: response.status, raw: await response.text() };
}

/**
 * The failure text the interface would display.
 *
 * A failure reaches the browser in one of two shapes: an error part inside the
 * stream, or a plain JSON body when the request was refused before Proxying
 * began. Both are read here, since both are what the reader ends up seeing.
 */
function failureText(raw: string): string {
  const streamed = raw.match(/"type":"error","errorText":"((?:[^"\\]|\\.)*)"/);
  if (streamed) return JSON.parse(`"${streamed[1]}"`);

  const refused = raw.match(/"error":"((?:[^"\\]|\\.)*)"/);
  return refused ? JSON.parse(`"${refused[1]}"`) : "";
}

describe("a request against an Endpoint that cannot be reached", () => {
  it("tells the reader to start Ollama, rather than to retry", async () => {
    endpointAt(`http://127.0.0.1:${closedPort}/v1`);

    const { raw } = await sendTurn();

    // A refused connection is not a transient glitch to retry through: the
    // Endpoint has to be started first, and only one message says so.
    expect(failureText(raw)).toMatch(/start ollama/i);
  }, 30_000);

  it("does not retry the message into the failure text", async () => {
    endpointAt(`http://127.0.0.1:${closedPort}/v1`);

    const { raw } = await sendTurn();

    expect(failureText(raw)).not.toMatch(/retry/i);
  }, 30_000);
});

describe("a Credential an Endpoint refuses", () => {
  it("tells the reader to re-enter it in the interface", async () => {
    endpointAt(`${origin}/v1/unauthorized`, { withCredential: true });

    const { raw } = await sendTurn();

    expect(failureText(raw)).toMatch(/credential/i);
    expect(failureText(raw)).toMatch(/re-enter it in the interface/i);
  });

  it("says the same about a Credential that is refused as forbidden", async () => {
    endpointAt(`${origin}/v1/forbidden`, { withCredential: true });

    const { raw } = await sendTurn();

    // 403 and 401 are the same problem to the reader: the key is not accepted.
    expect(failureText(raw)).toMatch(/re-enter it in the interface/i);
  });

  it("is told apart from an unreachable Endpoint, which needs a different fix", async () => {
    endpointAt(`${origin}/v1/unauthorized`, { withCredential: true });
    const refusedCredential = failureText((await sendTurn()).raw);

    endpointAt(`http://127.0.0.1:${closedPort}/v1`);
    const unreachable = failureText((await sendTurn()).raw);

    expect(refusedCredential).not.toBe(unreachable);
  }, 30_000);
});

describe("a Model identifier an Endpoint does not recognise", () => {
  it("tells the reader to pick a different one", async () => {
    endpointAt(`${origin}/v1/unknown-model`);

    const { raw } = await sendTurn();

    expect(failureText(raw)).toMatch(/pick a different one/i);
  });

  it("names the Model identifier that was refused, so the reader knows which", async () => {
    endpointAt(`${origin}/v1/unknown-model`);

    const { raw } = await sendTurn();

    expect(failureText(raw)).toContain("llama3.2");
  });

  it("is told apart from a refused Credential, which needs a different fix", async () => {
    endpointAt(`${origin}/v1/unknown-model`);
    const unknownModel = failureText((await sendTurn()).raw);

    endpointAt(`${origin}/v1/unauthorized`, { withCredential: true });
    const refusedCredential = failureText((await sendTurn()).raw);

    expect(unknownModel).not.toBe(refusedCredential);
  });
});

describe("a Response arriving in a form the app cannot read", () => {
  it("surfaces an error rather than an empty bubble", async () => {
    endpointAt(`${origin}/v1/garbage`);

    const { raw } = await sendTurn();

    // The Endpoint answered, so something is said — the reader is not left
    // looking at a Turn with nothing in it and no reason why.
    expect(failureText(raw)).not.toBe("");
    expect(failureText(raw)).toMatch(/unexpected form/i);
  });

  it("does not present the unreadable body as if it were a Response", async () => {
    endpointAt(`${origin}/v1/garbage`);

    const { raw } = await sendTurn();

    // No text part may reach the interface from a body that was not a stream.
    expect(raw).not.toMatch(/"type":"text-delta"/);
  });
});

/**
 * Every failure the stub can produce, each one echoing the Credential back the
 * way a real provider does when it rejects a request.
 */
const FAILING_MODES = MODES;

/**
 * The Credential must not appear anywhere in what the browser receives.
 *
 * This is the property that makes an error safe to screenshot, so it is
 * asserted against every failure rather than the one that happens to be
 * considered the risky case: a provider echoes a rejected request verbatim, so
 * a single unguarded message would leak the secret through any of them.
 */
describe.each(FAILING_MODES)("a failure from an Endpoint answering %s", (mode) => {
  // A 5xx is retried internally before it surfaces, so these take seconds
  // rather than milliseconds. That is the real behaviour, not slowness to tune.
  const RETRYING_TIMEOUT_MS = 30_000;

  it("never puts the Credential into what the browser receives", async () => {
    endpointAt(`${origin}/v1/${mode}`, { withCredential: true });

    const { raw } = await sendTurn();

    expect(raw).not.toContain(SECRET);
    // The distinctive fragment catches a partially-masked or truncated leak too.
    expect(raw).not.toContain("SECRET-abc123");
  }, RETRYING_TIMEOUT_MS);

  it("still says something, so the reader is not left guessing", async () => {
    endpointAt(`${origin}/v1/${mode}`, { withCredential: true });

    const { raw } = await sendTurn();

    expect(failureText(raw).length).toBeGreaterThan(0);
  }, RETRYING_TIMEOUT_MS);
});

describe("server-side detail", () => {
  it("is not leaked to the browser when the Endpoint reports an internal fault", async () => {
    endpointAt(`${origin}/v1/server-error`, { withCredential: true });

    const { raw } = await sendTurn();

    // The upstream body, the upstream status line, and the SDK's wrapping of
    // both are all the Endpoint's business rather than the reader's.
    expect(failureText(raw)).not.toMatch(/boom/i);
    expect(failureText(raw)).not.toMatch(/Internal Server Error/i);
    expect(failureText(raw)).not.toMatch(/AI_APICallError|Failed after \d+ attempts/i);
  }, 30_000);

  it("keeps a stack trace and a file path out of the browser", async () => {
    endpointAt(`${origin}/v1/server-error`, { withCredential: true });

    const { raw } = await sendTurn();

    expect(raw).not.toMatch(/\.js:\d+|\.ts:\d+|at .*\(.*:\d+:\d+\)/);
    expect(raw).not.toMatch(/node_modules/);
  }, 30_000);

  it("names only the Endpoint's own base URL, not the upstream request path", async () => {
    endpointAt(`${origin}/v1/unauthorized`, { withCredential: true });

    const { raw } = await sendTurn();

    // The chat path and any provider-specific route are the app's plumbing.
    expect(raw).not.toMatch(/chat\/completions/);
  });
});

describe("an Endpoint whose Credential is absent entirely", () => {
  it("is told to re-enter it in the interface, not merely to set a variable", async () => {
    const endpoint = endpointAt(`${origin}/v1/unauthorized`);
    endpoint.credentialEnvVar = "SECRET_PROBE_KEY";
    delete process.env.SECRET_PROBE_KEY;

    const { raw } = await sendTurn();

    expect(failureText(raw)).toMatch(/re-enter it in the interface/i);
  });
});