import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import { gitignoreRules, type IgnoreRules } from "./glob";
import { asText, looksBinary, toLines } from "./text";

/**
 * Looking through a folder, bounded.
 *
 * One walk, for two callers: `search_files` uses it to look for text, and the
 * `@` menu uses it to offer a file to name. The spec asks for one implementation
 * of "look through the Root" rather than two, and the reason is not tidiness —
 * two walks drift, and the second one is the one that skips a folder the
 * developer believes is searched without anything saying so.
 *
 * The two read it differently, and the difference is paid for here rather than
 * by the caller: a caller looking for text is handed the file's lines, and a
 * caller looking for a **name** — the menu — is handed each entry without the
 * file being opened at all, folders included. That is the same traversal, the
 * same skip rules and the same ceilings either way, and it is the reason this
 * can be one function rather than two.
 *
 * Four things are bounded here, and each one exists because the alternative is a
 * hang rather than an answer:
 *
 * - **Names.** `node_modules` and `.git` are volume, and anything named `.env*`
 *   holds a Credential. They are never opened, whatever folder they are in.
 * - **`.gitignore`.** The developer has already written down where their build
 *   output and their logs go. A search that walked `dist/` in a project that
 *   ignores it would answer with the contents of a bundle.
 * - **Size.** A file over the ceiling is passed over *by its size*, before it is
 *   opened, so a search does not pull forty megabytes into memory to find out
 *   that it was never going to look at them.
 * - **Count.** Files and folders both have a ceiling, so a folder of nothing but
 *   empty directories terminates rather than recursing until the stack runs out.
 *
 * **No link is ever followed.** `readdir` is asked what each entry is, and a link
 * is neither a file nor a folder as far as this walk is concerned — it is passed
 * over. That is one rule rather than a containment check per entry, it cannot be
 * moved by swapping a link for a folder between the check and the descent, and it
 * means there is no loop for a folder of links to send it round. What it costs is
 * that a project holding its sources in links will not find them, which is said
 * in the result rather than left as a silence.
 *
 * The folder this starts from is **already admitted**. The walk is not the thing
 * that decides what may be read — `mayRead` is, and the path it hands back has no
 * link left in it — so there is no path into this function that reaches the disk
 * without having been through containment first.
 */

/** The largest file any caller of this walk will open, in bytes. */
export const MAX_OPEN_FILE_BYTES = 1_048_576;

/** How many files one walk will open, however many it is asked about. */
export const MAX_WALK_FILES = 2_000;

/** How many folders one walk will go into, so a tree of empty folders also ends. */
export const MAX_WALK_FOLDERS = 1_000;

/** One file the walk has decided to offer. */
export type WalkedFile = {
  /** The whole path, resolved, with no link left in it. */
  path: string;
  /** The path from the folder the walk started in, in `/` form. */
  relative: string;
  /** Bytes on disk, which is under the ceiling or the file would not be here. */
  size: number;
  /**
   * The file's lines.
   *
   * Handed over rather than the path to read, because the walk has already had to
   * open the file to know whether it is text, and a caller that opened it again
   * would be doing the same work twice and counting it as two reads. It also makes
   * the walk's own answer to "how much did this actually read" the true one.
   */
  lines: string[];
};

/** One entry the walk reached without opening it. */
export type WalkedEntry = {
  /** The whole path, resolved, with no link left in it. */
  path: string;
  /** The path from the folder the walk started in, in `/` form. */
  relative: string;
  /** The name as the folder holds it, with no path in front of it. */
  name: string;
  /**
   * What it is. A link is never among these: the walk passes those over, and a
   * caller naming files has no use for a name that is not there to be named.
   */
  kind: "file" | "directory";
};

