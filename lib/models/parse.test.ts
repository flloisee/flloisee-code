import { describe, expect, it } from "vitest";

import { parseModelIdentifiers } from "./parse";

/**
 * Payloads below are the shapes real servers return, not shapes this app
 * invents: OpenAI's `{"object":"list","data":[{"id":...}]}`, which Ollama's
 * `/v1/models` and LM Studio's server both speak, and Ollama's native tags
 * shape, which uses `models[].name`.
 */

describe("reading Model identifiers off a models listing", () => {
  it("reads the identifiers from an OpenAI-compatible listing", () => {
    const listing = {
      object: "list",
      data: [
        { id: "llama3.2:latest", object: "model", created: 1, owned_by: "library" },
        { id: "qwen2.5-coder:7b", object: "model", created: 2, owned_by: "library" },
      ],
    };

    expect(parseModelIdentifiers(listing)).toEqual(["llama3.2:latest", "qwen2.5-coder:7b"]);
  });

  it("reads the identifiers from Ollama's native tags listing", () => {
    const listing = {
      models: [
        { name: "llama3.2:latest", size: 2019393189 },
        { name: "nomic-embed-text:latest", size: 274302450 },
      ],
    };

    expect(parseModelIdentifiers(listing)).toEqual(["llama3.2:latest", "nomic-embed-text:latest"]);
  });

  it("reads a bare array of identifiers, which some servers return", () => {
    expect(parseModelIdentifiers(["mistral-small", "phi-4"])).toEqual(["mistral-small", "phi-4"]);
  });

  it("reports an Endpoint offering nothing as no identifiers at all", () => {
    expect(parseModelIdentifiers({ object: "list", data: [] })).toEqual([]);
  });

  it("keeps the order the Endpoint listed its Models in", () => {
    // The order is the Endpoint's, and re-sorting it would be our opinion
    // about a list we did not produce.
    const listing = { data: [{ id: "zeta" }, { id: "alpha" }, { id: "mu" }] };

    expect(parseModelIdentifiers(listing)).toEqual(["zeta", "alpha", "mu"]);
  });

  it("keeps a Model listed twice once, so the list offers no duplicate choices", () => {
    const listing = { data: [{ id: "llama3.2:latest" }, { id: "llama3.2:latest" }] };

    expect(parseModelIdentifiers(listing)).toEqual(["llama3.2:latest"]);
  });

  it("skips entries carrying no identifier rather than offering a blank choice", () => {
    const listing = { data: [{ id: "llama3.2:latest" }, { object: "model" }, { id: "  " }, null] };

    expect(parseModelIdentifiers(listing)).toEqual(["llama3.2:latest"]);
  });

  it("reads nothing from a listing it does not recognise", () => {
    // An Endpoint may answer its models path with something other than a
    // listing — an HTML error page, a health check. Falling back to a typed
    // identifier is the right outcome; inventing identifiers is not.
    expect(parseModelIdentifiers("<!doctype html><html>")).toEqual([]);
    expect(parseModelIdentifiers(null)).toEqual([]);
    expect(parseModelIdentifiers({ detail: "not found" })).toEqual([]);
  });
});