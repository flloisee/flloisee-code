import { describe, expect, it } from "vitest";

import { compileGlob, gitignoreRules } from "./glob";

/**
 * The pattern language two features share: a `.gitignore` file's lines, and the
 * `glob` a Model passes to `search_files`.
 *
 * It is one language on purpose. A developer who has written a `.gitignore` knows
 * it, so `*.ts` and `src/**` mean what they expect in both places, and there is
 * one implementation rather than two that drift — the second one being the one
 * that quietly answers a different question from the first.
 *
 * These are tests over the matcher's own interface rather than over a folder,
 * because the rules are the rules and a folder would only show a few of them.
 */

/** Whether one path is matched by one pattern, as `.gitignore` would read them. */
function matches(pattern: string, relativePath: string): boolean {
  return compileGlob(pattern).matches(relativePath);
}

describe("a pattern with no separator in it", () => {
  it("matches a file of that name at any depth, because that is what git does", () => {
    expect(matches("build", "build")).toBe(true);
    expect(matches("build", "packages/app/build")).toBe(true);
    expect(matches("build", "src/build.ts")).toBe(false);
  });

  it("treats a star as stopping at a separator", () => {
    expect(matches("*.log", "debug.log")).toBe(true);
    expect(matches("*.log", "logs/debug.log")).toBe(true);
    expect(matches("*.log", "logs/debug.txt")).toBe(false);
    // The trap that a whole-path regex gets wrong: `*` does not cross a
    // separator, so `logs/*.log` is not `logs/a/b.log`.
    expect(matches("logs/*", "logs/nested/debug.log")).toBe(false);
  });

  it("treats a question mark as one character and not a separator", () => {
    expect(matches("v?.txt", "v1.txt")).toBe(true);
    expect(matches("v?.txt", "v12.txt")).toBe(false);
  });
});

describe("a pattern with a separator in it", () => {
  it("is measured from the folder the pattern was written in, and not from anywhere above it", () => {
    expect(matches("src/build", "src/build")).toBe(true);
    expect(matches("src/build", "packages/app/src/build")).toBe(false);
  });

  it("can be anchored to the top explicitly, which is the same rule said out loud", () => {
    expect(matches("/build", "build")).toBe(true);
    expect(matches("/build", "packages/app/build")).toBe(false);
  });

  it("spans folders with a double star", () => {
    expect(matches("src/**/*.test.ts", "src/a.test.ts")).toBe(true);
    expect(matches("src/**/*.test.ts", "src/a/b/c.test.ts")).toBe(true);
    expect(matches("src/**/*.test.ts", "src/a/b/c.ts")).toBe(false);
  });

  it("matches everything inside a folder when the double star ends the pattern", () => {
    expect(matches("dist/**", "dist/a.js")).toBe(true);
    expect(matches("dist/**", "dist/nested/deep/a.js")).toBe(true);
    expect(matches("dist/**", "dist")).toBe(false);
  });
});

describe("a pattern with a trailing separator", () => {
  it("matches a folder and everything under it, and not a file of that name", () => {
    expect(matches("logs/", "logs")).toBe(true);
    expect(matches("logs/", "logs/today.txt")).toBe(true);
    expect(matches("logs/", "logs.txt")).toBe(false);
  });
});

describe("a .gitignore file", () => {
  it("is read as one set of rules, where a later line wins over an earlier one", () => {
    // Negation is the whole reason a rule list is ordered rather than a set: a
    // `!` line re-includes what an earlier line excluded, and only because it
    // comes later.
    const rules = gitignoreRules(["build/", "!build/keep.txt", "# a comment", "", "*.log"]);

    expect(rules.ignores("build")).toBe(true);
    expect(rules.ignores("build/keep.txt")).toBe(false);
    expect(rules.ignores("debug.log")).toBe(true);
    expect(rules.ignores("debug.txt")).toBe(false);
  });

  it("leaves a line that is only a comment or only space out of the rules entirely", () => {
    const rules = gitignoreRules(["# build/", "   ", "\\#real"]);

    // The comment must not become a rule that ignores every folder called
    // `#build`, and an escaped hash is how a file with a hash in its name is
    // written at all.
    expect(rules.ignores("build")).toBe(false);
    expect(rules.ignores("#real")).toBe(true);
  });
});