export type WalkRequest = {
  /** Where to start, already admitted and already resolved. */
  from: string;
  /**
   * Told about each file, in the walk's own order.
   *
   * Return `false` to stop the walk there and then, which is how a caller with a
   * cap of its own stops rather than being handed the rest and discarding it.
   *
   * Optional, and the walk reads nothing at all without it: a caller that is
   * looking for a name is not charged for the contents of every file in the
   * Root, which is what this walk used to cost by construction.
   */
  visit?(file: WalkedFile): boolean | Promise<boolean>;
  /**
   * Told about every entry the walk reaches, folders and files alike, **without
   * opening it**.
   *
   * This is how the `@` menu sees the Root. It wants names, and a menu that
   * filtered by name by having every file's contents read into memory first
   * would be paying a megabyte a file to answer a question about characters.
   * It also wants folders, which `visit` never offers because a search descends
   * into them rather than reporting them.
   *
   * Offered in the same order and under the same rules as everything else here:
   * after the names and `.gitignore` rules have had their say, so a caller
   * cannot be offered a `.env` file or a folder the developer excluded, and
   * before the descent, so a folder comes before what is in it.
   *
   * Returning `false` stops the walk, for the same reason `visit` returning
   * `false` does.
   */
  onEntry?(entry: WalkedEntry): boolean | Promise<boolean>;
  /**
   * Whether a file's path is one this caller wants, asked before the file is
   * opened.
   *
   * Here rather than in the caller because "did not want it" and "could not read
   * it" are the same shape of answer: neither is a file this walk looked at, and
   * a caller that filtered afterwards would have to open every file in the Root to
   * discard most of them.
   */
  only?(relativePath: string): boolean;
  /** A Stop in the interface, which ends the walk where it stands. */
  signal?: AbortSignal;
};

/** What the walk did, and what it passed over. */
export type WalkOutcome = {
  /** Files handed to `visit`. */
  files: number;
  /** Folders that were never entered, because a name or a `.gitignore` ruled them out. */
  foldersSkipped: number;
  /**
   * Files that were never opened: a name, a `.gitignore`, a pattern the caller
   * asked to leave out, a size over the ceiling, bytes that are not text, or an
   * entry that is neither a file nor a folder.
   */
  filesSkipped: number;
  /**
   * `true` when the walk did not reach the end of the folder — a ceiling, a Stop,
   * or `visit` saying stop.
   *
   * A caller that reports this as an answer without reporting it as *partial* is
   * telling a Model it knows everything it did not know.
   */
  stopped: boolean;
};

/**
 * Names that are never opened, whatever folder they are in.
 *
 * `node_modules` and `.git` because they are volume rather than source, and
 * anything named `.env` because those are the files Next reads Credentials and
 * settings from. The last of those is not a volume argument: a search that read
 * `.env.local` would put a Credential into a transcript which is saved, re-sent
 * on every later Turn, and forwarded to whichever Endpoint the reader chose.
 */
export function isNeverWalked(name: string): boolean {
  return name === "node_modules" || name === ".git" || isCredentialFile(name);
}

/**
 * Whether a name is one of the environment files.
 *
 * Shared with the walk a reader browses to choose a Root, which hides the same
 * names for the same reason: there, a row is one click from becoming the folder
 * the Model may read.
 */
export function isCredentialFile(name: string): boolean {
  return name.startsWith(".env");
}

/** Walks a folder, offering each file it decides to look at. */
export async function walkFiles({ from, visit, onEntry, only, signal }: WalkRequest): Promise<WalkOutcome> {
  const outcome: WalkOutcome = { files: 0, foldersSkipped: 0, filesSkipped: 0, stopped: false };

  // The `.gitignore` files in force, innermost last. A rule written beside a file
  // is the one that decides about that file, so the stack is consulted from the
  // top down and the first folder whose file has something to say gives the answer.
  const inForce: Array<{ base: string; rules: IgnoreRules }> = [];

  const descend = async (folder: string, relative: string): Promise<void> => {
    if (outcome.stopped) return;
    if (signal?.aborted === true) {
      outcome.stopped = true;
      return;
    }
    if (inForce.length >= MAX_WALK_FOLDERS) {
      outcome.stopped = true;
      return;
    }

    const rules = await readIgnoreRules(folder);
    inForce.push({ base: folder, rules });

    try {
      const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => null);
      // A folder that will not open is passed over rather than refused: the walk
      // is answering "what is in here", and one folder it cannot read is one
      // folder of a very large answer missing, not a reason to refuse the rest.
      if (entries === null) return;

      // Sorted before it is walked, folders first and then files, each group by
      // name. Not for tidiness: `readdir` answers in whatever order the filesystem
      // happens to hold, so an unsorted walk gives a different transcript on a
      // different machine and a different order on the same one after a rebuild.
      // The order here is the same one `list_files` uses, so the two agree.
      for (const entry of [...entries].sort(byKindThenName)) {
        if (outcome.stopped) return;

        const child = path.join(folder, entry.name);
        const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;

        if (isNeverWalked(entry.name) || ignoredHere(inForce, child)) {
          outcome[entry.isDirectory() ? "foldersSkipped" : "filesSkipped"] += 1;
          continue;
        }

        if (entry.isDirectory()) {
          // Offered before the descent, so a folder is named before what is in it
          // — the order a reader browsing by name expects to read them in.
          const named =
            onEntry === undefined ||
            (await onEntry({
              path: child,
              relative: childRelative,
              name: entry.name,
              kind: "directory",
            }));
          if (!named) {
            outcome.stopped = true;
            return;
          }

          await descend(child, childRelative);
          continue;
        }

        // A link, and anything else that is not a plain file. Passed over rather
        // than followed, which is what keeps the walk inside where it started.
        if (!entry.isFile()) {
          outcome.filesSkipped += 1;
          continue;
        }

        if (only !== undefined && !only(childRelative)) {
          outcome.filesSkipped += 1;
          continue;
        }

        // Asked before the file is opened, so the walk does not read a file it has
        // already decided it will not hand over and then not hand it over.
        if (onEntry !== undefined) {
          const named = await onEntry({
            path: child,
            relative: childRelative,
            name: entry.name,
            kind: "file",
          });
          if (!named) {
            outcome.stopped = true;
            return;
          }
        }

        if (visit === undefined) continue;

        if (outcome.files >= MAX_WALK_FILES) {
          outcome.stopped = true;
          return;
        }

        const opened = await openAsLines(child);
        if (opened === null) {
          outcome.filesSkipped += 1;
          continue;
        }

        outcome.files += 1;
        if (!(await visit({ path: child, relative: childRelative, size: opened.size, lines: opened.lines }))) {
          outcome.stopped = true;
          return;
        }
      }
    } finally {
      inForce.pop();
    }
  };

  await descend(from, "");
  return outcome;
}

