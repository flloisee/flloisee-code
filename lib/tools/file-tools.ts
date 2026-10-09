import { tool, type ModelMessage, type ToolSet } from "ai";
import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { compileGlob } from "@/lib/roots/glob";
import { mayRead, type Readable } from "@/lib/roots/readable";
import type { ReadingRoot } from "@/lib/roots/reading-root";
import { walkFiles, type WalkOutcome } from "@/lib/roots/scan";
import { asText, looksBinary, toLines, withLineNumbers } from "@/lib/roots/text";
import { readerApproved } from "@/lib/tools/approved";
import { namer, refuse, type Refusal, type Reason } from "@/lib/tools/refusal";

export { type Refusal, type Reason } from "@/lib/tools/refusal";

/**
 * The three Tools the Model navigates a folder it has never seen with.
 *
 * Read-only, as a decision rather than an omission. There is no write, no move
 * and no delete here, and that is the point rather than the gap: a Tool that
 * writes is a different capability with different bounds, it would make every
 * read worth being suspicious of, and it is deliberately something a later ticket
 * has to argue for rather than inherit.
 *
 * Two rules run through all three, and both are load-bearing.
 *
 * The first is that **containment is asked, and the path that comes back is the
 * path that gets opened**. `mayRead` resolves the way the disk resolves and only
 * then compares, so a link inside the Root pointing at `~/.ssh` is refused rather
 * than followed; and the path handed back on a yes has no link left in it, which
 * closes the gap between the check and the read — a link can be moved in between.
 * No Tool here compares a path to a Root itself, because a second comparison is a
 * second answer to keep in step with the first.
 *
 * The second is that **a refusal is a result and never a thrown error**. The Model
 * reads these results and writes about them, and a Turn that ended because a file
 * happened to be binary would leave the reader with nothing at all.
 */

/**
 * How much one call is allowed to answer with.
 *
 * Four ceilings, and each one is a sentence in a result rather than a number in
 * source. A Model told "there are more" has nothing to act on; a Model told
 * "showing lines 1–2000 of 5400, ask again with offset 2001" can finish the
 * question. So every one of these is reported where it is hit, never applied
 * silently.
 *
 * `MAX_FILE_BYTES` is the largest file any of the three will open, and it is one
 * number for reading and for searching: "too big to open" is a fact about a file
 * rather than about which Tool noticed it, and two Tools with two ceilings would
 * answer the same question differently. It is also what makes a read safe to do
 * in one piece — a megabyte costs a megabyte — which is why a slice of a file
 * can be counted and numbered exactly rather than estimated.
 */
export const MAX_LIST_ENTRIES = 1_000;
export const MAX_READ_LINES = 2_000;
export const MAX_FILE_BYTES = 1_048_576;
export const MAX_SEARCH_MATCHES = 200;

/**
 * How much of a matching line a search brings back.
 *
 * A minified bundle is one line of a hundred thousand characters, and two hundred
 * of those is twenty megabytes of transcript that is saved, re-sent on every later
 * Turn and forwarded to an Endpoint. A Model that wants the whole of one line is
 * told which file and which number it is, and can ask for it by name.
 */
export const MAX_MATCH_CHARS = 500;

/** What one entry of a folder is. */
export type Entry = {
  /** The name as the folder holds it, with no path in front of it. */
  name: string;
  /** The whole path, the way these Tools report paths. */
  path: string;
  /**
   * A link is its own kind rather than the kind of what it points at: whether it
   * can be followed is not known until it is resolved, and `read_file` is what
   * finds out.
   */
  kind: "file" | "directory" | "link";
  /** Bytes on disk, or `null` for a folder and for a link. */
  size: number | null;
};

/** What `list_files` found in one folder. */
export type Listing = {
  ok: true;
  /** The folder that was listed, as these Tools report paths. */
  path: string;
  entries: Entry[];
  /** How many entries the folder holds, which exceeds `entries.length` when `more`. */
  total: number;
  /** `true` when the folder holds more than the cap allows. */
  more: boolean;
  /** A sentence saying what is here, or what was left out. */
  note: string;
};

export type ListingOrRefusal = Listing | Refusal;

