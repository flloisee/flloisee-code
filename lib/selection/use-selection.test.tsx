// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ENDPOINT_STORAGE_KEY, MODEL_CHOICES_STORAGE_KEY } from "@/lib/selection/store";
import { useSelection } from "@/lib/selection/use-selection";

/**
 * Drives the hook against jsdom's own localStorage, so what is asserted is what
 * a later visit would find rather than a mock's idea of it.
 */

const OLLAMA = "ollama";
const LMSTUDIO = "lmstudio";
const GROQ = "groq";

/** Puts a value in storage as though an earlier visit had left it there. */
function stored(key: string, value: string) {
  window.localStorage.setItem(key, value);
}

/** A change another window made, or this one announcing its own. Null is a whole-origin clear. */
function changed(key: string | null, newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("coming back to the app", () => {
  it("opens on the Endpoint remembered last time", () => {
    stored(ENDPOINT_STORAGE_KEY, GROQ);

    const { result } = renderHook(() => useSelection(OLLAMA));

    expect(result.current.endpointId).toBe(GROQ);
  });

  it("opens on the app's own Endpoint when nothing was remembered", () => {
    const { result } = renderHook(() => useSelection(OLLAMA));

    expect(result.current.endpointId).toBe(OLLAMA);
    expect(result.current.models).toEqual({});
  });

  it("opens on the app's own Endpoint for a choice this build does not offer", () => {
    // A reader upgrading carries ids for Endpoints an older Catalog had, and
    // being handed Ollama beats being handed an Endpoint that cannot answer.
    stored(ENDPOINT_STORAGE_KEY, "retired-cloud");

    const { result } = renderHook(() => useSelection(OLLAMA));

    expect(result.current.endpointId).toBe(OLLAMA);
  });

  it("keeps the Model chosen in each Endpoint", () => {
    stored(MODEL_CHOICES_STORAGE_KEY, JSON.stringify({ ollama: "qwen2.5-coder:7b" }));

    const { result } = renderHook(() => useSelection(OLLAMA));

    expect(result.current.models).toEqual({ ollama: "qwen2.5-coder:7b" });
  });

  it("opens on what was remembered however unusable the stored value is", () => {
    // Storage is shared across versions and editable by hand, so every one of
    // these is a thing that will genuinely come back rather than a shape to
    // guard against on principle. None of them may throw into a render.
    for (const value of ["{oops", "[]", "null", "", '{"ollama":7}']) {
      stored(ENDPOINT_STORAGE_KEY, value);
      stored(MODEL_CHOICES_STORAGE_KEY, value);

      const { result } = renderHook(() => useSelection(OLLAMA));
      expect(result.current.endpointId).toBe(OLLAMA);
      expect(result.current.models).toEqual({});

      window.localStorage.clear();
    }
  });
});

describe("choosing again", () => {
  it("keeps the Endpoint for the next visit", () => {
    const { result } = renderHook(() => useSelection(OLLAMA));

    act(() => result.current.chooseEndpoint(GROQ));

    expect(result.current.endpointId).toBe(GROQ);
    expect(window.localStorage.getItem(ENDPOINT_STORAGE_KEY)).toBe(GROQ);
  });

  it("keeps the Model chosen in one Endpoint without disturbing the others", () => {
    const { result } = renderHook(() => useSelection(OLLAMA));

    act(() => result.current.chooseModel(OLLAMA, "qwen2.5-coder:7b"));
    act(() => result.current.chooseEndpoint(LMSTUDIO));
    act(() => result.current.chooseModel(LMSTUDIO, "local-model"));

    expect(result.current.models).toEqual({
      ollama: "qwen2.5-coder:7b",
      lmstudio: "local-model",
    });

    // Going back to an Endpoint restores the Model chosen there, which is the
    // reason the choices are keyed by Endpoint at all.
    act(() => result.current.chooseEndpoint(OLLAMA));
    expect(result.current.endpointId).toBe(OLLAMA);
    expect(result.current.models.ollama).toBe("qwen2.5-coder:7b");
  });

  it("survives a reload", () => {
    const { result, unmount } = renderHook(() => useSelection(OLLAMA));

    act(() => result.current.chooseEndpoint(GROQ));
    act(() => result.current.chooseModel(GROQ, "llama-3.3-70b-versatile"));

    unmount();

    // What a later visit reads: a fresh mount, nothing carried over in memory.
    const next = renderHook(() => useSelection(OLLAMA));
    expect(next.result.current.endpointId).toBe(GROQ);
    expect(next.result.current.models).toEqual({ groq: "llama-3.3-70b-versatile" });
  });

  it("keeps a blank Model from overwriting the one already chosen", () => {
    const { result } = renderHook(() => useSelection(OLLAMA));

    act(() => result.current.chooseModel(OLLAMA, "kept-model"));
    act(() => result.current.chooseModel(OLLAMA, "   "));

    expect(result.current.models).toEqual({ ollama: "kept-model" });
  });

  it("does not store the Endpoint it opened on until it is actually chosen", () => {
    // Otherwise every visit would write the default back, and a reader who
    // erased the stored choice would find it written again on their next visit.
    renderHook(() => useSelection(OLLAMA));

    expect(window.localStorage.getItem(ENDPOINT_STORAGE_KEY)).toBeNull();
  });
});

describe("another window changing the choice", () => {
  it("follows a change to the Endpoint", () => {
    const { result } = renderHook(() => useSelection(OLLAMA));

    changed(ENDPOINT_STORAGE_KEY, GROQ);

    expect(result.current.endpointId).toBe(GROQ);
  });

  it("follows a change to the Model choices", () => {
    const { result } = renderHook(() => useSelection(OLLAMA));

    changed(MODEL_CHOICES_STORAGE_KEY, JSON.stringify({ ollama: "chosen-elsewhere" }));

    expect(result.current.models).toEqual({ ollama: "chosen-elsewhere" });
  });

  it("goes back to the app's own Endpoint when the choice is erased", () => {
    const { result } = renderHook(() => useSelection(OLLAMA));

    changed(ENDPOINT_STORAGE_KEY, GROQ);
    changed(ENDPOINT_STORAGE_KEY, null);

    expect(result.current.endpointId).toBe(OLLAMA);
  });

  it("goes back to the app's own Endpoint when storage is cleared outright", () => {
    // A null key is one window clearing the whole origin, which moves both of
    // these at once rather than naming a key.
    const { result } = renderHook(() => useSelection(OLLAMA));

    changed(ENDPOINT_STORAGE_KEY, GROQ);
    changed(MODEL_CHOICES_STORAGE_KEY, JSON.stringify({ groq: "a-model" }));
    changed(null, null);

    expect(result.current.endpointId).toBe(OLLAMA);
    expect(result.current.models).toEqual({});
  });

  it("ignores a change to some other preference", () => {
    // The Theme shares this storage, and so does every other app on the origin.
    const { result } = renderHook(() => useSelection(OLLAMA));

    changed("multi-endpoint-chat.theme", "dark");
    changed("some-other-app.preference", "whatever");

    expect(result.current.endpointId).toBe(OLLAMA);
    expect(result.current.models).toEqual({});
  });
});
