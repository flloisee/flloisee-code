// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Choosing the Theme, observed through what the interface does rather than
 * through how the control is built.
 */

afterEach(() => {
  // Unmounted explicitly because vitest is not running with globals, so
  // testing-library cannot register its own afterEach — and a button left over
  // from the previous test would be found by this one's queries.
  cleanup();
  vi.restoreAllMocks();
});

/** The Theme the document is drawn in. */
function themeOnScreen(): string | undefined {
  return document.documentElement.dataset.theme;
}

describe("choosing the Theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("opens on light, for a reader who has chosen nothing", () => {
    render(<ThemeToggle />);

    // Light rather than the system's setting: the default is a choice, not an
    // absence of one, and it does not change under the reader.
    expect(themeOnScreen()).toBeUndefined();
    expect(screen.getByRole("button", { name: /switch to dark theme/i })).toBeTruthy();
  });

  it("switches to dark and back", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /switch to dark theme/i }));
    expect(themeOnScreen()).toBe("dark");

    // And the control now offers the way back, because a switch that only went
    // one way would not be a switch.
    fireEvent.click(screen.getByRole("button", { name: /switch to light theme/i }));
    expect(themeOnScreen()).toBe("light");
  });

  it("remembers the Theme for next time", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /switch to dark theme/i }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("shows the Theme the document is already drawn in", () => {
    // What the pre-paint script in the root layout does before React arrives.
    document.documentElement.dataset.theme = "dark";

    render(<ThemeToggle />);

    // Read from the document rather than from storage, so the control cannot
    // disagree with the colours already on screen.
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeTruthy();
  });

  it("names the action on the control, and the state beside it", () => {
    render(<ThemeToggle />);

    const control = screen.getByRole("button", { name: /switch to dark theme/i });

    // Two channels, deliberately: the glyph is the state and the name is the
    // action. A reader who can see neither still gets both.
    expect(control.textContent).toContain("Light theme");
    expect(control.getAttribute("title")).toBe("Switch to dark theme");
  });

  it("follows a Theme changed in another window", () => {
    render(<ThemeToggle />);

    // A `storage` event only fires in the windows that did not make the
    // change, which is exactly the one that has to catch up.
    fireEvent(window, new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }));

    expect(themeOnScreen()).toBe("dark");
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeTruthy();
  });

  it("ignores a stored value for something that is not a Theme", () => {
    render(<ThemeToggle />);

    fireEvent(window, new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "system" }));

    // An earlier build stored a third Theme that follows the system. It is not
    // one of the two on offer, so it resolves to the default rather than
    // leaving the document in a state the stylesheet has no rule for.
    expect(themeOnScreen()).toBe("light");
    expect(screen.getByRole("button", { name: /switch to dark theme/i })).toBeTruthy();
  });

  it("ignores storage traffic about something else entirely", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /switch to dark theme/i }));

    fireEvent(window, new StorageEvent("storage", { key: "some-other-app.preference", newValue: "light" }));

    // Another key is not a Theme change, and must not be read as one.
    expect(themeOnScreen()).toBe("dark");
  });

  it("still switches when storage cannot be reached", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    render(<ThemeToggle />);

    // Losing the choice for next time is not a reason to lose it for now.
    expect(() => fireEvent.click(screen.getByRole("button", { name: /switch to dark theme/i }))).not.toThrow();
    expect(themeOnScreen()).toBe("dark");
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeTruthy();
  });

  it("draws the Theme in force, as a glyph rather than a label", () => {
    document.documentElement.dataset.theme = "dark";
    const { container } = render(<ThemeToggle />);

    const glyph = container.querySelector("svg");

    // One glyph, and it is not announced — the button's name already carries
    // what it means, so reading the drawing too would say everything twice.
    expect(glyph).toBeTruthy();
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    // And it takes its colour from the button rather than carrying its own.
    expect(glyph?.getAttribute("stroke")).toBe("currentColor");
  });
});