/** What `read_file` found in one file. */
export type FileRead = {
  ok: true;
  /** The file that was read, as these Tools report paths. */
  path: string;
  /** The number the first line shown has in the file. */
  startLine: number;
  /** How many lines the whole file has. */
  totalLines: number;
  /** The lines shown, each carrying its own number, as `12: the text`. */
  lines: string[];
  /**
   * Where the rest of the file begins, or `null` when this is all of it.
   *
   * Carried as data rather than left inside the note because the Model has to act
   * on it: it is the argument for the next call, and a Model that has to read a
   * sentence and pull a number out of it will sooner guess a number than parse one.
   */
  continuesAtLine: number | null;
  /** A sentence saying how much of the file this is. */
  note: string;
};

export type FileReadOrRefusal = FileRead | Refusal;

/** One line that held what was searched for. */
export type SearchMatch = {
  /** The file it is in, as these Tools report paths, so it can be read back. */
  path: string;
  /** The number that line has in its file. */
  line: number;
  /** The line itself, cut to `MAX_MATCH_CHARS`. */
  text: string;
};

/** What a search found, and how sure it is. */
export type SearchResults = {
  ok: true;
  /** Where it looked, as these Tools report paths. */
  path: string;
  /** The text it looked for, as it was given. */
  query: string;
  matches: SearchMatch[];
  /**
   * `false` when the search stopped before it had been everywhere — the match
   * ceiling, a file it would not open, or a Stop.
   *
   * Carried because the Model cannot tell a complete answer from a partial one by
   * looking at it, and a partial answer reported as a complete one is how a Model
   * says "this is defined nowhere in your project" about code that is in a file it
   * was never shown.
   */
  complete: boolean;
  /** Files opened and read. */
  filesRead: number;
  /** Files passed over without being opened: a name, a `.gitignore`, the `glob`, their size, or their bytes. */
  filesSkipped: number;
  /** Folders never entered, because a name or a `.gitignore` ruled them out. */
  foldersSkipped: number;
  /** A sentence saying how much of the folder this covers. */
  note: string;
};

export type SearchOrRefusal = SearchResults | Refusal;

/**
 * Builds the three Tools against one Reading Root.
 *
 * The Root is passed in rather than read from here, so the app keeps exactly one
 * place that decides what is configured — the file beside `.env.local` — and a
 * Turn that runs after the reader changes it sees the change rather than a Root
 * captured when this module loaded.
 */
