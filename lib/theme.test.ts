// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  otherTheme,
  readTheme,
  writeTheme,
  type Theme,
} from "./theme";

/** A Storage stand-in holding one value, which is all these functions read. */
function storageHolding(value: string | null) {
  const written: string[] = [];
  return {
    written,
    getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null),
    setItem: (key: string, entry: string) => {
      expect(key).toBe(THEME_STORAGE_KEY);
      written.push(entry);
    },
  };
}

describe("which Theme is chosen", () => {
  it("offers exactly light and dark", () => {
    expect(THEMES).toEqual(["light", "dark"]);
  });

  it("starts on light, rather than on whatever the system asks for", () => {
    // Not a neutral default: an app that changes appearance between one launch
    // and the next because a laptop was somewhere else reads as unreliable, and
    // dark is then something the reader asked for rather than something that
    // happened to them.
    expect(DEFAULT_THEME).toBe("light");
    expect(readTheme(storageHolding(null))).toBe("light");
  });

  it("keeps a Theme chosen earlier", () => {
    expect(readTheme(storageHolding("dark"))).toBe("dark");
    expect(readTheme(storageHolding("light"))).toBe("light");
  });

  it("falls back to light for a value this app does not offer", () => {
    // Storage outlives the version that wrote it. An earlier build offered a
    // third Theme that followed the system, so a reader upgrading carries one
    // of those — and it has to resolve to something rather than to nothing.
    expect(readTheme(storageHolding("system"))).toBe("light");
    expect(readTheme(storageHolding("sepia"))).toBe("light");
    expect(readTheme(storageHolding(""))).toBe("light");
    expect(readTheme(storageHolding("DARK"))).toBe("light");
  });

  it("still starts when storage refuses to be read", () => {
    // Some browsers throw merely on touching localStorage, so the access
    // itself is inside the guarded region rather than only the parse.
    const refused = {
      getItem() {
        throw new Error("storage disabled");
      },
    };

    expect(readTheme(refused)).toBe("light");
  });

  it("still starts when there is no storage at all", () => {
    expect(readTheme(null)).toBe("light");
    expect(readTheme(undefined)).toBe("light");
  });

  it("remembers a Theme for next time", () => {
    const storage = storageHolding(null);

    writeTheme(storage, "dark");

    expect(storage.written).toEqual(["dark"]);
  });

  it("keeps the Theme in force even when it cannot be remembered", () => {
    // Blocking storage is a statement about the next visit, not about this
    // one. Losing persistence must not cost the reader the Theme they just
    // picked.
    const refused = {
      setItem() {
        throw new Error("storage disabled");
      },
    };

    expect(() => writeTheme(refused, "dark")).not.toThrow();
    expect(() => writeTheme(null, "dark")).not.toThrow();
  });
});

describe("naming a Theme", () => {
  it("recognises every Theme on offer and nothing else", () => {
    const offered: Theme[] = ["light", "dark"];

    for (const theme of offered) expect(isTheme(theme)).toBe(true);

    expect(isTheme("system")).toBe(false);
    expect(isTheme("sepia")).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(2)).toBe(false);
  });
});

describe("moving between the two Themes", () => {
  it("always moves to the other one", () => {
    // The control is a switch, so this is the only question it ever has to
    // answer — there is no state to pick wrongly.
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });

  it("comes back to where it started after two moves", () => {
    const start: Theme = "light";

    const there = otherTheme(start);
    const back = otherTheme(there);

    expect(back).toBe(start);
  });
});

describe("putting a Theme in force", () => {
  it("records the Theme on the document, where the stylesheet reads it", () => {
    const root = document.createElement("html");

    applyTheme(root, "dark");
    expect(root.dataset.theme).toBe("dark");

    applyTheme(root, "light");
    expect(root.dataset.theme).toBe("light");
  });
});
