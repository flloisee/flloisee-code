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
 *
 * Read against a directory with no `.endpoints.json` in it, so these cover the
 * Catalog alone and the declared Endpoints are covered by their own tests.
 */

/** A directory that has never had an Endpoint declared in it. */
const NO_DECLARATIONS = "/nonexistent-directory-for-this-test";

async function listing(env: Environment) {
  return (await describeEndpoints(env, NO_DECLARATIONS)).statuses;
}

async function declaredTrouble(env: Environment) {
  return (await describeEndpoints(env, NO_DECLARATIONS)).declaredTrouble;
}

describe("which Endpoints are Configured", () => {
  it("marks a Cloud Endpoint whose Credential is present as Configured", async () => {
    const entry = (await listing({ OPENROUTER_API_KEY: "sk-or-v1-a-key" })).find(
      (candidate) => candidate.id === "openrouter",
    );

    expect(entry?.configured).toBe(true);
  });

  it("marks a Cloud Endpoint with no Credential as not Configured, and says why", async () => {
    const entry = (await listing({})).find((candidate) => candidate.id === "openrouter");

    expect(entry?.configured).toBe(false);
    // The variable name is the whole answer to "what do I set?", so it travels
    // with the state rather than being looked up later.
    expect(entry?.credentialEnvVar).toBe("OPENROUTER_API_KEY");
  });

  it("treats an empty Credential as absent, since it cannot authorize anything", async () => {
    expect(
      (await listing({ OPENROUTER_API_KEY: "" })).find((candidate) => candidate.id === "openrouter")
        ?.configured,
    ).toBe(false);
  });

  it("marks a Local Endpoint Configured with no Credential at all", async () => {
    const entry = (await listing({})).find((candidate) => candidate.id === "ollama");

    expect(entry?.configured).toBe(true);
    // Null rather than an empty name: the reader is told there is no variable to
    // set, not handed a blank one to put a Credential in.
    expect(entry?.credentialEnvVar).toBeNull();
  });

  it("keeps an unconfigured Cloud Endpoint in the list rather than hiding it", async () => {
    const ids = (await listing({})).map((entry) => entry.id);

    expect(ids).toContain("openrouter");
    expect(ids).toContain("ollama");
  });

  it("reads each Endpoint's own variable, so one key does not Configure another", async () => {
    const entries = await listing({ DEEPSEEK_API_KEY: "sk-a-key" });

    expect(entries.find((entry) => entry.id === "deepseek")?.configured).toBe(true);
    expect(entries.find((entry) => entry.id === "openrouter")?.configured).toBe(false);
  });

  it("carries no Credential value out, only whether one is present", async () => {
    const entry = (await listing({ OPENROUTER_API_KEY: "sk-or-v1-secret" })).find(
      (candidate) => candidate.id === "openrouter",
    );

    // The value stays on the server. The interface needs to know which variable
    // to set, never what is in it.
    expect(JSON.stringify(entry)).not.toContain("sk-or-v1-secret");
  });

  it("carries each Endpoint's starting Model, which the browser cannot work out", async () => {
    const entries = await listing({});

    expect(entries.find((entry) => entry.id === "ollama")?.defaultModelId).toBe("llama3.2");
  });

  it("says nothing is wrong with the file when there is no file", async () => {
    // A machine on which nothing has been declared is the ordinary case, and
    // must not be reported as a problem the reader has to act on.
    expect(await declaredTrouble({})).toBeNull();
  });
});