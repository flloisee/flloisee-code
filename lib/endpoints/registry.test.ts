import { describe, expect, it } from "vitest";

import { ENDPOINT_GROUPS } from "./groups";
import {
  CLOUD_ENDPOINTS,
  ENDPOINTS,
  LOCAL_ENDPOINTS,
  RECOMMENDED_CLOUD_IDS,
  findEndpoint,
  groupOf,
} from "./registry";

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

describe("how the Registry groups Endpoints", () => {
  it("puts Local Endpoints in the Local group and no Cloud Endpoint in it", () => {
    for (const endpoint of LOCAL_ENDPOINTS) {
      expect(groupOf(endpoint), `${endpoint.id} should be local`).toBe("local");
    }
    for (const endpoint of CLOUD_ENDPOINTS) {
      expect(groupOf(endpoint), `${endpoint.id} should not be local`).not.toBe("local");
    }
  });

  it("recommends only names the Catalog actually holds", () => {
    // The failure this guards is a typo: the id would not match anything, the
    // provider would quietly appear under "Cloud (Others)", and the list would
    // claim to recommend nothing while appearing to.
    const cloudIds = new Set(CLOUD_ENDPOINTS.map((endpoint) => endpoint.id));

    for (const id of RECOMMENDED_CLOUD_IDS) {
      expect(cloudIds, `${id} is recommended but absent from the Catalog`).toContain(id);
    }
  });

  it("keeps the recommended group short enough to scan", () => {
    // The point of the grouping is to save a reader scrolling 187 entries. A
    // recommended list that grew to a dozen would be the same list, bigger.
    expect(RECOMMENDED_CLOUD_IDS.size).toBeLessThanOrEqual(10);
  });

  it("puts every recommended Cloud Endpoint in the recommended group", () => {
    for (const id of RECOMMENDED_CLOUD_IDS) {
      expect(groupOf(findEndpoint(id)!), `${id} should be recommended`).toBe("recommended");
    }
  });

  it("sends every other Cloud Endpoint to the others group, so none is lost", () => {
    // Not merely "some are others": every one. An Endpoint dropped from the list
    // would be an Endpoint nobody can choose.
    const ungrouped = CLOUD_ENDPOINTS.filter(
      (endpoint) => groupOf(endpoint) === "others" && !RECOMMENDED_CLOUD_IDS.has(endpoint.id),
    );

    expect(ungrouped.length).toBeGreaterThan(0);
    expect(
      CLOUD_ENDPOINTS.every((endpoint) => groupOf(endpoint) !== undefined),
    ).toBe(true);
  });

  it("orders the groups Local, then Cloud recommended, then Cloud others", () => {
    expect(ENDPOINT_GROUPS.map((group) => group.kind)).toEqual([
      "local",
      "recommended",
      "others",
    ]);
  });
});