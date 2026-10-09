import { createServer } from "node:http";
import { beforeAll, describe, expect, it } from "vitest";

import * as modelsRoute from "@/app/api/models/route";
import { findEndpoint } from "@/lib/endpoints/registry";

const { POST } = modelsRoute;

/**
 * Points the declared Endpoint at an address where nothing listens, rather than
 * at its real one. Whether a developer happens to have Ollama running must not
 * decide whether this suite passes; an Endpoint that is not running is the
 * state these tests need, so one is arranged deliberately.
 */
const silent = createServer();

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      // Bound just long enough to claim a port nothing is using, then released
      // so that nothing is listening there for the tests below.
      silent.listen(0, "127.0.0.1", () => {
        const address = silent.address();
        const port = typeof address === "object" && address ? address.port : 0;
        silent.close(() => {
          findEndpoint("ollama")!.baseURL = `http://127.0.0.1:${port}/v1`;
          resolve();
        });
      });
    }),
);

function modelsRequest(body: unknown): Request {
  return new Request("http://localhost/api/models", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("the Model Discovery route", () => {
  it("rejects an unknown Endpoint id by name, so the cause is obvious", async () => {
    const response = await POST(modelsRequest({ endpointId: "nope" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("nope"),
    });
  });

  it("rejects a request naming no Endpoint", async () => {
    const response = await POST(modelsRequest({}));

    expect(response.status).toBe(400);
  });

  it("rejects a request that is not JSON at all", async () => {
    const response = await POST(
      new Request("http://localhost/api/models", { method: "POST", body: "nonsense" }),
    );

    expect(response.status).toBe(400);
  });

  it("discovers against a Local Endpoint carrying no Credential", async () => {
    // Nothing is running on the Registry's declared address, so discovery
    // reaches Proxying and reports the Endpoint as unreachable. That it gets
    // that far at all is the point: a Local Endpoint needs no Credential to be
    // asked what it has.
    expect(findEndpoint("ollama")?.credentialEnvVar).toBeUndefined();

    const response = await POST(modelsRequest({ endpointId: "ollama" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      endpointId: "ollama",
      result: { status: "unreachable" },
    });
  });

  it("never returns a Credential, so a discovery answer is safe to display", async () => {
    const response = await POST(modelsRequest({ endpointId: "ollama" }));

    const body = JSON.stringify(await response.json());

    expect(body.toLowerCase()).not.toContain("apikey");
    expect(body.toLowerCase()).not.toContain("api_key");
    expect(body.toLowerCase()).not.toContain("authorization");
  });

  it("is answered by a POST alone, since a GET would be prerendered per Endpoint", () => {
    // With Cache Components enabled a GET Route Handler follows the prerender
    // model of a page: one Endpoint's Models would be frozen at build time and
    // served for every Endpoint — a silent wrong answer rather than a visible
    // failure. Only a POST avoids that, so no GET is exported at all.
    expect("GET" in modelsRoute).toBe(false);
    expect(typeof modelsRoute.POST).toBe("function");
  });
});