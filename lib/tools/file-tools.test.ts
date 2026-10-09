import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  fileTools,
  MAX_FILE_BYTES,
  MAX_LIST_ENTRIES,
  MAX_READ_LINES,
  MAX_SEARCH_MATCHES,
  type FileRead,
  type Listing,
  type Refusal,
  type SearchResults,
} from "./file-tools";

/**
 * The three Tools the Model navigates a folder with, seen at the only place
 * anything can see them: what `execute` hands back.
 *
 * Everything here runs against a folder that is really on disk, because the
 * questions these Tools answer are questions about a disk — whether a path is a
 * link, whether a file is text, how big it is. A mocked `fs` would answer all of
 * them by construction, and the failure it cannot catch is the one that matters:
 * a path the Tools admit that turns out to point somewhere else once the
 * filesystem has had its say.
 */

/**
 * `mkdtemp` under the system temporary directory, which on macOS is reached
 * through a symlink (`/var` -> `/private/var`) — the everyday case where the
 * boundary a reader names and the one the disk has are different strings.
 */
let project = "";
let root = "";

beforeEach(async () => {
  await rm(project, { recursive: true, force: true });
  project = await realpath(await mkdtemp(path.join(tmpdir(), "file-tools-")));
  root = path.join(project, "project");
  await mkdir(root);
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

async function folder(...segments: string[]): Promise<string> {
  const made = path.join(root, ...segments);
  await mkdir(made, { recursive: true });
  return made;
}

async function write(relative: string, contents: string): Promise<string> {
  const written = path.join(root, relative);
  await mkdir(path.dirname(written), { recursive: true });
  await writeFile(written, contents, "utf8");
  return written;
}

/** A folder beside the Root, which the Root does not cover. */
async function outsideFolder(...segments: string[]): Promise<string> {
  const made = path.join(project, ...segments);
  await mkdir(made, { recursive: true });
  return made;
}

/** A file under the Root holding exactly these bytes. */
async function writeBytes(relative: string, bytes: Uint8Array): Promise<string> {
  const written = path.join(root, relative);
  await mkdir(path.dirname(written), { recursive: true });
  await writeFile(written, bytes);
  return written;
}

/**
 * The options the SDK hands a Tool alongside its input. None of the three reads
 * them, but `execute` is given one and the type has to be satisfied.
 */
const CALL = { toolCallId: "call-1", messages: [], context: undefined } as never;

function listFiles(input: { path?: string }): Promise<Listing | Refusal> {
  return fileTools({ root, grants: [], malformed: false }).list_files.execute(input, CALL) as Promise<
    Listing | Refusal
  >;
}

describe("a folder the Model names", () => {
  it("is answered with what is in it, folders before files and each group by name", async () => {
    await write("src/index.ts", "the entry point\n");
    await write("README.md", "the project\n");
    await folder("notes");

    expect(await listFiles({ path: "." })).toMatchObject({
      ok: true,
      entries: [
        { name: "notes", kind: "directory", size: null },
        { name: "src", kind: "directory", size: null },
        { name: "README.md", kind: "file", size: "the project\n".length },
      ],
    });
  });

  it("is answered as empty rather than as an error, because an empty folder is an answer", async () => {
    await folder("empty");

    const listing = await listFiles({ path: "empty" });

    expect(listing).toMatchObject({ ok: true, entries: [], total: 0, more: false });
    // The Model is told it is empty rather than left to infer it from a list
    // with nothing in it, which reads the same as a folder that was never read.
    expect(listing).toMatchObject({ note: "This folder is empty." });
  });

  it("answers a folder the Model named relatively, and says where it looked", async () => {
    await write("src/index.ts", "the entry point\n");

    // Relative in, relative out: a path the Model can hand straight back.
    expect(await listFiles({ path: "src" })).toMatchObject({
      ok: true,
      path: "src",
      entries: [{ name: "index.ts", path: "src/index.ts" }],
    });
  });

  it("refuses a file where a folder was asked for, and says which it was", async () => {
    await write("README.md", "the project\n");

    expect(await listFiles({ path: "README.md" })).toMatchObject({
      ok: false,
      reason: "not-a-directory",
    });
  });

  it("answers a link as a link, because whether it can be followed is not known until it is read", async () => {
    await write("README.md", "the project\n");
    await symlink(path.join(root, "README.md"), path.join(root, "link-to-readme"));

    // Reporting a link as a file or a folder would be a claim about what it
    // points at, which is exactly the thing the Model would then rely on.
    expect((await listFiles({ path: "." })) as Listing).toMatchObject({
      entries: expect.arrayContaining([
        { name: "link-to-readme", kind: "link", path: "link-to-readme", size: null },
      ]),
    });
  });

  it("says how many entries it left out, rather than showing a short list that reads as the whole folder", async () => {
    await folder("crowded");
    await Promise.all(
      Array.from({ length: MAX_LIST_ENTRIES + 25 }, (_, index) =>
        writeFile(path.join(root, "crowded", `f${index}.txt`), "x", "utf8"),
      ),
    );

    const listing = (await listFiles({ path: "crowded" })) as Listing;

    expect(listing.entries).toHaveLength(MAX_LIST_ENTRIES);
    expect(listing).toMatchObject({ total: MAX_LIST_ENTRIES + 25, more: true });
    expect(listing.note).toBe(
      `Showing ${MAX_LIST_ENTRIES} of ${MAX_LIST_ENTRIES + 25} entries. List a folder inside it to see the rest.`,
    );
  });

  it("refuses a path carrying a null byte, rather than letting it reach the disk", async () => {
    expect(await listFiles({ path: `src${String.fromCharCode(0)}/secrets` })).toMatchObject({
      ok: false,
      reason: "unusable",
    });
  });
});

describe("a machine that has named no Root", () => {
  it("is told the same three things it would be told for a path outside, because nothing is inside", async () => {
    // Not an error and not a special case: with no Root there is no boundary, so
    // there is nothing a path could have been inside. The Tools behave exactly as
    // they do for an outside path, which is also why the chat route passes none of
    // them at all when no Root has been declared.
    const none = fileTools({ root: null, grants: [], malformed: false });

    for (const call of [
      none.list_files.execute({ path: "src" }, CALL),
      none.read_file.execute({ path: "src/index.ts" }, CALL),
      none.search_files.execute({ query: "port" }, CALL),
    ]) {
      expect(await call).toMatchObject({ ok: false, reason: "outside" });
    }
  });
});

describe("a path a Grant covers", () => {
  it("is read, and comes back as the whole path because there is no shorter form of it", async () => {
    const granted = await outsideFolder("documents");
    await writeFile(path.join(granted, "notes.md"), "a note the reader allowed\n", "utf8");
    const reading = { root, grants: [granted], malformed: false };

    // Relative to the Root would be a path that means something else, so a Grant's
    // paths are absolute. Both round-trip: `mayRead` admits this one again.
    const read = (await fileTools(reading).read_file.execute({ path: granted + "/notes.md" }, CALL)) as FileRead;

    expect(read).toMatchObject({ ok: true, path: `${granted}/notes.md`, totalLines: 1 });
  });
});

describe("a path the Root does not cover", () => {
  it("is refused by containment rather than by a check of its own", async () => {
    // A link *inside* the Root pointing at a folder beside it. A Tool that
    // compared the string it was handed to the Root would admit this, because the
    // string does start with the Root; only resolving first and comparing what
    // came out refuses it. That is the whole of what the symlink is for here.
    const elsewhere = await outsideFolder("secrets");
    await writeFile(path.join(elsewhere, "id_rsa"), "PRIVATE KEY", "utf8");
    await folder("link-to-secrets");
    await symlink(elsewhere, path.join(root, "link-to-secrets", "keys"));

    expect(await listFiles({ path: "link-to-secrets/keys" })).toMatchObject({
      ok: false,
      reason: "outside",
    });
  });

  it("is refused with a sentence the Model can act on, rather than a bare code", async () => {
    await outsideFolder("secrets");

    const answer = await listFiles({ path: "../secrets" });

    expect(answer).toMatchObject({ ok: false, reason: "outside" });
    // The refusal names the path and says not to reach for it another way, which
    // is what stops a Model turning one refusal into a Turn full of them.
    expect(answer).toMatchObject({
      note: expect.stringContaining("`../secrets` is outside the folder the reader shared"),
    });
  });
});

describe("a read the reader has answered", () => {
  /**
   * The history the SDK hands a Tool when the reader has answered one question
   * about one call: the request names both ids, and the response names the
   * approval.
   *
   * `askedFor` and `running` are separate because they can differ, and that is
   * the case worth pinning: an answer is about the call that was asked about, not
   * about whichever call happens to be running.
   */
  function answered(approved: boolean, askedFor = "call-1", running = askedFor): never {
    return {
      toolCallId: running,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: askedFor, toolName: "read_file", input: {} },
            {
              type: "tool-approval-request",
              approvalId: "aitxt-1",
              toolCallId: askedFor,
              reason: "outside the folder you shared",
            },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-approval-response", approvalId: "aitxt-1", approved }],
        },
      ],
      context: undefined,
    } as never;
  }

  it("is read, so the answer the interface collected is the read that happens", async () => {
    const elsewhere = await outsideFolder("notes");
    await writeFile(path.join(elsewhere, "todo.md"), "ship the thing\n", "utf8");

    // Without this the reader presses "allow" and watches a Turn say the file was
    // not read — which is not a refusal the reader can act on, because there is
    // nothing left for them to do about it.
    const read = (await fileTools({ root, grants: [], malformed: false }).read_file.execute(
      { path: "../notes/todo.md" },
      answered(true),
    )) as FileRead;

    expect(read).toMatchObject({ ok: true, totalLines: 1, lines: ["1: ship the thing"] });
  });

  it("is not read for a call the reader was not asked about", async () => {
    const elsewhere = await outsideFolder("notes");
    await writeFile(path.join(elsewhere, "todo.md"), "ship the thing\n", "utf8");

    // The approval was for `call-1`. This call is `call-2`, and it inherits
    // nothing: an answer is about the call that was asked about.
    const read = (await fileTools({ root, grants: [], malformed: false }).read_file.execute(
      { path: "../notes/todo.md" },
      answered(true, "call-1", "call-2"),
    )) as Refusal;

    expect(read).toMatchObject({ ok: false, reason: "outside" });
  });

  it("is not read when the reader said no, whatever reached the Tool", async () => {
    await outsideFolder("notes");

    // The SDK blocks a denied call before it runs. A Tool that read it anyway
    // because the history happened to mention an approval would turn a refusal
    // into a read, which is the one thing this whole feature exists to prevent.
    const read = (await fileTools({ root, grants: [], malformed: false }).read_file.execute(
      { path: "../notes" },
      answered(false),
    )) as Refusal;

    expect(read).toMatchObject({ ok: false, reason: "outside" });
  });

  it("opens a folder outside the Root once the reader has answered for it", async () => {
    const elsewhere = await outsideFolder("notes");
    await writeFile(path.join(elsewhere, "todo.md"), "ship the thing\n", "utf8");

    // All three Tools, not just `read_file`: the answer admits a path, and a
    // Tool that asked the question its own way would be a second gate.
    const tools = fileTools({ root, grants: [], malformed: false });
    const listing = (await tools.list_files.execute({ path: "../notes" }, answered(true))) as Listing;

    expect(listing).toMatchObject({ ok: true, entries: [{ name: "todo.md", kind: "file" }] });
  });
});