function makeTools(reading: ReadingRoot) {
  return {
    list_files: tool({
      description: [
        "List what is inside one folder of the project.",
        "Use this when you need to see what is there before reading a file, or to find out what a",
        "folder is called.",
        "`path` is relative to the project root — for example \"src\" — and may be left out to list",
        "the project root itself.",
        "Folders are listed before files. An entry whose kind is \"link\" is a symbolic link, and",
        "read_file will say whether it can be followed.",
        "This tool only reads. It cannot change, move or delete anything.",
      ].join(" "),
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe("Folder to list, relative to the project root. Omit for the project root itself."),
      }),
      execute: async ({ path: asked }, options): Promise<ListingOrRefusal> =>
        listNamedFolder(reading, asked ?? ".", options as CallOptions),
    }),

    read_file: tool({
      description: [
        "Read a text file, with every line numbered so you can cite the line number and the reader",
        "can find it.",
        "Use this on a path list_files or search_files gave you.",
        "`path` is relative to the project root — for example \"src/index.ts\".",
        "A file longer than one read is not refused: you are shown the first part and told which line",
        "to pass as `offset` to read the next part.",
        "Binary files are refused rather than shown, because their bytes would read as words.",
        "This tool only reads. It cannot change, move or delete anything.",
      ].join(" "),
      inputSchema: z.object({
        path: z.string().describe("File to read, relative to the project root."),
        offset: z
          .number()
          .optional()
          .describe("First line to read, counting from 1. Omit to start at the beginning."),
        limit: z
          .number()
          .optional()
          .describe(`Most lines to return, up to ${MAX_READ_LINES}. Omit for the default.`),
      }),
      execute: async ({ path: asked, offset, limit }, options): Promise<FileReadOrRefusal> =>
        readNamedFile(reading, asked, {
          offset,
          limit,
          ...(options as CallOptions),
        }),
    }),

    search_files: tool({
      description: [
        "Search the project for plain text and get back, for every line that contains it, which file",
        "and which line it is on.",
        "Use this when you know what you are looking for but not which file holds it — for example",
        "\"where is this called from\" or \"what does this error mean\".",
        "`query` is plain text, not a regular expression: it matches any line containing it.",
        "`path` limits the search to one folder and may be left out to search the whole project.",
        "`glob` limits it to files whose path matches a pattern written the way a .gitignore line is",
        "— for example \"*.ts\", or \"src/**\" for everything under src.",
        "node_modules, .git and anything named .env are never searched, build output your .gitignore",
        "excludes is skipped, and binary or very large files are not opened.",
        "A search with a great many matches stops early and says so; check `complete` before",
        "concluding that something is not in the project.",
        "This tool only reads. It cannot change, move or delete anything.",
      ].join(" "),
      inputSchema: z.object({
        query: z.string().describe("Plain text to look for on a line. Not a regular expression."),
        path: z
          .string()
          .optional()
          .describe("Folder to search, relative to the project root. Omit for the whole project."),
        glob: z
          .string()
          .optional()
          .describe("Only search files whose path matches this, in .gitignore form. For example *.ts."),
      }),
      execute: async ({ query, path: asked, glob }, options): Promise<SearchOrRefusal> => {
        if (query.trim() === "") return nothingToSearchFor();

        const allowed = await admitPath(
          reading,
          asked ?? ".",
          answeredFor(options),
        );
        if (isRefusal(allowed)) return allowed;

        const only = glob === undefined ? null : compileGlob(glob);
        const name = await namer(reading, allowed.under);
        const matches: SearchMatch[] = [];
        let anyCut = false;

        const walk = await walkFiles({
          from: allowed.path,
          ...(options.abortSignal ? { signal: options.abortSignal } : {}),
          ...(only ? { only: (candidate: string) => only.matches(candidate) } : {}),
          visit: ({ path: file, lines }) => {
            for (let index = 0; index < lines.length && matches.length < MAX_SEARCH_MATCHES; index += 1) {
              if (!lines[index].includes(query)) continue;
              anyCut = anyCut || lines[index].length > MAX_MATCH_CHARS;
              matches.push({
                path: name(file),
                line: index + 1,
                text: lines[index].slice(0, MAX_MATCH_CHARS),
              });
            }

            return matches.length < MAX_SEARCH_MATCHES;
          },
        });

        return {
          ok: true,
          path: name(allowed.path),
          query,
          matches,
          complete: !walk.stopped,
          filesRead: walk.files,
          filesSkipped: walk.filesSkipped,
          foldersSkipped: walk.foldersSkipped,
          note: searchNote(query, matches.length, walk, anyCut),
        };
      },
    }),
  } satisfies ToolSet;
}

/** The three Tools, concretely typed: what a caller hands to `streamText`. */
export type FileTools = ReturnType<typeof makeTools>;

/**
 * The path a Tool Call named, whichever of the three it was.
 *
 * For the approval policy, which is one function over every call and so has to
 * answer "which path is this about" before it can answer "may it be read".
 *
 * `path` is optional on `list_files` and `search_files` so that a Model can say
 * "the whole project" by saying nothing — which a small local Model does, and
 * doing well. A call that named no path is about the Root, which is the same place
 * the Model reaches by writing `.`, so that is what this returns: the policy
 * answers about one place either way, and a missing field is not a second case for
 * it to handle.
 */
export function askedPath(input: { path?: string }): string {
  return input.path ?? ".";
}

export function fileTools(reading: ReadingRoot): FileTools {
  return makeTools(reading);
}

/** How much of one file to send, and on whose authority. */
export type ReadOptions = {
  offset?: number;
  limit?: number;
  /**
   * The reader having said yes to *this* read, when the Tools' own history is not
   * where the answer came from.
   *
   * The three Tools learn it from the signed approval the SDK hands them, because
   * that is the only place an answer can arrive from mid-Turn. A reader who named
   * the file themselves answered in the composer, before there was a Turn to carry
   * an approval, so the server's own record is the channel — and this is where that
   * one comes in. Both are the same fact about the same decision; which channel it
   * travelled is not a difference the read should care about.
   */
  answered?: boolean;
} & Partial<CallOptions>;

