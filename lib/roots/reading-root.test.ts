import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TempFileWriter } from "@/lib/atomic-write";
import { temporaryProject, type TemporaryProject } from "@/lib/testing/temporary-project";

import { declareRoot, forgetRoot, readReadingRoot } from "./reading-root";

/**
 * The Reading Root file, tested where it meets the disk.
 *
 * This file is what the app's own containment is stood on: once a Root is
 * written here, the chat route will read whatever sits inside it and hand it to
 * a Model. So what matters is not that the write works but what a reader of the
 * file can be made to believe — a half-written Root, or a Root read out of a
 * file that does not say what it looks like it says, is the widest thing this
 * feature has.
 */

const project: TemporaryProject = await temporaryProject("writing-root-");
// `dir` is deliberately not destructured: it is a getter, and a copy taken
// before the first `begin()` would be the empty string rather than a directory.
const { begin, end, rootFile } = project;

beforeEach(async () => {
  await begin();

  // A folder for the Root to point at, so declaring one is not the act of
  // pointing at the directory the file happens to live in.
  await mkdir(path.join(project.dir, "my-project"));
});

afterEach(end);

describe("declaring a Root", () => {
  it("is still there tomorrow, read back out of a file of the app's own", async () => {
    await declareRoot({ dir: project.dir, root: path.join(project.dir, "my-project") });

    // Nothing is held in memory: a new call, with no state carried into it,
    // stands in for the next server process.
    expect(await readReadingRoot(project.dir)).toMatchObject({
      root: path.join(project.dir, "my-project"),
      malformed: false,
    });
  });

  it("writes it beside the environment file, rather than somewhere of its own", async () => {
    await declareRoot({ dir: project.dir, root: path.join(project.dir, "my-project") });

    expect(path.dirname(rootFile())).toBe(project.dir);
    expect(await readdir(project.dir)).toContain(".reading-root.json");
  });

  it("keeps an absolute path, so the Root is the same folder whoever reads it", async () => {
    await declareRoot({ dir: project.dir, root: path.join(project.dir, "my-project") });

    expect(JSON.parse(await readFile(rootFile(), "utf8")).root).toBe(path.join(project.dir, "my-project"));
  });
});

describe("a machine that has never been told about a Root", () => {
  it("reads as no Root at all, rather than as a failure", async () => {
    // The whole v1 behaviour depends on this: no file is not an error, and a
    // Turn with no Root carries no Tools and asks for nothing.
    expect(await readReadingRoot(project.dir)).toEqual({ root: null, grants: [], malformed: false });
  });
});

describe("a file that is not what it looks like", () => {
  it("is reported as malformed and read as no Root, rather than parsed leniently", async () => {
    // Each of these would widen what the app reads if it were taken at face
    // value: a Root that is not a path at all, one that is relative (which would
    // resolve against whichever directory the server happened to be in), and one
    // that is a list of two Roots, where picking the first would be a guess.
    const unreadable = [
      "not json at all",
      JSON.stringify({ root: 42 }),
      JSON.stringify({ root: "relative/path" }),
      JSON.stringify({ root: ["/Users/fll/project", "/Users/fll"] }),
      JSON.stringify({}),
    ];

    for (const contents of unreadable) {
      await writeFile(rootFile(), contents, "utf8");

      expect([contents, await readReadingRoot(project.dir)]).toEqual([
        contents,
        { root: null, grants: [], malformed: true },
      ]);
    }
  });

  it("never yields a Root even when a path is buried in it under a key of its own", async () => {
    // The lenient reading is the dangerous one: taking `root` when it is a
    // string and ignoring it when it is not means the file's meaning depends on
    // its shape. Refusing the whole file is the only reading that cannot.
    await writeFile(rootFile(), JSON.stringify({ root: null, grants: ["/Users/fll"] }), "utf8");

    expect(await readReadingRoot(project.dir)).toMatchObject({ root: null, malformed: true });
  });
});

describe("forgetting a Root", () => {
  it("leaves the machine reading nothing, as though one had never been declared", async () => {
    await declareRoot({ dir: project.dir, root: path.join(project.dir, "my-project") });

    await forgetRoot({ dir: project.dir });

    expect(await readReadingRoot(project.dir)).toEqual({ root: null, grants: [], malformed: false });
  });

  it("is not a failure when there was nothing to forget", async () => {
    // Declaring and forgetting are both a reader tidying up after themselves, and
    // the second one happens after a restart on a machine whose file was
    // deleted by hand, a backup, or a `git clean`. Refusing would leave the
    // reader unable to clear a state they can see.
    await expect(forgetRoot({ dir: project.dir })).resolves.toBeUndefined();
    expect(await readReadingRoot(project.dir)).toEqual({ root: null, grants: [], malformed: false });
  });
});

describe("the file holding a Root", () => {
  it("is excluded from version control, as is the temporary file it writes first", () => {
    // Asked of git rather than of the .gitignore text, so the question is
    // answered by the same thing that would decide it. It holds this machine's
    // directory layout, which is the reader's to publish or not.
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

    for (const name of [".reading-root.json", ".reading-root-12345.tmp"]) {
      const check = spawnSync("git", ["check-ignore", "-q", name], { cwd: repoRoot });

      expect([name, check.status]).toEqual([name, 0]);
    }
  });
});

describe("a write interrupted part way through", () => {
  it("leaves the previous Root readable, rather than half of one", async () => {
    const first = path.join(project.dir, "my-project");
    await declareRoot({ dir: project.dir, root: first });

    // The process dies after writing part of the temporary file: the case the
    // temporary-file-and-rename dance exists for. A Root file caught halfway
    // would still be valid JSON — which is exactly why it has to be caught
    // before the rename, not repaired afterwards.
    const interrupted: TempFileWriter = async (tempPath) => {
      await writeFile(tempPath, '{"root": "/Users/fll/proj', "utf8");
      throw new Error("interrupted");
    };

    await expect(
      declareRoot({ dir: project.dir, root: path.join(project.dir, "another-project"), writeTempFile: interrupted }),
    ).rejects.toThrow("interrupted");

    expect(await readReadingRoot(project.dir)).toMatchObject({ root: first, malformed: false });
    // Nothing left behind that could be committed, or read back as a Root.
    expect(await readdir(project.dir)).toEqual([".reading-root.json", "my-project"]);
  });
});