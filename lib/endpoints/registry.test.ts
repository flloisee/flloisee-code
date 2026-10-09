import { describe, expect, it } from "vitest";

import { CLOUD_ENDPOINTS, ENDPOINTS, LOCAL_ENDPOINTS, findEndpoint } from "./registry";

/**
 * The Registry is one list, whatever an Endpoint's origin. These assert what a
 * reader reaches for: that Ollama is offered, that a Cloud Endpoint with no
 * Credential yet is still listed, and that every entry says which environment
 * variable it needs.
 */

describe("the Registry of Endpoints", () => {
  it("offers Ollama at its conventional address alongside a Model identifier", () => {
    const ollama = findEndpoint("ollama");

    expect(ollama?.baseURL).toBe("http://localhost:11434/v1");
    expect(ollama?.defaultModelId).toBeTruthy();
  });

  it("needs no Credential, so a Local Endpoint is always available to hold a Conversation", () => {
    expect(findEndpoint("ollama")?.credentialEnvVar).toBeUndefined();
  });

  it("offers LM Studio at its conventional address, so a second local server works with no setup", () => {
    const lmStudio = findEndpoint("lmstudio");

    expect(lmStudio?.baseURL).toBe("http://127.0.0.1:1234/v1");
    expect(lmStudio?.defaultModelId).toBeTruthy();
  });

  it("needs no Credential for LM Studio either, since it runs on this machine", () => {
    // The spec names both Ollama and LM Studio as Local Endpoints usable the
    // moment their server is running. Neither should ever ask for a key.
    for (const local of LOCAL_ENDPOINTS) {
      expect(local.credentialEnvVar, `${local.id} asks for a Credential`).toBeUndefined();
    }
  });

  it("reports an unknown Endpoint id rather than failing obscurely", () => {
    expect(findEndpoint("not-an-endpoint")).toBeUndefined();
  });

  it("offers Local Endpoints alongside Cloud Endpoints rather than separately", () => {
    const ids = ENDPOINTS.map((endpoint) => endpoint.id);

    expect(ids).toContain("ollama");
    expect(ids).toContain("lmstudio");
    expect(ids).toContain("openrouter");
  });

  it("lists a Cloud Endpoint that has no Credential yet, so its absence is diagnosable", () => {
    // No environment is consulted here: an Endpoint that is missing its
    // Credential stays in the list, and the interface says which variable to set.
    const openrouter = ENDPOINTS.find((endpoint) => endpoint.id === "openrouter");

    expect(openrouter).toBeDefined();
    expect(openrouter?.baseURL).toBe("https://openrouter.ai/api/v1");
  });

  it("names the environment variable every Cloud Endpoint needs, so setup needs no source", () => {
    const cloudIds = new Set(CLOUD_ENDPOINTS.map((endpoint) => endpoint.id));
    const cloud = ENDPOINTS.filter((endpoint) => cloudIds.has(endpoint.id));

    expect(cloud.length).toBe(CLOUD_ENDPOINTS.length);
    expect(cloud.every((endpoint) => (endpoint.credentialEnvVar ?? "").length > 0)).toBe(true);
  });

  it("gives every Cloud Endpoint a base URL and a documentation link", () => {
    for (const endpoint of CLOUD_ENDPOINTS) {
      expect(endpoint.baseURL, `${endpoint.id} has no base URL`).toMatch(/^https:\/\//);
      expect(endpoint.doc, `${endpoint.id} has no documentation link`).toMatch(/^https:\/\//);
    }
  });

  it("offers Gemini and OpenAI, whose providers publish their own SDKs", () => {
    // Neither is flagged by models.dev as OpenAI-compatible, so both are written
    // into the Catalog by hand. They are the first two anyone reaches for.
    expect(findEndpoint("google")?.baseURL).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai",
    );
    expect(findEndpoint("openai")?.baseURL).toBe("https://api.openai.com/v1");
  });

  it("gives every Endpoint a Model to start from, since a Conversation needs one", () => {
    for (const endpoint of ENDPOINTS) {
      expect(endpoint.defaultModelId, `${endpoint.id} has no starting Model`).toBeTruthy();
    }
  });

  it("carries no two Endpoints under one id", () => {
    const ids = ENDPOINTS.map((endpoint) => endpoint.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps Local Endpoints out of the Catalog, which covers cloud providers only", () => {
    // Every Catalog entry is a third party reached over the network. Ollama is
    // absent from models.dev entirely and LM Studio is dropped there as
    // loopback, so both are declared by hand.
    expect(CLOUD_ENDPOINTS.every((endpoint) => endpoint.baseURL.startsWith("https://"))).toBe(true);
    expect(CLOUD_ENDPOINTS.map((endpoint) => endpoint.id)).not.toContain("ollama");
    expect(CLOUD_ENDPOINTS.map((endpoint) => endpoint.id)).not.toContain("lmstudio");
    expect(LOCAL_ENDPOINTS.map((endpoint) => endpoint.id)).toEqual(["ollama", "lmstudio"]);
  });
});