/**
 * Whether this read was allowed one Turn by the reader.
 *
 * `answered` wins when it is given, because a caller that has one is telling us
 * about this call specifically rather than about a history it happens to hold.
 */
function answeredFor(input: ReadOptions): boolean {
  if (input.answered !== undefined) return input.answered;
  if (input.toolCallId === undefined || input.messages === undefined) return false;
  return readerApproved(input.messages, input.toolCallId);
}

/**
 * What one file is, read and line-numbered, or why it was not read.
 *
 * The Tool calls this, and so does the composer when a reader names a file in a
 * message. One implementation rather than two because the second thing that
 * matters about a named file is that it is refused exactly as the Tools refuse
 * one: binary bytes refused rather than mangled, a file past the byte cap refused
 * rather than half-sent, a `..` or a link out of the Root refused by the same
 * `mayRead`. A named file that reached the Model through a second code path would
 * be a file with a second set of rules, and the second set is the one nobody
 * remembers to check.
 */
export async function readNamedFile(
  reading: ReadingRoot,
  asked: string,
  input: ReadOptions = {},
): Promise<FileReadOrRefusal> {
  const allowed = await admitPath(reading, asked, answeredFor(input));
  if (isRefusal(allowed)) return allowed;

  const stat = await fs.stat(allowed.path).catch(() => null);
  if (stat === null) return containmentRefusal(asked, "unreadable");
  if (!stat.isFile()) return notAFile(allowed.path);

  const name = (await namer(reading, allowed.under))(allowed.path);

  if (stat.size > MAX_FILE_BYTES) return tooLarge(name, stat.size);

  const bytes = await fs.readFile(allowed.path).catch(() => null);
  if (bytes === null) return containmentRefusal(asked, "unreadable");
  if (looksBinary(bytes)) return notText(name);

  const start = askOffset(input.offset);
  if (typeof start !== "number") return start;

  return readLines({
    name,
    lines: toLines(asText(bytes)),
    start,
    limit: askLimit(input.limit),
  });
}

/**
 * What one folder holds, or why it was not opened.
 *
 * The other half of the same extraction, and for the same reason: a reader who
 * names a folder is naming something to look at, and a folder's listing is what
 * the Model would otherwise have to call `list_files` for — a round trip to learn
 * something the reader had already pointed at. A folder sent as its listing and a
 * folder sent as its contents would also be two different messages, and the second
 * one has no ceiling on it at all.
 */
export async function listNamedFolder(
  reading: ReadingRoot,
  asked: string,
  input: ReadOptions = {},
): Promise<ListingOrRefusal> {
  const allowed = await admitPath(reading, asked, answeredFor(input));
  if (isRefusal(allowed)) return allowed;

  const entries = await fs.readdir(allowed.path, { withFileTypes: true }).catch(() => null);
  if (entries === null) return notAFolder(allowed.path);

  const name = await namer(reading, allowed.under);
  const sorted = [...entries].sort(byKindThenName);
  const shown = Math.min(sorted.length, MAX_LIST_ENTRIES);

  return {
    ok: true,
    path: name(allowed.path),
    entries: await describeEntries(name, allowed.path, sorted),
    total: sorted.length,
    more: shown < sorted.length,
    note: listingNote(shown, sorted.length),
  };
}

/** Folders first, then files, then links, and each group by name. */
function byKindThenName(a: Dirent, b: Dirent): number {
  const byKind = rankOf(a) - rankOf(b);
  return byKind !== 0 ? byKind : a.name.localeCompare(b.name);
}

function rankOf(entry: Dirent): number {
  return entry.isDirectory() ? 0 : entry.isFile() ? 1 : 2;
}

/**
 * The first `MAX_LIST_ENTRIES` entries, described.
 *
 * Only the ones that will be shown are asked about. A folder holding forty
 * thousand files costs one `readdir` rather than forty thousand `lstat` calls, and
 * the count that was left out is reported rather than dropped in silence.
 */
