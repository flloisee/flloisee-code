import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { namedPaths } from "./named-path";

/**
 * What counts as a path in a message the reader wrote.
 *
 * The reader names a file either by picking it from the Root with `@` or by
 * pasting where it is, and both arrive as the same ordinary text — so this one
 * function is the whole of how the app decides a message is about a file. It runs
 * twice over the same message: once in the composer so the reader can be asked
 * before they send, and once on the server so the answer cannot be forged.
 *
 * These are therefore tests about a rule rather than about a parser, and the rule
 * is mostly about what this must **not** recognise: recognising too much turns an
 * ordinary sentence into a file request, and a file request is a question put in
 * front of the reader at the worst possible moment.
 */

const NAMED = "a path the reader named";

describe(NAMED, () => {
  it("is found in the middle of a sentence, because that is where a reader writes it", () => {
    expect(namedPaths("what does src/util.ts do?")).toEqual(["src/util.ts"]);
  });

  it("is found in a message of nothing else", () => {
    expect(namedPaths("src/util.ts")).toEqual(["src/util.ts"]);
  });

  it("is found in absolute form, which is what a terminal and a file dialog hand over", () => {
    expect(namedPaths("look at /Users/fll/project/src/index.ts please")).toEqual([
      "/Users/fll/project/src/index.ts",
    ]);
  });

  it("is found written the way the Root writes it, so a picked file and a typed one are one thing", () => {
    // The `@` menu inserts a Root-relative path with the reader's own `@` still on
    // it. If this did not recognise what the menu inserts — mark and all — picking a
    // file and typing it would be two different actions and the reader would have to
    // learn which was which.
    expect(namedPaths("src/util.ts and notes.md")).toEqual(["src/util.ts", "notes.md"]);
    expect(namedPaths("@src/util.ts and @notes.md")).toEqual(["src/util.ts", "notes.md"]);
  });

  it("is found written as a way out of the folder, because that is how a path gets copied", () => {
    // Whether it may be read is the server's question, and it is asked about this
    // path exactly as it is asked about one the Model writes.
    expect(namedPaths("compare ../other/notes.md with src/util.ts")).toEqual([
      "../other/notes.md",
      "src/util.ts",
    ]);
  });

  it("is found written as ./src, which says what the reader meant and nothing else", () => {
    expect(namedPaths("read ./src/util.ts")).toEqual(["./src/util.ts"]);
  });

  it("is found inside quotes, because a reader quoting a path is still naming one", () => {
    expect(namedPaths('the answer is in "src/util.ts" apparently')).toEqual(["src/util.ts"]);
  });

  it("is found at either end of a message, where a sentence puts a full stop after it", () => {
    expect(namedPaths("read notes.md.")).toEqual(["notes.md"]);
    expect(namedPaths("notes.md")).toEqual(["notes.md"]);
  });

  it("is found several times over, once each", () => {
    // Named once is the question; named twice is the same question asked again,
    // and asking it twice would put two rows in front of the reader for one file.
    expect(namedPaths("src/util.ts and again src/util.ts")).toEqual(["src/util.ts"]);
  });
});

const NOT_NAMED = "an ordinary sentence";

describe(NOT_NAMED, () => {
  it("with a bare slash in it, which is not a path to anything", () => {
    expect(namedPaths("and/or")).toEqual([]);
    expect(namedPaths("I/O")).toEqual([]);
    expect(namedPaths("yes/no")).toEqual([]);
  });

  it("with a slash on its own, which is a separator and not a path", () => {
    expect(namedPaths("/")).toEqual([]);
    expect(namedPaths("and / or")).toEqual([]);
  });

  it("with two words joined by a slash and nothing else to say it is a path", () => {
    // `src/util` is two short words either side of a slash, which is what "and
    // then" looks like when a sentence is written the way a path is. The reader
    // who meant a folder can say `./src`, or pick it from the Root with `@`.
    expect(namedPaths("check src/util for me")).toEqual([]);
  });

  it("with an abbreviation, because a dot between two letters is not an extension", () => {
    expect(namedPaths("e.g. this one")).toEqual([]);
    expect(namedPaths("i.e. that one")).toEqual([]);
    expect(namedPaths("etc. and so on")).toEqual([]);
  });

  it("with a version number, whose dots join digits rather than names", () => {
    expect(namedPaths("running on 1.2.3 here")).toEqual([]);
  });

  it("with a fraction, which has a slash and digits either side of it", () => {
    expect(namedPaths("about 3/4 of the time")).toEqual([]);
  });

  it("with an address, which has no dot in the local part", () => {
    expect(namedPaths("write to me@example.com about it")).toEqual([]);
  });

  it("with a URL, which is not a file on this machine and would be refused anyway", () => {
    expect(namedPaths("see https://example.com/docs/index.html")).toEqual([]);
    expect(namedPaths("file:///etc/hosts")).toEqual([]);
  });

  it("with home-directory shorthand, which it expands", () => {
    // `~/notes.md` is how a developer writes a path that is not inside the folder
    // they shared, and that is the common case here rather than the rare one. It
    // expands to an ordinary absolute path and then goes through containment like
    // any other, so it asks the reader in exactly the way `/Users/me/notes.md`
    // does. Expanding it grants nothing; refusing it only means the reader has to
    // write out the long form to get the same question.
    expect(namedPaths("look at ~/notes.md")).toEqual([join(homedir(), "notes.md")]);
    expect(namedPaths("and ~/ alone")).toEqual([homedir()]);
  });

  it("with a tilde that is not home shorthand, which is English", () => {
    // The expansion is `~` and `~/` only. Everything else starting with a tilde
    // is prose, and refusing it here is what keeps "~5 files" from being a file.
    expect(namedPaths("~5 files were changed")).toEqual([]);
    expect(namedPaths("~really not a path")).toEqual([]);
  });

  it("with a word, however much it looks like a filename without a dot or a slash", () => {
    expect(namedPaths("what does the composer do")).toEqual([]);
    expect(namedPaths("src and util")).toEqual([]);
  });

  it("with a token too long to be a path, which is a paste rather than a name", () => {
    // A pasted bundle is megabytes of one line. Asking the server about it is a
    // question about the reader's clipboard rather than about a file they meant.
    expect(namedPaths(`src/${"a".repeat(2000)}.ts`)).toEqual([]);
  });

  it("with a token carrying a null byte, which is not a path the disk could hold", () => {
    // The route refuses these too, and refusing here as well keeps the question
    // out of the reader's face for something that could never have been read.
    expect(namedPaths("src/util\u0000.ts")).toEqual([]);
  });
});