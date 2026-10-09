"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  otherTheme,
  writeTheme,
  type Theme,
} from "@/lib/theme";

/**
 * Choosing the Theme: one control, two settings, light and dark.
 *
 * An icon rather than a labelled control because a sun and a moon are the
 * pair the whole interface already has conventions for, and a glyph costs the
 * header a square of width instead of a sentence.
 *
 * The glyph shows the Theme in force, not the one a press would move to. The
 * button is therefore a readout first and a switch second, and the two readings
 * are kept from colliding by giving each its own channel: the shape is the
 * state, the accessible name is the action. A control whose picture and label
 * both described the same thing would be ambiguous at exactly the moment it
 * mattered — after the press, when the picture has already changed.
 *
 * The Theme in force lives on the root element, in `data-theme`. That is not a
 * detail of this component's implementation — it is where the Theme already
 * lives, because `tokens.css` reads that attribute to decide `color-scheme`,
 * and `color-scheme` decides which half of every `light-dark()` pair is used.
 * So the component subscribes to the document rather than keeping a second copy
 * of the answer in React state, which would be a second thing that has to be
 * kept in step with the first.
 *
 * The colours are therefore never computed here: there is no media query
 * listener, no flash of the wrong Theme on load, and no colour logic in
 * JavaScript that could disagree with the stylesheet.
 */

/**
 * The stored choice, or nothing when storage cannot be reached at all.
 *
 * Reading the `localStorage` *property* is itself the operation that throws in
 * a browser with storage blocked — it is not a safe way to obtain a Storage to
 * ask later. So the access is guarded here, and `lib/theme.ts` stays free of
 * any reference to `window`.
 */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The Theme the document is currently drawn in. */
function themeInForce(): Theme {
  const set = document.documentElement.dataset.theme;
  return isTheme(set) ? set : DEFAULT_THEME;
}

/**
 * Told whenever the Theme changes, from this window or another.
 *
 * A `storage` event only reaches windows that did *not* make the change, so a
 * press here dispatches one for itself (see `toggle`). Both directions
 * therefore arrive by the same route, and there is one way for this component
 * to be updated rather than two that could disagree.
 */
function subscribe(onChange: () => void) {
  function adopted(event: StorageEvent) {
    // Some other preference changing is not a Theme change.
    if (event.key !== THEME_STORAGE_KEY) return;

    // The attribute, not the event's value, is what the stylesheet reads, so it
    // has to be the thing that moves — and moving it is also what makes the
    // colours change in a window nobody is clicking in.
    applyTheme(document.documentElement, isTheme(event.newValue) ? event.newValue : DEFAULT_THEME);
    onChange();
  }

  window.addEventListener("storage", adopted);
  return () => window.removeEventListener("storage", adopted);
}

/**
 * What the server rendered, and what a reader with scripting off is left with.
 *
 * `light` because that is the default and because the server cannot know the
 * stored choice either. React uses this for the hydration render and then
 * re-reads through `themeInForce` once the client takes over, which is how the
 * correct Theme is reached without a mismatch between what was rendered and
 * what the client believes.
 */
function themeOnTheServer(): Theme {
  return DEFAULT_THEME;
}

/** How each Theme is described to a reader who cannot see the glyph. */
const DESCRIBES: Record<Theme, { action: string; state: string }> = {
  light: { action: "Switch to dark theme", state: "Light theme" },
  dark: { action: "Switch to light theme", state: "Dark theme" },
};

/**
 * Sun and moon, drawn here rather than pulled from an icon library.
 *
 * Two reasons. An icon set is a whole dependency and a whole voice — this app
 * has no other icons, so a library would arrive to draw one glyph and impose a
 * stroke weight on a design system that has only just defined its own. And at
 * 16px the difference between a library's moon and a good one is a few tenths
 * of a millimetre of horn, which is the part that reads as "crisp" at that
 * size and the part nobody can fix afterwards.
 *
 * Both share one stroke weight, one cap style and a 16-unit box, so they are a
 * matched pair rather than two drawings that happen to sit together. The moon
 * is a true crescent — an arc of a 6.4 circle with a 5.9 circle taken out of it,
 * 2.4 units off centre — which is what keeps it reading as a moon at 16px
 * instead of as a comma or a sliver.
 *
 * `currentColor` so the glyph inherits the button's colour and follows the
 * Theme without a second set of values to keep in step.
 */
function Glyph({ theme }: { theme: Theme }) {
  const shared = {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    // The button's accessible name already says what the glyph is for, so
    // announcing it again would just be noise read out twice.
    "aria-hidden": true,
    focusable: false,
  } as const;

  if (theme === "dark") {
    return (
      <svg {...shared}>
        <path d="M13.97 10.29A6.4 6.4 0 0 1 5.71 2.03A5.9 5.9 0 1 0 13.97 10.29Z" />
      </svg>
    );
  }

  return (
    <svg {...shared}>
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2M3.58 3.58 5 5M11 5l1.42-1.42M12.42 12.42 11 11M5 11l-1.42 1.42" />
    </svg>
  );
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, themeInForce, themeOnTheServer);
  const next = otherTheme(theme);

  function toggle() {
    // Stored first, then announced. `writeTheme` is best effort by design, so
    // a browser that refuses storage still gets the Theme: the dispatch below
    // is what moves the interface either way.
    writeTheme(safeStorage(), next);

    // Announced last because it is the announcement that does the work — see
    // `subscribe`, which applies the Theme and re-renders from one event.
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: next }));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Says the action, because that is what a reader deciding whether to
      // press it needs. `title` gives the same words on hover, since the glyph
      // alone cannot carry them — and it is a supplement to the accessible
      // name rather than a replacement, so a touch reader loses nothing.
      aria-label={DESCRIBES[theme].action}
      title={DESCRIBES[theme].action}
      // States the Theme as well as the action, for the reader whose screen
      // reader reads the button rather than its name.
      aria-describedby="theme-toggle-state"
      className="hm-btn hm-btn--quiet hm-btn--icon"
    >
      <Glyph theme={theme} />
      {/* Off-screen, but real text in the document — so the current Theme is
          available to search, to a screen reader, and to anything reading the
          page as content, rather than existing only as a drawing. */}
      <span id="theme-toggle-state" className="sr-only">
        {DESCRIBES[theme].state}
      </span>
    </button>
  );
}