async function describeEntries(
  name: (resolved: string) => string,
  folder: string,
  sorted: Dirent[],
): Promise<Entry[]> {
  const shown: Entry[] = [];

  for (const entry of sorted.slice(0, MAX_LIST_ENTRIES)) {
    const whole = path.join(folder, entry.name);
    const kind = kindOf(entry);
    shown.push({
      name: entry.name,
      path: name(whole),
      kind,
      size: kind === "file" ? await sizeOf(whole) : null,
    });
  }

  return shown;
}

function kindOf(entry: Dirent): Entry["kind"] {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "link";
}

async function sizeOf(target: string): Promise<number | null> {
  try {
    return (await fs.lstat(target)).size;
  } catch {
    return null;
  }
}

function listingNote(shown: number, total: number): string {
  if (shown === 0) return "This folder is empty.";
  if (shown < total) {
    return `Showing ${shown} of ${total} entries. List a folder inside it to see the rest.`;
  }
  return total === 1 ? "1 entry." : `${total} entries.`;
}

/** A path the Root covers: the resolved path to open, and which boundary said so. */
export type Admitted = Extract<Readable, { readable: true }>;

/**
 * The options the SDK hands a Tool, as far as this module reads them.
 *
 * Named so the three `execute` bodies say what they are asking rather than
 * reaching into the SDK's own options shape, and so a Tool this app has no
 * declaration for still gets an answer for the same reason a declared one does.
 */
type CallOptions = { toolCallId: string; messages: ModelMessage[] };


/**
 * The one gate every path the Model names goes through.
 *
 * All three Tools ask this rather than calling `mayRead` themselves, so that
 * "was this path allowed, and if not, what is the Model told" is decided once.
 * Three copies of the same question are three answers to keep in step with each
 * other, and the copy that drifts is the one nobody remembers to check.
 *
 * `answered` is the reader having said yes to this call, which admits the path
 * for this one read. It is asked of the history the SDK hands every Tool, rather
 * than kept here, because the SDK has verified that history's signatures before it
 * ran anything — so a Tool that executes is one whose answer the server issued.
 *
 * The refusal is built here rather than by the caller so that it is *this*
 * function's answer: a caller that wrote its own message for the same refusal
 * would be free to word it as a failure of the machinery, which is what a Model
 * needs not to be told when it was simply asking outside the Root.
 */
async function admitPath(
  reading: ReadingRoot,
  asked: string,
  answered: boolean,
): Promise<Admitted | Refusal> {
  const allowed = await mayRead(reading, asked, answered);
  return allowed.readable ? allowed : containmentRefusal(asked, allowed.reason);
}

/**
 * Whether the answer is a refusal rather than a path to open.
 *
 * There is no shared discriminant to switch on, because the two sides are
 * different kinds of thing: one is the disk's — a path with no link left in it —
 * and the other is a result the Model reads. What separates them is the one that
 * matters, which is whether there is anything left to open.
 */
function isRefusal(answer: Admitted | Refusal): answer is Refusal {
  return !("path" in answer);
}

function containmentRefusal(asked: string, reason: Reason): Refusal {
  return refuse(
    reason,
    reason === "outside"
      ? `\`${asked}\` is outside the folder the reader shared, so it was not read. Say so in your answer rather than looking for it another way.`
      : reason === "unreadable"
        ? `There is nothing at \`${asked}\`. Call list_files to see what is there.`
        : `\`${asked}\` is not a path that can be read. Paths are relative to the project root, such as \"src/index.ts\".`,
  );
}

function nothingToSearchFor(): Refusal {
  return refuse(
    "not-asked-well",
    "A search needs something to look for, and this query is empty. Give query the words to match on a line, such as a function name or an error message.",
  );
}

function searchNote(query: string, found: number, walk: WalkOutcome, anyCut: boolean): string {
  const partial = walk.stopped
    ? " The search stopped early, so this is part of the answer: there may be more in files it did not reach."
    : "";

  if (found === 0) {
    return `No line contains "${query}" in the ${walk.files} ${walk.files === 1 ? "file" : "files"} read.${partial}`;
  }

  const lines = `${found} ${found === 1 ? "line" : "lines"} contain "${query}", out of ${walk.files} ${
    walk.files === 1 ? "file" : "files"
  } read.`;

  const cut = anyCut
    ? ` Lines longer than ${MAX_MATCH_CHARS} characters are cut short; use read_file on that file and line to see one whole.`
    : "";

  return `${lines}${cut}${partial}`;
}

