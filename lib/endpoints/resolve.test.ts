import { describe, expect, it } from "vitest";

import { findEndpoint } from "./registry";
import { resolveEndpoint } from "./resolve";

describe("resolving an Endpoint for a Request", () => {
  it("resolves a Local Endpoint with no Credential present", () => {
    const endpoint = findEndpoint("ollama");

    const resolved = resolveEndpoint(endpoint!, { OLLAMA_API_KEY: undefined });

    expect(resolved).toEqual({
      ok: true,
      baseURL: "http://localhost:11434/v1",
      apiKey: undefined,
    });
  });

  it("reports a Local Endpoint as Configured even with an empty environment", () => {
    const endpoint = findEndpoint("ollama");

    expect(resolveEndpoint(endpoint!, {}).ok).toBe(true);
  });
});