function readFile(input: { path: string; offset?: number; limit?: number }): Promise<FileRead | Refusal> {
  return fileTools({ root, grants: [], malformed: false }).read_file.execute(input, CALL) as Promise<
    FileRead | Refusal
  >;
}

describe("a file the Model names", () => {
  it("is answered with its contents, every line carrying the number it has in the file", async () => {
    await write("src/index.ts", "const port = 3000;\n\nserver.listen(port);\n");

    expect(await readFile({ path: "src/index.ts" })).toMatchObject({
      ok: true,
      path: "src/index.ts",
      startLine: 1,
      totalLines: 3,
      lines: ["1: const port = 3000;", "2: ", "3: server.listen(port);"],
      continuesAtLine: null,
    });
  });

  it("is answered as empty rather than as an error, because an empty file is an answer", async () => {
    await write("notes.md", "");

    const answer = await readFile({ path: "notes.md" });

    expect(answer).toMatchObject({ ok: true, lines: [], totalLines: 0, continuesAtLine: null });
    // Said outright, because a list of no lines is indistinguishable from a file
    // that was never read — and a Model that cannot tell those apart will say the
    // file is empty when in fact it was not read.
    expect(answer).toMatchObject({ note: "This file is empty." });
  });

  it("refuses a folder where a file was asked for, and says which it was", async () => {
    await folder("src");

    expect(await readFile({ path: "src" })).toMatchObject({
      ok: false,
      reason: "not-a-file",
    });
  });
});

