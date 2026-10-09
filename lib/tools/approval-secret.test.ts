import { describe, expect, it } from "vitest";

import { toolApprovalSecret } from "./approval-secret";

/**
 * The secret approval requests are signed with.
 *
 * The claim worth having is stability within a process: a signature is checked on
 * a later Turn, so a value that changed between the request and the answer would
 * refuse every approval the reader had just been asked — which is the same
 * failure as having no signature at all, reached from the other direction.
 */
describe("the signing secret", () => {
  it("is the same every time within a process, so an answer survives to the Turn after it", () => {
    expect(toolApprovalSecret()).toBe(toolApprovalSecret());
  });

  it("is long enough that guessing one is not a plan", () => {
    // 32 random bytes, hex. Asserted as a length rather than a shape: what has
    // to hold is that nobody can arrive at this value by accident.
    expect(toolApprovalSecret().length).toBeGreaterThanOrEqual(64);
  });
});