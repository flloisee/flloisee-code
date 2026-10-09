import { describe, expect, it } from "vitest";

import {
  ENDPOINT_STORAGE_KEY,
  MODEL_CHOICES_STORAGE_KEY,
  parseChosenEndpoint,
  parseModelChoices,
  readChosenEndpoint,
  readModelChoices,
  storedValue,
  writeChosenEndpoint,
  writeModelChoices,
  writeStoredValue,
} from "./store";

/**
 * A Storage stand-in holding whatever it was built with, and recording what is
 * written to it — which is all these functions ask of storage.
 */
function storageHolding(entries: Record<string, string | null> = {}) {
  const held = new Map(Object.entries(entries));
  const written: [string, string][] = [];

  return {
    written,
    held,
    getItem: (key: string) => (held.has(key) ? (held.get(key) as string | null) : null),
    setItem: (key: string, value: string) => {
      held.set(key, value);
      written.push([key, value]);
    },
  };
}

describe("reading the chosen Endpoint", () => {
  it("opens on the Endpoint the app opens on when nothing was chosen", () => {
    // Ollama, because it needs no Credential and is the app's way of being
    // usable before anything has been set up.
    expect(readChosenEndpoint(storageHolding(), "ollama")).toBe("ollama");
    expect(readChosenEndpoint(storageHolding({ [ENDPOINT_STORAGE_KEY]: null }), "ollama")).toBe(
      "ollama",
    );
  });

  it("opens on the Endpoint the reader chose earlier", () => {
    const storage = storageHolding({ [ENDPOINT_STORAGE_KEY]: "lmstudio" });

    expect(readChosenEndpoint(storage, "ollama")).toBe("lmstudio");
  });

  it("falls back for an Endpoint this build does not offer", () => {
    // Storage outlives the version that wrote it, and the Catalog is edited by
    // hand, so an id for an Endpoint that has since been removed comes back
    // genuinely rather than theoretically. Carried through unchecked it would
    // leave the Conversation on an Endpoint with no name and no starting Model.
    expect(readChosenEndpoint(storageHolding({ [ENDPOINT_STORAGE_KEY]: "retired-cloud" }), "ollama")).toBe(
      "ollama",
    );
    expect(readChosenEndpoint(storageHolding({ [ENDPOINT_STORAGE_KEY]: "  " }), "ollama")).toBe("ollama");
    expect(readChosenEndpoint(storageHolding({ [ENDPOINT_STORAGE_KEY]: "OLLAMA" }), "ollama")).toBe(
      "ollama",
    );
  });

  it("still opens when storage refuses to be read", () => {
    // Some browsers throw merely on touching localStorage, so the access itself
    // is inside the guarded region rather than only the parse.
    const refused = {
      getItem() {
        throw new Error("storage disabled");
      },
    };

    expect(readChosenEndpoint(refused, "ollama")).toBe("ollama");
    expect(readChosenEndpoint(null, "ollama")).toBe("ollama");
    expect(readChosenEndpoint(undefined, "ollama")).toBe("ollama");
  });

  it("reads only its own key", () => {
    // The Preference Store holds the Theme as well, and one preference changing
    // is not another.
    const storage = storageHolding({ "multi-endpoint-chat.theme": "dark" });

    expect(readChosenEndpoint(storage, "ollama")).toBe("ollama");
  });
});

