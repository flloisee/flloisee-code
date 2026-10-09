import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readingApproval } from "@/lib/tools/approval";
import type { ReadingRoot } from "@/lib/roots/reading-root";

/**
 * The approval policy, asked directly rather than through a Model.
 *
 * The Model layer is the SDK's, and a stub that called our policy would only
 * prove the stub was called. This is the part that is ours: whether a path the
 * Model asked for is read without asking, read because a Grant covers it, or
 * stops and asks the reader.
 */

/**
 * The options the SDK hands the policy. None of them decide anything — the
 * policy is given the parsed input and answers from that — so they are stood up
 * once here rather than restated per test. `toolsContext` is `{}` rather than
 * absent because no Tool declares a `contextSchema`, which is what the SDK
 * infers from the Tools this app has.
 */
const GIVEN = { tools: undefined, toolsContext: {}, runtimeContext: {}, messages: [] };

/** What one call to the policy comes back with, once its promise settles. */
type Decision = Awaited<ReturnType<ReturnType<typeof readingApproval>>>;

function decide(reading: ReadingRoot, toolName: string, input: unknown): Promise<Decision> {
  return Promise.resolve(readingApproval(reading)({ ...GIVEN, toolCall: { toolName, input } as never }));
}

let project = "";
let root = "";

beforeEach(async () => {
  await rm(project, { recursive: true, force: true });
  project = await realpath(await mkdtemp(path.join(tmpdir(), "approval-")));
  root = path.join(project, "project");
  await mkdir(root);
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

/** The Root, with whatever Grants are named beside it. */
function reading(...grants: string[]): ReadingRoot {
  return { root, grants, malformed: false };
}

/**
 * A file that is really there.
 *
 * Containment resolves the way the disk resolves, so a path that does not exist
 * is refused as unreadable before it is ever compared to a boundary. Every case
 * below is about a path the reader could have meant, which means it has to be a
 * path that exists.
 */
async function write(relative: string, contents = "hello\n"): Promise<string> {
  const written = path.join(project, relative);
  await mkdir(path.dirname(written), { recursive: true });
  await writeFile(written, contents, "utf8");
  return written;
}

describe("a path inside the Reading Root", () => {
  it("is read without asking the reader anything", async () => {
    await write("project/src/index.ts");

    await expect(decide(reading(), "read_file", { path: "src/index.ts" })).resolves.toBeUndefined();
  });

  it("is asked about the same way whichever of the three Tools named it", async () => {
    await write("project/src/index.ts");

    await expect(decide(reading(), "list_files", { path: "src" })).resolves.toBeUndefined();
    await expect(decide(reading(), "search_files", { query: "index", path: "src" })).resolves
      .toBeUndefined();
  });

  it("is asked about the Root itself when the Model named no path at all", async () => {
    // `path` is optional on two of the three, so "the whole project" is what a
    // call with no path means. It has to answer the same as "." does.
    await expect(decide(reading(), "list_files", {})).resolves.toBeUndefined();
  });
});

describe("a path outside the Reading Root", () => {
  it("stops and asks the reader, naming the path they are being asked about", async () => {
    const asked = await write("elsewhere/notes.md");

    const decision = await decide(reading(), "read_file", { path: "../elsewhere/notes.md" });

    expect(decision).toMatchObject({ type: "user-approval" });
    // The reader is being asked to allow a specific file on this machine, and
    // a relative version of it would not tell them which.
    expect(reasonOf(decision)).toContain(asked);
  });

  it("is asked about the same way however the Model spelled it", async () => {
    await write("elsewhere/notes.md");

    const climbing = await decide(reading(), "read_file", { path: "../elsewhere/notes.md" });
    const absolute = await decide(reading(), "read_file", {
      path: path.join(project, "elsewhere/notes.md"),
    });

    expect(climbing).toMatchObject({ type: "user-approval" });
    expect(absolute).toMatchObject({ type: "user-approval" });
  });

  it("asks even when the Grants would not have covered it anyway", async () => {
    await write("notes.md");

    const decision = await decide(reading(path.join(project, "elsewhere")), "read_file", {
      path: "../notes.md",
    });

    // A Grant is an addition to the Root, never a substitute for it, so a
    // refusal must be asked about rather than quietly assumed.
    expect(decision).toMatchObject({ type: "user-approval" });
  });
});

describe("a path a Grant covers", () => {
  it("is read without asking, but is marked as a decision that was already made", async () => {
    const granted = await write("elsewhere/notes.md");

    const decision = await decide(reading(path.join(project, "elsewhere")), "read_file", {
      path: "../elsewhere/notes.md",
    });

    // Automatic rather than silent: the read happens, and the transcript says
    // it was allowed rather than arriving like a read inside the Root.
    expect(decision).toMatchObject({ type: "approved" });
    expect(reasonOf(decision)).toContain(granted);
  });
});

describe("a path that is not there", () => {
  it("is a typo rather than a question for the reader", async () => {
    // Containment answers a path the disk cannot resolve as "unreadable" rather
    // than as "outside", and those are not the same question. Asking the reader
    // to approve reading a file that does not exist would stop the whole Turn
    // over a misspelling — and the Tools already refuse it with a sentence
    // telling the Model to call `list_files` instead.
    await expect(decide(reading(), "read_file", { path: "src/not-here.md" })).resolves.toBeUndefined();
  });

  it("is a path that could never be read at all, and is not asked about either", async () => {
    await expect(decide(reading(), "read_file", { path: "src/\u0000" })).resolves.toBeUndefined();
  });
});

describe("a Grant the reader has taken back", () => {
  it("asks about the path again, because the decision is no longer on file", async () => {
    await write("elsewhere/notes.md");

    const asked = "../elsewhere/notes.md";

    // The whole point of listing a Grant with a control to remove it: the removal
    // takes effect on the next Turn, and nothing about this Turn is rewritten to
    // make that look tidy.
    const granted = await decide(reading(path.join(project, "elsewhere")), "read_file", {
      path: asked,
    });
    const takenBack = await decide(reading(), "read_file", { path: asked });

    expect(granted).toMatchObject({ type: "approved" });
    expect(takenBack).toMatchObject({ type: "user-approval" });
  });
});

describe("the policy", () => {
  it("answers the same way every time it is asked about one path", async () => {
    await write("elsewhere/notes.md");

    // The SDK re-runs the policy on every replay of a history. A policy that
    // asked twice for one path would ask the reader again for a decision they
    // had already made, which is the failure this exists to prevent.
    const first = await decide(reading(), "read_file", { path: "../elsewhere/notes.md" });
    const again = await decide(reading(), "read_file", { path: "../elsewhere/notes.md" });

    expect(again).toEqual(first);
  });

  it("leaves a Tool Call this app has no Tool for alone", async () => {
    // A Tool Call the SDK could not resolve to one of ours has no path to judge,
    // and asking about it would raise a question with nothing behind it.
    const decided = readingApproval(reading())({
      ...GIVEN,
      toolCall: { toolName: "run_command", input: {}, dynamic: true } as never,
    });

    await expect(Promise.resolve(decided)).resolves.toBe("not-applicable");
  });
});

/** The sentence that reaches the reader, whichever field of the answer carries it. */
function reasonOf(decision: Decision): string {
  return typeof decision === "string" ? decision : (decision?.reason ?? "");
}
