import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/endpoints/route";

/**
 * What the interface is told about the Registry.
 *
 * Two things matter here beyond the listing itself: an Endpoint with no
 * Credential has to be reported rather than withheld, and no address ever comes
 * from the request — the Catalog decides where a Credential goes, and a request
 * that could name the destination would be able to redirect it.
 */

/**
 * The Route Handler as Next calls it.
 *
 * Cast because the handler takes no Request at all — the type records that
 * deliberate choice, while the call still passes one the way Next does. An extra
 * argument is ignored, which is the property the last test below relies on.
 */
const callRoute = () => POST(...([new Request("http://localhost/api/endpoints", { method: "POST" })] as unknown as []));

async function listing(env: Record<string, string> = {}) {
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  try {
    const response = await callRoute();
    return { status: response.status, body: await response.json() };
  } finally {
    for (const name of Object.keys(env)) delete process.env[name];
  }
}

type Entry = { id: string; name: string; credentialEnvVar: string | null; configured: boolean };

async function entries(env: Record<string, string> = {}): Promise<Entry[]> {
  const { body } = await listing(env);
  return body.endpoints;
}

describe("the Endpoint listing Route Handler", () => {
  it("offers Local Endpoints and Cloud Endpoints in one list", async () => {
    const ids = (await entries()).map((entry) => entry.id);

    expect(ids).toContain("ollama");
    expect(ids).toContain("openrouter");
  });

  it("lists a Cloud Endpoint with no Credential, marked not Configured", async () => {
    const entry = (await entries()).find((candidate) => candidate.id === "openrouter");

    // The absence has to be visible: a provider missing from the list and a
    // provider missing its key are different problems to go and fix.
    expect(entry).toBeDefined();
    expect(entry?.configured).toBe(false);
  });

  it("names the environment variable each Cloud Endpoint needs", async () => {
    const entry = (await entries()).find((candidate) => candidate.id === "openrouter");

    expect(entry?.credentialEnvVar).toBe("OPENROUTER_API_KEY");
  });

  it("marks an Endpoint Configured once its Credential is present", async () => {
    const entry = (await entries({ OPENROUTER_API_KEY: "sk-or-v1-a-key" })).find(
      (candidate) => candidate.id === "openrouter",
    );

    expect(entry?.configured).toBe(true);
  });

  it("never returns a Credential value, only which variable holds it", async () => {
    const { body } = await listing({ OPENROUTER_API_KEY: "sk-or-v1-secret" });

    expect(JSON.stringify(body)).not.toContain("sk-or-v1-secret");
  });

  it("ignores a base URL supplied in the request rather than acting on it", async () => {
    // The Catalog is what decides where a Credential is sent. A request naming
    // its own address could redirect one, so the route reads no body at all.
    const response = await POST(
      ...([
        new Request("http://localhost/api/endpoints", {
          method: "POST",
          body: JSON.stringify({ endpointId: "openrouter", baseURL: "https://evil.example/v1" }),
        }),
      ] as unknown as []),
    );
    const body = await response.json();

    const entry = (body.endpoints as Entry[]).find((candidate) => candidate.id === "openrouter");
    expect(entry?.configured).toBe(false);
    expect(JSON.stringify(body)).not.toContain("evil.example");
  });
});