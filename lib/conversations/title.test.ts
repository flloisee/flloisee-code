import { describe, expect, it } from "vitest";

import { TITLE_MAX, UNTITLED, titleFrom } from "@/lib/conversations/title";

describe("titleFrom", () => {
  it("keeps a short message whole", () => {
    expect(titleFrom("Why is the build red?")).toBe("Why is the build red?");
  });

  it("keeps a message of exactly the limit whole", () => {
    const exact = "a".repeat(TITLE_MAX);
    expect(titleFrom(exact)).toBe(exact);
  });

  it("cuts a long message at the limit", () => {
    const long = `${"word ".repeat(20)}end`;
    expect(titleFrom(long)).toHaveLength(TITLE_MAX);
  });

  it("never exceeds the limit", () => {
    const long = `${"word ".repeat(50)}end`;
    expect(titleFrom(long).length).toBeLessThanOrEqual(TITLE_MAX);
  });

  it("prefers a word boundary over a mid-word cut", () => {
    const title = titleFrom("How do I configure the deployment pipeline safely");

    expect(title).toBe("How do I configure the…");
    // Ending mid-word would leave "deploy" cut in half.
    expect(title).not.toContain("deploy…");
  });

  it("drops a trailing mark the cut left dangling", () => {
    // The cut lands just after "this", which the reader wrote as a question.
    const title = titleFrom("what exactly is this thing called, and why");

    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/[,.?!]\s*…$/u);
  });

  it("falls back to a hard cut when no boundary leaves enough of the name", () => {
    // One unbroken run has no word boundary at all, so honouring the rule
    // blindly would return almost nothing.
    const title = titleFrom("a".repeat(TITLE_MAX + 10));

    expect(title).toBe("a".repeat(TITLE_MAX) + "…");
  });

  it("collapses newlines and runs of spaces", () => {
    // The reader typed this across lines; the name must count it as one
    // sentence, or the cut lands on a break they never see.
    const title = titleFrom("Why is\n\nthe build    red in CI?");

    expect(title).toBe("Why is the build red in CI?");
  });

  it("trims surrounding whitespace", () => {
    expect(titleFrom("   hello   ")).toBe("hello");
  });

  it("names an empty Conversation rather than nothing", () => {
    // A Conversation can be saved before anything is sent, and an empty name
    // in the list would be an unreadable row.
    expect(titleFrom("")).toBe(UNTITLED);
    expect(titleFrom("   \n  ")).toBe(UNTITLED);
  });

  it("survives emoji without slicing a surrogate pair", () => {
    // Each is two code units but one visible character; cutting between them
    // would put a broken half in the list, which renders as a replacement box.
    const title = titleFrom("🎉🎊🎈".repeat(20));

    expect(title).not.toContain("�");
    // Every emoji arrived whole, so the visible name is emoji plus the ellipsis.
    expect(Array.from(title)).toHaveLength(16);
    expect(Array.from(title).at(-1)).toBe("…");
  });

  it("does not end on a stranded surrogate", () => {
    // The direct statement of the property above: a lone high surrogate is the
    // half a `slice` leaves behind, and it is the thing that renders as a box.
    const title = titleFrom("🎉".repeat(20));

    expect(title).not.toMatch(/[\uD800-\uDBFF]$/u);
    expect(title.endsWith("…")).toBe(true);
  });

  it("does not drop the last character when the cut lands on a whole pair", () => {
    // The limit is even and each of these is two code units, so the cut lands
    // on a complete character. Trimming here would silently delete one the
    // reader typed — a broken glyph pointing the other way, and the reason the
    // stranded half is identified as a *high* surrogate rather than any half.
    const title = titleFrom("🎉".repeat(20));

    expect(title).toBe("🎉".repeat(15) + "…");
  });

  it("counts astral CJK characters as one character each", () => {
    // These are single characters written as surrogate pairs, so a naive cut
    // would halve one mid-list.
    const title = titleFrom("𠮷".repeat(40));

    expect(title).not.toContain("�");
    expect(title).toBe("𠮷".repeat(15) + "…");
  });
});
