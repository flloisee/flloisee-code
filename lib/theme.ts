/**
 * Which Theme the interface is drawn in.
 *
 * Two settings, light and dark, with light the one it opens on. No third
 * setting and no following the system: a Theme that answers to the operating
 * system is not one the reader has chosen, and a control that silently changes
 * the appearance of an app between one launch and the next — because a laptop
 * was in a different room — is worse than a plain default. Light is the
 * default because it is the one that is legible in the worst conditions, and
 * because the dark scheme is then something the reader asked for rather than
 * something that happened to them.
 *
 * Reading and writing are separated from applying on purpose. Deciding *what*
 * the Theme is and mutating the document are different jobs: the first is pure
 * and testable without a browser, and the second is a single attribute write
 * that the same stylesheet also has to honour on first paint. The stylesheet
 * stays the single authority on which Theme is actually in force — nothing
 * here computes a media query, because a second implementation of that rule is
 * a second thing that can disagree with the first.
 */

/** The Themes on offer, in the order they are offered. */
export const THEMES = ["light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/** Where the choice is kept between visits. */
export const THEME_STORAGE_KEY = "multi-endpoint-chat.theme";

/** The Theme used before anything has been chosen. */
export const DEFAULT_THEME: Theme = "light";

/** Narrows an arbitrary value read back from storage to a Theme. */
export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * The Theme the reader last chose, or `light` when there is nothing usable.
 *
 * Storage is treated as untrusted input on purpose. It is shared between
 * versions of the app, survives across them, and can be edited by hand, so a
 * value from a build that offered other Themes than these — an earlier one
 * that followed the system, say — is a thing that will genuinely happen rather
 * than a theoretical concern. It resolves to the default rather than to
 * nothing.
 *
 * The whole read is inside a `try`: a browser with storage disabled, or a
 * private window in some configurations, throws on *access* to `localStorage`
 * rather than returning null. Failing to read a preference is not a reason to
 * fail to render the app.
 */
export function readTheme(storage: Pick<Storage, "getItem"> | null | undefined): Theme {
  if (!storage) return DEFAULT_THEME;

  let stored: string | null;
  try {
    stored = storage.getItem(THEME_STORAGE_KEY);
  } catch {
    return DEFAULT_THEME;
  }

  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/**
 * Remembers a Theme for next time.
 *
 * Best effort by design. A reader who has blocked storage has told us they do
 * want the Theme now and will take the rest themselves, so failing to persist
 * it must not take the current one down with it.
 */
export function writeTheme(storage: Pick<Storage, "setItem"> | null | undefined, theme: Theme): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Deliberately empty: see above.
  }
}

/** The Theme to move to when the reader presses the control in `from`. */
export function otherTheme(from: Theme): Theme {
  return from === "dark" ? "light" : "dark";
}

/**
 * Puts a Theme in force on the document.
 *
 * One attribute, and that is the entire mechanism — `tokens.css` reads
 * `data-theme` to decide `color-scheme`, which in turn decides which half of
 * every `light-dark()` pair is used. Writing the attribute rather than a
 * `style.colorScheme` keeps the stylesheet in charge, so there is no state
 * that exists only in JavaScript and can drift from what is on screen.
 */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  root.dataset.theme = theme;
}