function notAFolder(resolved: string): Refusal {
  return refuse(
    "not-a-directory",
    `\`${resolved}\` is a file, not a folder. Call read_file to read it.`,
  );
}

function notAFile(resolved: string): Refusal {
  return refuse(
    "not-a-file",
    `\`${resolved}\` is a folder, not a file. Call list_files to see what is in it.`,
  );
}

function notText(name: string): Refusal {
  return refuse(
    "not-text",
    `\`${name}\` is not text — it holds bytes that are not characters — so it was not shown. Showing them would put mangled content in your answer that reads as if it were the file.`,
  );
}

/**
 * A file over the read ceiling, refused rather than cut.
 *
 * The cap on what one *call* returns is not this, and the two are deliberately
 * different: a file longer than one read is answered with a piece of it and a
 * line to come back at, while a file this size is refused outright. A megabyte
 * is already a whole page of prose the Model did not ask to be handed; anything
 * larger is a bundle, a lock file or a data dump, and pointing a Model at the
 * first two thousand lines of one is worse than saying it is too big — it produces
 * a confident answer about a file nobody could have read.
 */
function tooLarge(name: string, size: number): Refusal {
  return refuse(
    "too-large",
    `\`${name}\` is ${size} bytes, which is more than the ${MAX_FILE_BYTES} bytes any of these tools will open. It was not read.`,
  );
}

/**
 * Where a read starts, in the file's own numbering.
 *
 * One-based, because that is how the lines are numbered in the result and how a
 * reader counts in an editor — a Model that has been shown `2000: …` has to be
 * able to pass `2000` and get that line back. Zero and negatives are refused with
 * a sentence rather than quietly corrected, because a Model that passed 0 has
 * made a mistake worth telling it about.
 */
function askOffset(offset: number | undefined): number | Refusal {
  if (offset === undefined) return 1;
  if (!Number.isInteger(offset) || offset < 1) {
    return refuse(
      "not-asked-well",
      `offset must be a whole line number of 1 or more, because lines are numbered from 1. \`${offset}\` is not one.`,
    );
  }
  return offset;
}

/** How many lines to show, never more than the cap however the Model spells it. */
function askLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_READ_LINES;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_READ_LINES);
}

/**
 * The piece of a file one read answers with, and a sentence saying which piece.
 *
 * `totalLines` is the whole file's count however much of it is shown, so a Model
 * can tell a short file from a cut one without reading the note. The note repeats
 * it anyway, because a note is the part a small Model actually reads.
 */
function readLines(input: {
  name: string;
  lines: string[];
  start: number;
  limit: number;
}): FileRead {
  const { name, lines, start, limit } = input;
  const total = lines.length;
  const shown = lines.slice(start - 1, start - 1 + limit);

  // `null` rather than `start` when nothing was shown: a read that began past the
  // end has reached the end, and handing back the line it started at would invite
  // the Model to call again with the same offset and get nothing a second time.
  const continuesAtLine = shown.length > 0 && shown.length < total ? start + shown.length : null;

  return {
    ok: true,
    path: name,
    startLine: start,
    totalLines: total,
    lines: withLineNumbers(shown, start),
    continuesAtLine,
    note: readNote(name, start, shown.length, total, continuesAtLine),
  };
}

function readNote(
  name: string,
  start: number,
  shown: number,
  total: number,
  continuesAtLine: number | null,
): string {
  if (total === 0) return "This file is empty.";

  // Before the span is worked out, because a read that started past the end has no
  // span: `900-899 of 10 lines` is a sentence no Model and no reader can use.
  if (shown === 0) {
    return `Nothing here: the file has ${total} lines and this read starts at line ${start}, which is past the end.`;
  }

  const span = shown === 1 ? `${start}` : `${start}-${start + shown - 1}`;

  if (continuesAtLine === null) {
    return start === 1
      ? total === 1
        ? "1 line. This is the whole file."
        : `${total} lines. This is the whole file.`
      : `${span} of ${total} lines. This is the end of the file.`;
  }

  return `Showing lines ${span} of ${total}. Call read_file again with path: "${name}", offset: ${continuesAtLine} to read the rest.`;
}
