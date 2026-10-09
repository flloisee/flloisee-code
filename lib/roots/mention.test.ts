import { describe, expect, it } from "vitest";

import { mentionAt, mentionRuns } from "@/lib/roots/mention";

/**
 * Which words of a message carry a reader's own `@`.
 *
 * One module for two questions — where the mention being typed is, and where
 * every mention in the message is — because the menu and the drawn copy are two
 * claims about the same characters and a reader holding both at once has no way
 * to tell which of them to believe. So these are pinned together rather than
 * apart: the last block is the whole of what makes that true.
 */

const CARET = "the `@` the caret is inside";

describe(CARET, () => {
  it("is the one the reader is typing, carrying the words written after it", () => {
    expect(mentionAt("look at @ut", 11)).toEqual({ start: 8, query: "ut" });
  });

  it("is found mid-message, because a reader may go back and change a name", () => {
    expect(mentionAt("@src and @ut", 12)).toEqual({ start: 9, query: "ut" });
  });

  it("is a bare `@` with nothing written yet, which is what opens the menu", () => {
    expect(mentionAt("look at @", 9)).toEqual({ start: 8, query: "" });
  });

  it("is nothing once the mention has ended, because a name ends at the first space", () => {
    // The rule that makes the words after a name the reader's own sentence rather
    // than a longer query: a menu that followed the caret out of the mention would
    // be answering a different question from the one being asked.
    expect(mentionAt("@src/util.ts and then what?", 30)).toBeNull();
  });

  it("is nothing in the middle of an address, because that is somebody's email", () => {
    expect(mentionAt("write to me@example.com", 24)).toBeNull();
  });

  it("is nothing before the caret when the `@` is further up the sentence", () => {
    // The menu is a question about where the reader *is*. An `@` they have already
    // typed past is not what they are typing into.
    expect(mentionAt("@src/util.ts", 3)).toEqual({ start: 0, query: "sr" });
    expect(mentionAt("@src/util.ts", 0)).toBeNull();
  });
});

const DRAWN = "every mention in the message";

describe(DRAWN, () => {
  it("is the whole name, `@` and all, wherever it sits in the sentence", () => {
    expect(mentionRuns("what does @src/util.ts do?")).toEqual([{ start: 10, end: 22 }]);
    expect(mentionRuns("@src/util.ts")).toEqual([{ start: 0, end: 12 }]);
  });

  it("is every one of them, in the order they were written", () => {
    expect(mentionRuns("@src/util.ts and @src/index.ts")).toEqual([
      { start: 0, end: 12 },
      { start: 17, end: 30 },
    ]);
  });

  it("is nothing for an address, which is somebody's email rather than a name", () => {
    // The menu's rule, asked again rather than restated: a copy that drew an
    // address as a name would be a second answer to the same question.
    expect(mentionRuns("write to me@example.com about it")).toEqual([]);
  });

  it("is the `@` of a scoped package, which is a word starting with one", () => {
    // The other side of the same rule, and the reason the rule is about where the
    // `@` sits rather than about what surrounds it: `node_modules/@scope/pkg` is
    // a real path, and only a `@` in the middle of a word is somebody's address.
    expect(mentionRuns("@scope/pkg")).toEqual([{ start: 0, end: 10 }]);
  });

  it("is nothing for two `@`s in one word, because neither of them starts it", () => {
    expect(mentionRuns("@a@b")).toEqual([]);
  });

  it("is nothing for a bare `@`, which is a character rather than a name yet", () => {
    // The menu is already open over the word it is sitting in; there is nothing
    // behind the character to be heavy about.
    expect(mentionRuns("@")).toEqual([]);
    expect(mentionRuns("@ ")).toEqual([]);
    expect(mentionRuns("look at @")).toEqual([]);
  });

  it("is nothing in a message that names nothing", () => {
    expect(mentionRuns("")).toEqual([]);
    expect(mentionRuns("what does src/util.ts do?")).toEqual([]);
  });
});