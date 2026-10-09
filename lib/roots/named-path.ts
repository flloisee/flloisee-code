/**
 * Which words in a message are the paths of files.
 *
 * A reader names a file one of two ways — picking it from the Root with `@`, or
 * pasting where it is — and both arrive as the same ordinary text in the same
 * textarea. So this is the whole of how the app decides that a message is about a
 * file at all, and it runs over that text twice: once in the composer, so the
 * reader is asked before they send, and once on the server, so that answer cannot
 * be forged by anything in the browser.
 *
 * **The rule is mostly about what this must not recognise.** A file request is a
 * question put in front of the reader at the worst possible moment, so a token is
 * only a path when something about its *shape* says so: an absolute path, a way
 * out of the folder, a separator with more structure than a sentence has, or a
 * name carrying an extension. `and/or`, `e.g.`, `3/4` and `me@example.com` are
 * the English that has to survive, and each is refused by a rule below rather than
 * by hoping.
 *
 * **What this decides is not what may be read.** A path that is recognised is
 * still refused by containment, on the server, in `mayRead` — the same function
 * the three Tools ask. Recognising a path is how the app comes to ask about one;
 * it is never how it comes to read one. That separation is the whole reason both
 * answers exist: a rule clever enough to open a file would have to know the disk,
 * and a rule that knows the disk has to be the one that is right.
 *
 * No imports, and nothing here that can tell a file from a folder. Whether a path
 * is there, and what it is, is a question for the route.
 */

/**
 * How long a token can be and still be a path.
 *
 * A path longer than this is a paste rather than a name — a minified bundle is one
 * line of megabytes — and asking the server about it would be a question about the
 * reader's clipboard. Generous enough for any path a filesystem holds, which the
 * disk itself bounds well below this.
 */
export const MAX_PATH_CHARS = 1024;

/** `scheme://`, which is an address the disk has nothing to do with. */
const URL = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * One `@`, nothing either side empty, and no separator: an address.
 *
 * Narrow on purpose. `node_modules/@scope/pkg` has a separator and is a real path,
 * and `me@example.com` has neither an empty half nor a separator and is somebody's
 * email address — which the composer's `@` rule already declines to open a menu
 * over, and which this declines to ask the server about.
 */
const ADDRESS = /^[^/\\@\s]+@[^/\\@\s]+$/;

/** A control character, a null byte, or anything else the disk could not hold. */
const NOT_A_CHARACTER = /[\u0000-\u001f\u007f]/;

/** An extension: letters, and then whatever else a filename may carry. */
const EXTENSION = /\.[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Every path a message names, in the order they appear and once each.
 *
 * The strings come back exactly as the reader wrote them, with the punctuation
 * that surrounded them taken off. They are *not* resolved and *not* checked:
 * `mayRead` is what turns one into a path on disk, and it resolves a relative one
 * against the Root the same way it resolves one the Model wrote.
 */
export function namedPaths(text: string): string[] {
  const found: string[] = [];

  for (const token of text.split(/\s+/)) {
    const path = asPath(token);
    if (path !== null && !found.includes(path)) found.push(path);
  }

  return found;
}

/** One token, or `null` when it is not a path. */
function asPath(token: string): string | null {
  if (token === "") return null;

  // Trimmed at both ends rather than searched for, because punctuation sits
  // *around* a word and a reader writing `read "notes.md".` is still naming one.
  // The set is what a sentence puts next to a word: quotes, brackets, and the
  // stops that end a clause. A `.` inside the token is untouched, which is the
  // whole of what keeps `notes.md` from being trimmed down to `notes`. An `@`
  // goes too, because while the menu is open the composer holds `@src/util.ts`
  // and the reader is naming that file rather than a folder called `@src`.
  const trimmed = token
    .replace(/^["'`()[\]{}<>,;@]+/, "")
    .replace(/[.,;:!?)"'`\]}>]+$/, "");
  if (trimmed === "") return null;

  // Length first, so a megabyte of clipboard is never asked about.
  if (trimmed.length > MAX_PATH_CHARS) return null;
  if (NOT_A_CHARACTER.test(trimmed)) return null;
  if (URL.test(trimmed) || ADDRESS.test(trimmed)) return null;

  // Home-directory shorthand, which this app does not resolve. Nothing here
  // expands a `~`, so `~/notes.md` would be read as a folder named `~` inside the
  // Root, find nothing there, and be reported as a file that is not there. Naming
  // it would put a question in front of the reader about a file they did not mean
  // — and `~` in ordinary prose ("~5 files") is not rare. The reader pastes the
  // path in full, or picks the file from the Root.
  if (trimmed.startsWith("~")) return null;

  if (isAbsolute(trimmed) || isExplicitlyRelative(trimmed)) return trimmed;

  const separators = trimmed.split("/").length - 1;

  if (separators === 0) return hasExtension(trimmed) ? trimmed : null;

  // One separator and no extension anywhere is two words with a slash between
  // them: `and/or`, `I/O`, `yes/no`, `3/4`, `src/util`. That is the shape a
  // sentence has far more often than a path does, and the reader who meant a
  // folder can say `./src`, say it in full, or pick it from the Root with `@`.
  if (separators === 1 && !trimmed.includes(".")) return null;

  return trimmed;
}

/** `/usr/local`, and never `/` on its own, which separates and names nothing. */
function isAbsolute(candidate: string): boolean {
  return candidate.startsWith("/") && candidate.length > 1;
}

/** `./src` and `../other/notes.md`: the reader has said which folder they mean. */
function isExplicitlyRelative(candidate: string): boolean {
  if (!candidate.startsWith("./") && !candidate.startsWith("../")) return false;
  return candidate.replace(/^\.\.?\//, "") !== "";
}

/**
 * A single name that carries an extension.
 *
 * The extension has to start with a letter, so `1.2.3` and `v1.2` are versions
 * rather than filenames; and some part of the name has to be two characters or
 * more, so `e.g.` and `i.e.` are abbreviations rather than files. Both are
 * ordinary English written with dots in it, which is what makes a dot useless on
 * its own.
 */
function hasExtension(candidate: string): boolean {
  if (!EXTENSION.test(candidate)) return false;
  return candidate.split(".").some((part) => part.length >= 2);
}