/**
 * A file's lines, or `null` for one this walk will not look at.
 *
 * The size is asked for before the file is opened, so a search does not pull
 * forty megabytes into memory to find out it was never going to look at them. The
 * bytes are then judged rather than assumed: a file that is not text is passed
 * over here rather than handed on, because the callers of this walk that read
 * want text, and one that decides for itself afterwards has already read them.
 *
 * Never reached on the menu's path, and that is the point of it living here
 * rather than in each caller: `onEntry` returns before this is called.
 */
async function openAsLines(target: string): Promise<{ size: number; lines: string[] } | null> {
  const size = await sizeOf(target);
  if (size === null || size > MAX_OPEN_FILE_BYTES) return null;

  const bytes = await fs.readFile(target).catch(() => null);
  if (bytes === null || looksBinary(bytes)) return null;

  return { size, lines: toLines(asText(bytes)) };
}

/**
 * The `.gitignore` beside a folder, as rules.
 *
 * A file that is not there is no rules, which is the ordinary case. A file that is
 * there and will not be read is also no rules — the narrow answer, which searches
 * more rather than less. Reading fewer files than the developer asked to be read
 * is the one failure here that would be silent.
 */
async function readIgnoreRules(folder: string): Promise<IgnoreRules> {
  const contents = await fs.readFile(path.join(folder, ".gitignore"), "utf8").catch(() => null);
  return gitignoreRules(contents === null ? [] : contents.split("\n"));
}

/**
 * Whether any `.gitignore` in force rules this entry out, innermost first.
 *
 * Every level is consulted, not only the folder being listed, because a folder
 * with no `.gitignore` of its own has nothing to say and the one above it still
 * does — stopping at the first level would mean a project with a `.gitignore` in
 * every folder ignored nothing at all. The innermost level with anything to say
 * decides, which is what lets `!important.log` in `src/` take back a `*.log` in
 * the folder above.
 */
function ignoredHere(inForce: Array<{ base: string; rules: IgnoreRules }>, candidate: string): boolean {
  for (let taken = inForce.length - 1; taken >= 0; taken -= 1) {
    const { base, rules } = inForce[taken];
    const decided = rules.decides(path.relative(base, candidate));
    if (decided !== null) return decided;
  }
  return false;
}

/** Folders before files, then files before anything else, and each group by name. */
function byKindThenName(a: Dirent, b: Dirent): number {
  const byKind = rankOf(a) - rankOf(b);
  return byKind !== 0 ? byKind : a.name.localeCompare(b.name);
}

function rankOf(entry: Dirent): number {
  return entry.isDirectory() ? 0 : entry.isFile() ? 1 : 2;
}

async function sizeOf(target: string): Promise<number | null> {
  try {
    return (await fs.stat(target)).size;
  } catch {
    return null;
  }
}
