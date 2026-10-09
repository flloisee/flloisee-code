import { afterEach, describe, expect, it } from "vitest";

import { clearDecisions, decide, takeDecisions } from "./named-decision";

/**
 * What the reader decided about a path they named, held by the server.
 *
 * The composer puts a question in front of the reader and the answer has to reach
 * the server, because at send the server decides what may be read, and a browser's
 * word about that would be no word at all. This is where the answer waits between
 * those two moments.
 *
 * It waits **in this process and nowhere else**, which is the whole of why the
 * composer's answers are refused outside development. A record on disk would be a
 * standing grant; a record in the browser would be a grant something in the
 * browser could mint for itself. In memory, only `/api/roots` — the route already
 * bounded by refusing to run outside development — can put one here, and one send
 * takes it.
 */

afterEach(() => {
  clearDecisions();
});

const OUTSIDE = "/Users/somebody/notes/todo.md";

describe("a decision the reader made in the composer", () => {
  it("reaches the send that follows it", () => {
    decide(OUTSIDE, "allowed");

    expect(takeDecisions().get(OUTSIDE)).toBe("allowed");
  });

  it("reaches it once, because a reader who allowed one send did not allow the next", () => {
    decide(OUTSIDE, "allowed");

    takeDecisions();

    // The second message is a new Turn with a new path in it, and it was never
    // asked about. This is what separates "allow once" from "always allow", and it
    // is why they are two answers rather than one button with a switch.
    expect(takeDecisions().size).toBe(0);
  });

  it("is replaced rather than added to, when the reader changes their mind", () => {
    decide(OUTSIDE, "allowed");
    decide(OUTSIDE, "denied");

    expect(takeDecisions().get(OUTSIDE)).toBe("denied");
  });

  it("is kept for one path at a time, so several files can be named in one message", () => {
    decide(OUTSIDE, "allowed");
    decide("/Users/somebody/notes/other.md", "denied");

    const decisions = takeDecisions();

    expect([...decisions.entries()].sort()).toEqual(
      [
        [OUTSIDE, "allowed"],
        ["/Users/somebody/notes/other.md", "denied"],
      ].sort(),
    );
  });

  it("says nothing about a path nobody decided about", () => {
    decide(OUTSIDE, "allowed");

    expect(takeDecisions().has("/Users/somebody/notes/never-asked-about.md")).toBe(false);
  });

  it("is keyed by the path as it was written, because that is what the reader was shown", () => {
    decide(OUTSIDE, "allowed");

    // The same file spelled another way is a different question, and the ask this
    // answers was asked about these words. Keying on anything the server worked
    // out for itself would let the answer to one question serve another.
    expect(takeDecisions().has(`${OUTSIDE}.`)).toBe(false);
  });
});