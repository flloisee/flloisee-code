import { describe, expect, it } from "vitest";

import { CLOUD_ENDPOINTS, findEndpoint } from "./registry";
import { resolveEndpoint } from "./resolve";

/** Variable names more than one Catalog entry reads, i.e. one Credential listed twice. */
const sharedCredentialVars = new Set(
  CLOUD_ENDPOINTS.map((endpoint) => endpoint.credentialEnvVar).filter((name, at, all) =>
    all.indexOf(name) !== at,
  ),
);

describe("resolving an Endpoint for a Request", () => {
  it("resolves a Local Endpoint with no Credential present", () => {
    const endpoint = findEndpoint("ollama");

    const resolved = resolveEndpoint(endpoint!, { OLLAMA_API_KEY: undefined });

    expect(resolved).toEqual({
      ok: true,
      baseURL: "http://localhost:11434/v1",
      credential: undefined,
    });
  });

  it("reports a Local Endpoint as Configured even with an empty environment", () => {
    const endpoint = findEndpoint("ollama");

    expect(resolveEndpoint(endpoint!, {}).ok).toBe(true);
  });

  it("Configures exactly one Endpoint from one Credential, so its value goes one place", () => {
    // The fan-out this guards against: entering one variable through Key Entry
    // Configured four Endpoints and proxied the value to two companies'
    // servers at once. A reader who chose one Endpoint must not have their
    // Credential sent to another they never picked.
    //
    // Local Endpoints are Configured with no Credential at all and receive no
    // value, so they are out of question here. Two Cloud Endpoints may share a
    // variable when they are the same service at the same address
    // (llmgateway, opencode): that is one Credential going one place, twice
    // listed.
    for (const endpoint of CLOUD_ENDPOINTS) {
      const env = { [endpoint.credentialEnvVar]: "one-credential" };

      const configured = CLOUD_ENDPOINTS.filter((other) => resolveEndpoint(other, env).ok);
      const reached = new Set(configured.map((other) => new URL(other.baseURL).host));

      expect([...reached], `${endpoint.credentialEnvVar} reached ${reached.size} hosts`).toEqual([
        new URL(endpoint.baseURL).host,
      ]);

      if (!sharedCredentialVars.has(endpoint.credentialEnvVar)) {
        expect(
          configured.map((other) => other.id),
          `${endpoint.credentialEnvVar} Configured ${configured.length} Endpoints`,
        ).toEqual([endpoint.id]);
      }
    }
  });

  it("shares a variable only between entries of the one service", () => {
    // The stricter form holds everywhere but those two, which are the same
    // service at the same address under two names in the Catalog.
    expect([...sharedCredentialVars].sort()).toEqual(["LLMGATEWAY_API_KEY", "OPENCODE_API_KEY"]);
  });
});