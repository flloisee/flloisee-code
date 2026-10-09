import { describe, expect, it } from "vitest";

import { rememberModel, selectedModel } from "./selection";

describe("which Model is selected in each Endpoint", () => {
  it("starts from the Model the Endpoint declares, until a choice is made", () => {
    const ollamaDefault = "llama3.2";

    expect(selectedModel({}, "ollama", ollamaDefault)).toBe("llama3.2");
    expect(ollamaDefault).toBe("llama3.2");
  });

  it("keeps the chosen Model when I switch away and come back", () => {
    const chosen = rememberModel({}, "ollama", "qwen2.5-coder:7b");

    // Another Endpoint is selected and used in between...
    const afterElsewhere = rememberModel(chosen, "lmstudio", "local-model");

    // ...and coming back to Ollama shows what I last chose there, not the default.
    expect(selectedModel(afterElsewhere, "ollama", "llama3.2")).toBe("qwen2.5-coder:7b");
    expect(selectedModel(afterElsewhere, "lmstudio", "default-model")).toBe("local-model");
  });

  it("keeps a Model I typed by hand, not only one picked from the discovered list", () => {
    const chosen = rememberModel({}, "ollama", "some-model-discovery-did-not-list");

    expect(selectedModel(chosen, "ollama", "llama3.2")).toBe("some-model-discovery-did-not-list");
  });

  it("falls back to the declared Model for an Endpoint I have not chosen one for", () => {
    const chosen = rememberModel({}, "ollama", "qwen2.5-coder:7b");

    expect(selectedModel(chosen, "lmstudio", "local-model")).toBe("local-model");
  });

  it("ignores an empty choice, so clearing the field cannot erase the Model", () => {
    const chosen = rememberModel({}, "ollama", "qwen2.5-coder:7b");

    // An empty Model would be sent to the Endpoint and rejected there, losing
    // the identifier the user already chose.
    const afterClearing = rememberModel(chosen, "ollama", "   ");

    expect(selectedModel(afterClearing, "ollama", "llama3.2")).toBe("qwen2.5-coder:7b");
  });

  it("does not change other Endpoints when one is changed", () => {
    const first = rememberModel({}, "ollama", "llama3.2:latest");
    const second = rememberModel(first, "lmstudio", "qwen3:8b");

    expect(selectedModel(second, "ollama", "llama3.2")).toBe("llama3.2:latest");
  });
});