describe("reading the Model choices", () => {
  it("starts empty, so each Endpoint uses the Model it declares", () => {
    expect(readModelChoices(storageHolding())).toEqual({});
    expect(readModelChoices(storageHolding({ [MODEL_CHOICES_STORAGE_KEY]: "" }))).toEqual({});
  });

  it("keeps the Model chosen in each Endpoint", () => {
    const storage = storageHolding({
      [MODEL_CHOICES_STORAGE_KEY]: JSON.stringify({
        ollama: "qwen2.5-coder:7b",
        lmstudio: "local-model",
      }),
    });

    expect(readModelChoices(storage)).toEqual({
      ollama: "qwen2.5-coder:7b",
      lmstudio: "local-model",
    });
  });

  it("keeps a Model discovery did not list", () => {
    // Not checked against the Endpoint's current list on the way in: a Model
    // that has been unloaded is the reader's to keep, and one the Endpoint no
    // longer recognises is reported by name when it rejects the Request.
    const storage = storageHolding({
      [MODEL_CHOICES_STORAGE_KEY]: JSON.stringify({ ollama: "unloaded-model" }),
    });

    expect(readModelChoices(storage)).toEqual({ ollama: "unloaded-model" });
  });

  it("drops what is not a map of Endpoints to Models", () => {
    // Hand-edited or truncated storage is untrusted input, so each value is held
    // to the shape it was written as and the rest of the map is kept.
    expect(readModelChoices(storageHolding({ [MODEL_CHOICES_STORAGE_KEY]: "{oops" }))).toEqual({});
    expect(readModelChoices(storageHolding({ [MODEL_CHOICES_STORAGE_KEY]: "[]" }))).toEqual({});
    expect(readModelChoices(storageHolding({ [MODEL_CHOICES_STORAGE_KEY]: '"a model"' }))).toEqual({});
    expect(readModelChoices(storageHolding({ [MODEL_CHOICES_STORAGE_KEY]: "null" }))).toEqual({});
    expect(readModelChoices(storageHolding({ [MODEL_CHOICES_STORAGE_KEY]: "42" }))).toEqual({});

    const mixed = readModelChoices(
      storageHolding({
        [MODEL_CHOICES_STORAGE_KEY]: JSON.stringify({
          ollama: "kept-model",
          lmstudio: 7,
          groq: null,
          openai: ["nested"],
          deepseek: "   ",
        }),
      }),
    );

    expect(mixed).toEqual({ ollama: "kept-model" });
  });

  it("does not let a stored key reach the prototype of the map", () => {
    // `__proto__` is an ordinary key in a JSON object, and assigning it onto an
    // object literal would set the prototype of the map instead of adding an
    // entry to it — the whole map then reads as whatever it was set to.
    const poisoned = readModelChoices(
      storageHolding({
        [MODEL_CHOICES_STORAGE_KEY]: '{"__proto__": "smuggled", "ollama": "kept-model"}',
      }),
    );

    expect(poisoned.ollama).toBe("kept-model");
    expect(({} as Record<string, unknown>).smuggled).toBeUndefined();
    expect(Object.getPrototypeOf(poisoned)).toBe(Object.prototype);
  });

  it("refuses a value far larger than any map this app writes", () => {
    // Parsed on a read that happens on every visit, so a hand-edited megabyte
    // is not worth the parse. One Model identifier per Endpoint is hundreds of
    // bytes at most.
    const huge = JSON.stringify({ ollama: "x".repeat(70 * 1024) });

    expect(readModelChoices(storageHolding({ [MODEL_CHOICES_STORAGE_KEY]: huge }))).toEqual({});
  });

  it("still starts when storage refuses to be read", () => {
    const refused = {
      getItem() {
        throw new Error("storage disabled");
      },
    };

    expect(readModelChoices(refused)).toEqual({});
    expect(readModelChoices(null)).toEqual({});
  });
});

describe("remembering a choice", () => {
  it("keeps the Endpoint for next time", () => {
    const storage = storageHolding();

    expect(writeChosenEndpoint(storage, "groq")).toBe("groq");
    expect(storage.written).toEqual([[ENDPOINT_STORAGE_KEY, "groq"]]);
    expect(readChosenEndpoint(storage, "ollama")).toBe("groq");
  });

  it("keeps the Model choices as one value", () => {
    // Written whole rather than one slot per Endpoint: the map is always read
    // whole, so a single write cannot leave half of it behind.
    const storage = storageHolding();

    expect(writeModelChoices(storage, { ollama: "qwen2.5-coder:7b" })).toBe(
      JSON.stringify({ ollama: "qwen2.5-coder:7b" }),
    );
    expect(storage.written).toEqual([
      [MODEL_CHOICES_STORAGE_KEY, JSON.stringify({ ollama: "qwen2.5-coder:7b" })],
    ]);
    expect(readModelChoices(storage)).toEqual({ ollama: "qwen2.5-coder:7b" });
  });

  it("refuses to remember an Endpoint that is not one", () => {
    // Writing it would put a value every later visit has to reject, in
    // preference to the Endpoint that app opens on.
    const storage = storageHolding();

    expect(writeChosenEndpoint(storage, "   ")).toBeNull();
    expect(writeChosenEndpoint(storage, "")).toBeNull();
    expect(storage.written).toEqual([]);
  });

  it("keeps a choice made even when it cannot be remembered", () => {
    // Blocking storage is a statement about the next visit, not about this one.
    // Losing persistence must not cost the reader the Endpoint they just chose.
    const refused = {
      setItem() {
        throw new Error("storage disabled");
      },
    };

    // What was written is still handed back, which is what lets the interface
    // put the choice in force without reading storage that refused the write.
    expect(() => writeChosenEndpoint(refused, "groq")).not.toThrow();
    expect(writeChosenEndpoint(refused, "groq")).toBe("groq");
    expect(writeModelChoices(refused, { ollama: "m" })).toBe(JSON.stringify({ ollama: "m" }));
    expect(writeChosenEndpoint(null, "groq")).toBe("groq");
    expect(() => writeStoredValue(null, ENDPOINT_STORAGE_KEY, "groq")).not.toThrow();
  });
});

describe("the shape of the store itself", () => {
  it("parses stored values without a Storage in reach", () => {
    // Split from the reading so the same shapes can be checked where there is
    // no browser to read from.
    expect(parseChosenEndpoint("lmstudio", "ollama")).toBe("lmstudio");
    expect(parseChosenEndpoint(null, "ollama")).toBe("ollama");
    expect(parseModelChoices('{"ollama":"m"}')).toEqual({ ollama: "m" });
    expect(parseModelChoices(null)).toEqual({});
    expect(storedValue(null, ENDPOINT_STORAGE_KEY)).toBeNull();
  });
});
