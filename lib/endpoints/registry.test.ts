import { describe, expect, it } from "vitest";

import { LOCAL_ENDPOINTS, findEndpoint } from "./registry";

describe("the Registry of Local Endpoints", () => {
  it("declares Ollama at its conventional address alongside a Model identifier", () => {
    const ollama = findEndpoint("ollama");

    expect(ollama?.baseURL).toBe("http://localhost:11434/v1");
    expect(ollama?.defaultModelId).toBeTruthy();
  });

  it("needs no Credential, so a Local Endpoint is always available to hold a Conversation", () => {
    const ollama = findEndpoint("ollama");

    expect(ollama?.credentialEnvVar).toBeUndefined();
  });

  it("reports an unknown Endpoint id rather than failing obscurely", () => {
    expect(findEndpoint("not-an-endpoint")).toBeUndefined();
  });

  it("offers Ollama without it appearing in any Catalog", () => {
    expect(LOCAL_ENDPOINTS.map((endpoint) => endpoint.id)).toEqual(["ollama"]);
  });
});