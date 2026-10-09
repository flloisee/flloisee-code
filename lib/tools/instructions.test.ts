import { describe, expect, it } from "vitest";

import { READING_INSTRUCTIONS } from "./instructions";

/**
 * What the Model is told once a Root has been declared.
 *
 * Two requirements are pinned here rather than only in the prose above them,
 * because both are sentences that get shortened in a later edit and neither
 * fails anything when it does: a Model that retries a refused read turns one
 * Turn into a loop that costs a round trip per step, and a Model that goes
 * looking for the same file another way is doing exactly what the Root exists
 * to stop.
 */

describe("the instructions naming the Tools", () => {
  it("names all three, so the Model knows what it can reach for", () => {
    expect(READING_INSTRUCTIONS).toContain("list_files");
    expect(READING_INSTRUCTIONS).toContain("read_file");
    expect(READING_INSTRUCTIONS).toContain("search_files");
  });

  it("tells the Model not to call a Tool again for a path that was refused", () => {
    expect(READING_INSTRUCTIONS).toMatch(/never call .{0,40}(again|another time)/i);
  });

  it("tells the Model not to look for a refused file another way", () => {
    // The refusal is a decision about the boundary, not an obstacle to route
    // around: a Model told only not to retry would try `search_files` next.
    expect(READING_INSTRUCTIONS).toMatch(/never (look for|search for) .{0,40}(another way|elsewhere)/i);
  });

  it("says the Tools only read, because that is the claim being relied on", () => {
    expect(READING_INSTRUCTIONS).toMatch(/only read/i);
  });
});
