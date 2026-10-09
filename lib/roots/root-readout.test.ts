import { describe, expect, it } from "vitest";

import { rootReadout, MAX_ROOT_CHARS, ROOT_CHANGED_KEY } from "./root-readout";
import type { RootPath } from "./file-finder";

/**
 * Which folder is the Root, as the composer says it.
 *
 * The words are asserted through `rootReadout` rather than through the cut it
 * calls, because the cut is a detail of the readout and a reader is looking at the
 * readout: a path that keeps its own name at both ends and a path that is cut in a
 * way that keeps nothing are both failures, and only the first is obvious from the
 * words drawn.
 */

const DECLARED: RootPath = { status: "declared", root: "/Users/someone/Dev/Projects/hackathon-ai" };

describe("the folder the composer names", () => {
  it("is the whole path, while it fits", () => {
    const short: RootPath = { status: "declared", root: "/Users/someone/Dev" };

    expect(rootReadout(short)?.text).toBe("/Users/someone/Dev");
  });

  it("keeps the name of the folder at each end of a path too long to draw", () => {
    const long =
      "/Volumes/External/Dev Projects/Github/Repos/flloisee-code/components/chat/reading-root";

    const readout = rootReadout({ status: "declared", root: long });

    // The cut is in the middle because that is where a path is least about
    // anything: the head says where on the machine this is, and the tail ends in
    // the name of the folder the reader chose, while the run of parent folders
    // between them is the part nobody has ever had to think about. Both ends are
    // load-bearing — a cut that kept only the head would leave the reader with
    // `/Volumes/External/...`, which is half the answer to no question.
    expect(readout?.text.startsWith("/Volumes/External/")).toBe(true);
    expect(readout?.text.endsWith("reading-root")).toBe(true);
    expect(readout?.text).toContain("...");
  });

  it("draws no longer than it says it will", () => {
    const long = "/Volumes/External/Dev Projects/Github/Repos/".repeat(4);

    // The ceiling is the whole reason the composer does not shove Send along the
    // row, so it is asserted rather than assumed: a cut that runs over is a cut
    // that has stopped being one.
    expect(rootReadout({ status: "declared", root: long })?.text.length).toBe(MAX_ROOT_CHARS);
  });

  it("carries the whole path to a hover, because a cut path is not the path", () => {
    // The cut is only acceptable while nothing is lost, and the reader is the one
    // who decides whether a cut was lossy — which they cannot do from the words on
    // screen alone.
    expect(rootReadout(DECLARED)?.title).toBe(DECLARED.status === "declared" ? DECLARED.root : "");
  });

  it("says nothing has been chosen, rather than drawing nothing at all", () => {
    // Silence is the answer for a route that has not been asked and for a route
    // that refused; a reader who has declared no Root is a reader who has a
    // decision to make, and the composer is where they are looking.
    expect(rootReadout({ status: "no-root", malformed: false })?.text).toBe("No folder chosen");
  });

  it("does not claim no folder was chosen when the file recording one cannot be read", () => {
    // Those are opposite facts: one is a decision not made, the other a file to
    // repair. Saying "No folder chosen" of a Root that exists and is unreadable
    // would send the reader to Settings for a decision they have already made.
    const readout = rootReadout({ status: "no-root", malformed: true });

    expect(readout?.text).not.toBe("No folder chosen");
    expect(readout?.text).toContain("cannot be read");
    expect(readout?.title).toContain("Settings");
  });

  it("draws nothing at all until the route has answered, and nothing when it refuses", () => {
    // Both would otherwise be a line that appears and disappears, or a reported
    // failure in a place nobody reads: the `@` menu says what is wrong at the
    // moment the reader is asking about files.
    expect(rootReadout(null)).toBeNull();
    expect(rootReadout({ status: "refused", message: "Could not reach the app's file route." })).toBeNull();
  });

  it("is drawn as a machine string only when it is one", () => {
    // The mono register is for values read character by character. A path is one;
    // a sentence about there not being a path is prose, and mono-ing it would say
    // it was a value the app had measured.
    expect(rootReadout(DECLARED)?.machine).toBe(true);
    expect(rootReadout({ status: "no-root", malformed: false })?.machine).toBe(false);
  });
});

describe("the slot announcing the Root has changed", () => {
  it("is a name of its own, not one of the Registry's or the preferences'", () => {
    // A change to the Registry must not ask the composer to re-read a Root that has
    // not moved, and a Theme change must not either: the listener keys off this
    // one string, so reusing another would have it answer to the wrong thing.
    expect(ROOT_CHANGED_KEY).toBe("multi-endpoint-chat.reading-root");
  });
});