describe("a file longer than one read", () => {
  it("is cut at the cap with the line to ask for next, rather than refused", async () => {
    await write("big.txt", linesOf(2_500).join("\n"));

    const answer = await readFile({ path: "big.txt" });

    // The cap is on what one call returns, not on what may be read at all: a
    // Model asking for a long file is answered with a piece of it and told
    // exactly where the next piece begins.
    expect(answer).toMatchObject({
      ok: true,
      startLine: 1,
      totalLines: 2_500,
      continuesAtLine: expect.any(Number),
    });
    expect((answer as FileRead).lines).toHaveLength(MAX_READ_LINES);
    expect((answer as FileRead).lines[0]).toBe("1: line 1");
    expect((answer as FileRead).lines[MAX_READ_LINES - 1]).toBe(`${MAX_READ_LINES}: line ${MAX_READ_LINES}`);
  });

  it("says in the note how much was cut and what to pass to read the rest", async () => {
    await write("big.txt", linesOf(2_500).join("\n"));

    // A partial read that reads like a whole file produces a confidently wrong
    // answer, so the note has to say which lines these are out of how many, and
    // what to ask for next.
    expect(await readFile({ path: "big.txt" })).toMatchObject({
      note: `Showing lines 1-${MAX_READ_LINES} of 2500. Call read_file again with path: "big.txt", offset: ${
        MAX_READ_LINES + 1
      } to read the rest.`,
    });
  });

  it("numbers from where the Model asked rather than from the top of the file", async () => {
    await write("big.txt", linesOf(2_500).join("\n"));

    // Line numbers must survive an offset: the Model cites a line, and the reader
    // then has to find it in the file rather than in the transcript.
    const answer = await readFile({ path: "big.txt", offset: 2_000, limit: 3 });

    expect(answer).toMatchObject({
      ok: true,
      startLine: 2_000,
      totalLines: 2_500,
      lines: ["2000: line 2000", "2001: line 2001", "2002: line 2002"],
      continuesAtLine: 2_003,
    });
  });

  it("answers the whole file when it fits inside one read, and says so", async () => {
    await write("small.txt", linesOf(10).join("\n"));

    expect(await readFile({ path: "small.txt" })).toMatchObject({
      ok: true,
      totalLines: 10,
      continuesAtLine: null,
      note: "10 lines. This is the whole file.",
    });
  });

  it("answers an offset past the end with nothing rather than with an error", async () => {
    await write("small.txt", linesOf(10).join("\n"));

    const answer = await readFile({ path: "small.txt", offset: 900 });

    expect(answer).toMatchObject({ ok: true, startLine: 900, totalLines: 10, lines: [] });
    expect(answer).toMatchObject({ note: expect.stringContaining("the file has 10 lines") });
  });
});

function linesOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`);
}

describe("a file that is not text", () => {
  it("is refused rather than shown, so its bytes never reach the transcript looking like content", async () => {
    // A PNG header: real bytes a real project holds. Decoded leniently these come
    // back as a string of replacement characters, and a Model quoting that string
    // back to the reader is quoting something that was never in the file.
    const written = path.join(root, "logo.png");
    await writeFile(
      written,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
    );

    expect(await readFile({ path: "logo.png" })).toMatchObject({
      ok: false,
      reason: "not-text",
    });
  });

  it("is refused when it is only bytes rather than characters, even with no null in it", async () => {
    // Latin-1, which is what a machine with older files has. There is no null
    // byte anywhere in it, so the null-byte test alone would pass it through.
    const written = path.join(root, "legacy.txt");
    await writeFile(written, Buffer.from([0x63, 0x61, 0x66, 0xe9]));

    expect(await readFile({ path: "legacy.txt" })).toMatchObject({ ok: false, reason: "not-text" });
  });

  it("is refused with a sentence that says why, rather than a code on its own", async () => {
    await writeBytes("logo.png", Buffer.from([0x00, 0x01, 0x02]));

    expect(await readFile({ path: "logo.png" })).toMatchObject({
      note: expect.stringContaining("`logo.png` is not text"),
    });
  });
});

describe("a file larger than any read is allowed to be", () => {
  it("is refused with its size in the sentence, rather than cut to the first two thousand lines", async () => {
    await writeBytes("huge.log", Buffer.alloc(MAX_FILE_BYTES + 1, 0x61));

    const answer = await readFile({ path: "huge.log" });

    expect(answer).toMatchObject({ ok: false, reason: "too-large" });
    expect(answer).toMatchObject({
      note: expect.stringContaining(`is ${MAX_FILE_BYTES + 1} bytes, which is more than the ${MAX_FILE_BYTES} bytes`),
    });
  });

  it("is read when it is exactly at the cap, because a cap that refused its own boundary would refuse twice as much", async () => {
    await writeBytes("exactly.txt", Buffer.alloc(MAX_FILE_BYTES, 0x61));

    expect(await readFile({ path: "exactly.txt" })).toMatchObject({ ok: true, totalLines: 1 });
  });
});

describe("arguments the Model got wrong", () => {
  it("are refused with a sentence naming what would be accepted", async () => {
    await write("notes.md", "one\ntwo\n");

    // Zero is not a line number a reader can find, so it is corrected by telling
    // the Model rather than by quietly reading from the top.
    const answer = await readFile({ path: "notes.md", offset: 0 });

    expect(answer).toMatchObject({ ok: false, reason: "not-asked-well" });
    expect(answer).toMatchObject({ note: expect.stringContaining("offset must be a whole line number of 1 or more") });
  });

  it("still reads the file when the offset is a plain out-of-range one", async () => {
    await write("notes.md", "one\ntwo\n");

    // A Model asking past the end has made a recoverable mistake, not a wrong
    // one: it is told how long the file is and gets an empty answer rather than a
    // refusal that reads as a failure to read at all.
    expect(await readFile({ path: "notes.md", offset: 50 })).toMatchObject({
      ok: true,
      lines: [],
      totalLines: 2,
    });
  });

  it("offers no line to continue at when the read began past the end", async () => {
    await write("notes.md", "one\ntwo\n");

    // Handing back the offset it just used would invite a second call with the
    // same argument and the same empty answer, which is how one bad offset
    // becomes two wasted steps of a Turn.
    expect(await readFile({ path: "notes.md", offset: 50 })).toMatchObject({
      continuesAtLine: null,
    });
  });

  it("never returns more lines than the cap, however large a limit the Model asked for", async () => {
    await write("big.txt", linesOf(2_500).join("\n"));

    // The cap is this app's, not the Model's: a Model asking for a hundred
    // thousand lines gets the ceiling rather than a hundred thousand lines of
    // someone else's file.
    const answer = (await readFile({ path: "big.txt", limit: 100_000 })) as FileRead;

    expect(answer.lines).toHaveLength(MAX_READ_LINES);
    expect(answer.lines.at(-1)).toBe(`${MAX_READ_LINES}: line ${MAX_READ_LINES}`);
  });
});

describe("a path the Root does not cover, asked of read_file", () => {
  it("is refused before the file is opened", async () => {
    const elsewhere = await outsideFolder("secrets");
    await writeFile(path.join(elsewhere, "id_rsa"), "PRIVATE KEY", "utf8");
    await symlink(elsewhere, path.join(root, "keys"));

    expect(await readFile({ path: "keys/id_rsa" })).toMatchObject({
      ok: false,
      reason: "outside",
    });
  });
});

function searchFiles(input: {
  query: string;
  path?: string;
  glob?: string;
}): Promise<SearchResults | Refusal> {
  return fileTools({ root, grants: [], malformed: false }).search_files.execute(input, CALL) as Promise<
    SearchResults | Refusal
  >;
}

describe("a search for plain text", () => {
  it("answers with the lines that hold it, each naming its file and its line", async () => {
    await write("src/server.ts", "const port = 3000;\nserver.listen(port);\n");
    await write("src/other.ts", "nothing to see\n");

    expect(await searchFiles({ query: "port" })).toMatchObject({
      ok: true,
      query: "port",
      matches: [
        { path: "src/server.ts", line: 1, text: "const port = 3000;" },
        { path: "src/server.ts", line: 2, text: "server.listen(port);" },
      ],
      complete: true,
    });
  });

  it("answers no matches as an answer rather than as an error", async () => {
    await write("src/server.ts", "const port = 3000;\n");

    const answer = await searchFiles({ query: "kubernetes" });

    expect(answer).toMatchObject({ ok: true, matches: [], complete: true });
    expect(answer).toMatchObject({
      note: 'No line contains "kubernetes" in the 1 file read.',
    });
  });

  it("looks in the whole project unless it is told where, and where it looked is said back", async () => {
    await write("src/server.ts", "port\n");
    await write("docs/ports.md", "port\n");

    expect(await searchFiles({ query: "port" })).toMatchObject({ path: ".", complete: true });
    expect(await searchFiles({ query: "port", path: "docs" })).toMatchObject({
      path: "docs",
      matches: [{ path: "docs/ports.md" }],
    });
  });

  it("finds text inside a line rather than only lines that are exactly it", async () => {
    await write("notes.md", "before\nthe answer is 42\nafter\n");

    expect(await searchFiles({ query: "answer is" })).toMatchObject({
      matches: [{ path: "notes.md", line: 2, text: "the answer is 42" }],
    });
  });

  it("refuses a query that is nothing, rather than answering with every line in the project", async () => {
    await write("notes.md", "a line\n");

    expect(await searchFiles({ query: "  " })).toMatchObject({
      ok: false,
      reason: "not-asked-well",
    });
  });
});

describe("a search over a folder", () => {
  it("stops at the cap and says in the result that it did", async () => {
    await write("many.txt", linesOf(MAX_SEARCH_MATCHES + 100).map((line) => `hit ${line}`).join("\n"));

    const answer = (await searchFiles({ query: "hit" })) as SearchResults;

    expect(answer.matches).toHaveLength(MAX_SEARCH_MATCHES);
    // A search that stopped early and said nothing reads as a complete answer,
    // and a Model that believes it found everything will answer on that belief.
    expect(answer.complete).toBe(false);
    expect(answer.note).toContain("stopped early");
  });

  it("still says complete when it finished, so the flag means something", async () => {
    await write("one.txt", "a hit here\n");

    expect(await searchFiles({ query: "hit" })).toMatchObject({ complete: true });
  });

  it("does not walk into `node_modules`, `.git`, or anything named `.env*`", async () => {
    await write("src/server.ts", "the needle\n");
    await write("node_modules/left-pad/index.js", "the needle\n");
    await write(".git/COMMIT_EDITMSG", "the needle\n");
    await write(".env.local", "the needle\n");
    await write("src/.env.development", "the needle\n");

    // Not one search result and not one file opened: the first three are volume
    // and the fourth is a Credential, and a search that read one of them would be
    // putting something in the transcript that the reader did not ask about.
    expect(await searchFiles({ query: "the needle" })).toMatchObject({
      matches: [{ path: "src/server.ts", line: 1 }],
      filesRead: 1,
    });
  });

  it("honours a `.gitignore` in the folder it is walking, because that is where the developer said not to look", async () => {
    await write("src/server.ts", "the needle\n");
    await write(".gitignore", "dist/\n*.log\n");
    await write("dist/bundle.js", "the needle\n");
    await write("debug.log", "the needle\n");
    await write("src/debug.log", "the needle\n");

    expect(await searchFiles({ query: "the needle" })).toMatchObject({
      matches: [{ path: "src/server.ts" }],
      complete: true,
    });
  });

  it("honours a `.gitignore` further down, where the one in force is the one beside the file", async () => {
    await write(".gitignore", "*.log\n");
    await write("src/.gitignore", "!important.log\n");
    await write("src/important.log", "the needle\n");
    await write("top.log", "the needle\n");

    expect(await searchFiles({ query: "the needle" })).toMatchObject({
      matches: [{ path: "src/important.log" }],
    });
  });

  it("passes over a file larger than any read without opening it", async () => {
    await write("src/server.ts", "the needle\n");
    // A file that would match if it were read, and cannot be: proving the match
    // is absent proves the walk asked the size first rather than reading and
    // measuring afterwards.
    await writeBytes("huge.log", Buffer.concat([Buffer.alloc(MAX_FILE_BYTES + 1, 0x61), Buffer.from("\nthe needle\n")]));

    const answer = await searchFiles({ query: "the needle" });

    expect(answer).toMatchObject({ matches: [{ path: "src/server.ts" }], filesRead: 1 });
    expect(answer).toMatchObject({ filesSkipped: 1 });
    expect(answer).toMatchObject({ complete: true });
  });

  it("passes over a file that is not text, because its bytes would read as a match that is not one", async () => {
    await write("src/server.ts", "the needle\n");
    // The needle is in there as plain characters, after a null byte. Decoded
    // leniently this reads as a line containing the needle, and a Model would
    // quote a match out of a file that holds none.
    await writeBytes("logo.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x00]), Buffer.from("the needle\n")]));

    expect(await searchFiles({ query: "the needle" })).toMatchObject({
      matches: [{ path: "src/server.ts" }],
      filesRead: 1,
      filesSkipped: 1,
    });
  });

  it("does not follow a link out of the Root, because it does not follow links at all", async () => {
    const elsewhere = await outsideFolder("secrets");
    await writeFile(path.join(elsewhere, "notes.md"), "the needle\n", "utf8");
    await write("src/server.ts", "nothing here\n");
    await symlink(elsewhere, path.join(root, "escape"));

    expect(await searchFiles({ query: "the needle" })).toMatchObject({
      matches: [],
      filesRead: 1,
    });
  });

  it("does not open a link to a file either, which is the same rule and the other half of it", async () => {
    // A link to a file outside the Root is the shape an attacker would use rather
    // than a link to a folder, and it is the one a walk that only refuses to
    // *descend* would still open: the entry is not a folder, so nothing stops it,
    // and the bytes that come back are somebody else's.
    const elsewhere = await outsideFolder("secrets");
    await writeFile(path.join(elsewhere, "notes.md"), "the needle\n", "utf8");
    await symlink(path.join(elsewhere, "notes.md"), path.join(root, "linked-note.md"));
    await write("src/server.ts", "nothing here\n");

    expect(await searchFiles({ query: "the needle" })).toMatchObject({
      matches: [],
      filesRead: 1,
      filesSkipped: 1,
    });
  });

  it("does not follow a link that stays inside the Root either", async () => {
    // Deliberate, and it costs something: a project holding its sources in links
    // will not find them. Following some links and not others is the version that
    // is hard to reason about, and the one that has to be re-checked every time
    // the walk changes.
    await write("src/server.ts", "the needle\n");
    await symlink(path.join(root, "src", "server.ts"), path.join(root, "alias.ts"));

    expect(await searchFiles({ query: "the needle" })).toMatchObject({
      matches: [{ path: "src/server.ts" }],
      filesRead: 1,
      filesSkipped: 1,
    });
  });
});

describe("a search narrowed by a glob", () => {
  it("keeps only the files whose path matches, in the same shape a `.gitignore` line takes", async () => {
    await write("src/server.ts", "the needle\n");
    await write("src/server.test.ts", "the needle\n");
    await write("docs/guide.md", "the needle\n");

    // Alphabetical, so the transcript reads the same on every machine: `readdir`
    // answers in whatever order the filesystem holds.
    expect(await searchFiles({ query: "the needle", glob: "*.ts" })).toMatchObject({
      matches: [{ path: "src/server.test.ts" }, { path: "src/server.ts" }],
    });
    expect(await searchFiles({ query: "the needle", glob: "src/**" })).toMatchObject({
      matches: [{ path: "src/server.test.ts" }, { path: "src/server.ts" }],
    });
  });

  it("does not count a file the glob excluded as one it read", async () => {
    await write("src/server.ts", "the needle\n");
    await write("docs/guide.md", "the needle\n");

    // The glob narrows which files are opened, not only which matches come back,
    // so the count of work done is true rather than flattering.
    expect(await searchFiles({ query: "the needle", glob: "*.ts" })).toMatchObject({
      filesRead: 1,
    });
  });
});

describe("a search pointed outside the Root", () => {
  it("is refused by containment, and never reaches the folder", async () => {
    const elsewhere = await outsideFolder("secrets");
    await writeFile(path.join(elsewhere, "notes.md"), "the needle\n", "utf8");

    expect(await searchFiles({ query: "the needle", path: "../secrets" })).toMatchObject({
      ok: false,
      reason: "outside",
    });
  });
});
