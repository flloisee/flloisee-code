import { describe, expect, it } from "vitest";

import type { Environment } from "./resolve";
import { describeEndpoints } from "./status";

/**
 * How the interface learns which Endpoints are usable.
 *
 * A Cloud Endpoint with no Credential has to appear and be visibly not
 * Configured: the reader is looking for why a provider they expect is not
 * answering, and a provider missing from the list is a different problem from one
 * missing its key.
 */

function listing(env: Environment) {
  return describeEndpoints(env);
}

describe("which Endpoints are Configured", () => {
  it("marks a Cloud Endpoint whose Credential is present as Configured", () => {
    const entry = listing({ OPENROUTER_API_KEY: "sk-or-v1-a-key" }).find(
      (candidate) => candidate.id === "openrouter",
    );

    expect(entry?.configured).toBe(true);
  });

  it("marks a Cloud Endpoint with no Credential as not Configured, and says why", () => {
    const entry = listing({}).find((candidate) => candidate.id === "openrouter");

    expect(entry?.configured).toBe(false);
    // The variable name is the whole answer to "what do I set?", so it travels
    // with the state rather than being looked up later.
    expect(entry?.credentialEnvVar).toBe("OPENROUTER_API_KEY");
  });

  it("treats an empty Credential as absent, since it cannot authorize anything", () => {
    expect(
      listing({ OPENROUTER_API_KEY: "" }).find((candidate) => candidate.id === "openrouter")
        ?.configured,
    ).toBe(false);
  });

  it("marks a Local Endpoint Configured with no Credential at all", () => {
    const entry = listing({}).find((candidate) => candidate.id === "ollama");

    expect(entry?.configured).toBe(true);
    // Null rather than an empty name: the reader is told there is no variable to
    // set, not handed a blank one to put a Credential in.
    expect(entry?.credentialEnvVar).toBeNull();
  });

  it("keeps an unconfigured Cloud Endpoint in the list rather than hiding it", () => {
    const ids = listing({}).map((entry) => entry.id);

    expect(ids).toContain("openrouter");
    expect(ids).toContain("ollama");
  });

  it("reads each Endpoint's own variable, so one key does not Configure another", () => {
    const entries = listing({ DEEPSEEK_API_KEY: "sk-a-key" });

    expect(entries.find((entry) => entry.id === "deepseek")?.configured).toBe(true);
    expect(entries.find((entry) => entry.id === "openrouter")?.configured).toBe(false);
  });

  it("carries no Credential value out, only whether one is present", () => {
    const entry = listing({ OPENROUTER_API_KEY: "sk-or-v1-secret" }).find(
      (candidate) => candidate.id === "openrouter",
    );

    // The value stays on the server. The interface needs to know which variable
    // to set, never what is in it.
    expect(JSON.stringify(entry)).not.toContain("sk-or-v1-secret");
  });
});