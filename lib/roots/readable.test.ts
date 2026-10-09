import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { mayRead, resolveAgainstRoot, type Readable } from "./readable";
import { readReadingRoot, type ReadingRoot } from "./reading-root";

/**
 * What the Model is allowed to read, decided once.
 *
 * Everything in this feature that touches the disk on the Model's behalf — the
 * three Tools, the `@` menu, the pasted-path check — asks this file the same
 * question, and this file asks it the same way: the path is resolved the way
 * the disk resolves it, and it is admitted only if what came out is the Root or
 * sits under it, or under a Grant.
 *
 * Both halves of that are the point. Resolution happens before the comparison,
 * so a link inside the Root that points at `~/.ssh` is refused rather than
 * followed — and a link that points at a folder a Grant covers is admitted by
 * the Grant, and reported as the Grant's, because the resolved path is what
 * decides. And a Grant is an addition to the boundary rather than a substitute
 * for it: under the Root **or** under a Grant, and by nothing else.
 */

/**
 * `mkdtemp` under the system temporary directory, which on macOS is reached
 * through a symlink (`/var` -> `/private/var`) — the everyday case where the
 * boundary a reader names and the one the disk has are different strings.
 */
let project = "";
let root = "";
let granted = "";
const originalCwd = process.cwd();

/** A null byte, as a character code: this file stays readable text. */
const NUL = String.fromCharCode(0);

beforeAll(async () => {
  project = await realpath(await mkdtemp(path.join(tmpdir(), "readable-")));
});

afterAll(async () => {
  process.chdir(originalCwd);
  await rm(project, { recursive: true, force: true });
});

/**
 * A fresh Root and Grant for each test.
 *
 * Fresh each time, because "outside the Root" has to be a folder these tests made
 * rather than the last test's leftovers. The working directory is moved to the
 * temporary project — which is the Root's *parent*, so not the Root — because a
 * relative path resolved against it rather than against the Root would land
 * somewhere else entirely, and a test that could tell the two apart is the test
 * that pins which one this uses.
 */
async function resetFixtures(): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await rm(granted, { recursive: true, force: true });

  root = path.join(project, "project");
  granted = path.join(project, "documents");

  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(granted, { recursive: true });
  await mkdir(path.join(project, "project-other"), { recursive: true });
  await mkdir(path.join(project, "secrets"), { recursive: true });
  await mkdir(path.join(project, "documents-other"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "the Root", "utf8");
  await writeFile(path.join(root, "src", "index.ts"), "the entry point", "utf8");
  await writeFile(path.join(granted, "notes.md"), "a Grant", "utf8");
  await writeFile(path.join(project, "project-other", "secrets.txt"), "not ours", "utf8");
  await writeFile(path.join(project, "documents-other", "secrets.txt"), "not ours", "utf8");
  await writeFile(path.join(project, "secrets", "id_rsa"), "PRIVATE KEY", "utf8");

  process.chdir(project);
}

afterEach(async () => {
  process.chdir(originalCwd);
});

/** A Root with the given Grants, which is what the file hands over. */
function aReadingRoot(...grants: string[]): ReadingRoot {
  return { root, grants, malformed: false };
}

/** Throws rather than returning a refusal, so a test that expected a read does not go on. */
function readOrFail(answer: Readable): string {
  if (!answer.readable) throw new Error(`expected a read, was refused: ${answer.reason}`);
  return answer.path;
}

describe("a path the Root covers", () => {
  it("is read, as the path the disk actually has rather than the one asked about", async () => {
    await resetFixtures();
    const readme = path.join(root, "README.md");
    await symlink(readme, path.join(root, "link-to-readme"));

    expect(await mayRead(aReadingRoot(), path.join(root, "link-to-readme"))).toEqual({
      readable: true,
      path: readme,
      under: "root",
    });
  });

  it("is read when it is the Root itself, so a folder can be listed as well as a file in it", async () => {
    await resetFixtures();

    expect(await mayRead(aReadingRoot(), root)).toEqual({
      readable: true,
      path: root,
      under: "root",
    });
  });

  it("is read when it is a folder inside the Root, several levels down", async () => {
    await resetFixtures();

    expect(readOrFail(await mayRead(aReadingRoot(), path.join(root, "src")))).toBe(
      path.join(root, "src"),
    );
  });

  it("is read when the Model named it relatively, as though from the Root", async () => {
    await resetFixtures();

    // A Model writing `src/index.ts` means a file in the folder the reader chose.
    expect(readOrFail(await mayRead(aReadingRoot(), "src/index.ts"))).toBe(
      path.join(root, "src", "index.ts"),
    );
  });

  it("refuses a relative path that climbs out of the Root, however it is spelled", async () => {
    await resetFixtures();

    expect(await mayRead(aReadingRoot(), "../secrets/id_rsa")).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("resolves `..` the way the disk resolves it rather than the way the string reads", async () => {
    await resetFixtures();
    // A link inside the Root pointing at a folder beside it, and a `src` beside
    // the Root. Read as a string, `link/../src` steps out through the link and
    // steps back in to the Root. Read as paths, it steps out through the link,
    // goes up from there and arrives at the `src` beside the Root — which is
    // there, and is not ours. Collapsing the `..` in the string would have
    // substituted the Root's own `src` for it.
    await symlink(path.join(project, "secrets"), path.join(root, "link"));
    await mkdir(path.join(project, "src"));

    expect(await mayRead(aReadingRoot(), "link/../src")).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("refuses an absolute path elsewhere on the machine", async () => {
    await resetFixtures();

    expect(await mayRead(aReadingRoot(), path.join(project, "secrets", "id_rsa"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("refuses a sibling whose name merely begins the Root's", async () => {
    // What a string prefix gets wrong: `/…/project-other` begins with
    // `/…/project` and is not inside it.
    await resetFixtures();

    expect(await mayRead(aReadingRoot(), path.join(project, "project-other", "secrets.txt"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("refuses a link out of the Root, because the link is resolved before the boundary is checked", async () => {
    await resetFixtures();
    await symlink(path.join(project, "secrets"), path.join(root, "escape-hatch"));

    expect(await mayRead(aReadingRoot(), path.join(root, "escape-hatch", "id_rsa"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("refuses a chain of links that leaves the Root", async () => {
    await resetFixtures();
    await symlink(path.join(project, "project-other"), path.join(project, "second-hop"));
    await symlink(path.join(project, "second-hop"), path.join(root, "first-hop"));

    expect(await mayRead(aReadingRoot(), path.join(root, "first-hop", "secrets.txt"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("refuses a name carrying a null byte rather than letting it reach the disk", async () => {
    await resetFixtures();

    expect(await mayRead(aReadingRoot(), `${root}${NUL}/../secrets`)).toEqual({
      readable: false,
      reason: "unusable",
    });
  });

  it("refuses a path that is not there, and says so rather than calling it outside", async () => {
    await resetFixtures();

    // The refusals ask the reader different things: one is a typo, another is a
    // path that could never be read, and the last is a decision about where
    // this app may read.
    expect(await mayRead(aReadingRoot(), path.join(root, "never-written.md"))).toEqual({
      readable: false,
      reason: "unreadable",
    });
    expect(await mayRead(aReadingRoot(), path.join(root, "README.md", "notes.md"))).toEqual({
      readable: false,
      reason: "unusable",
    });
    expect(await mayRead(aReadingRoot(), path.join(project, "secrets", "id_rsa"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("reads nothing named with a leading tilde, because that is a name and not a path", async () => {
    await resetFixtures();

    // Expanding `~` would hand the Model a way to name the reader's home folder
    // whatever this app was told it may read. It is refused as the typo it is.
    expect(await mayRead(aReadingRoot(), "~/secrets/id_rsa")).toEqual({
      readable: false,
      reason: "unreadable",
    });
  });
});

describe("a path a Grant covers", () => {
  it("is read, and says which boundary answered, so a Grant is visible rather than silent", async () => {
    await resetFixtures();

    expect(await mayRead(aReadingRoot(granted), path.join(granted, "notes.md"))).toEqual({
      readable: true,
      path: path.join(granted, "notes.md"),
      under: "grant",
    });
  });

  it("is read when the Grant itself is named", async () => {
    await resetFixtures();

    expect(await mayRead(aReadingRoot(granted), granted)).toMatchObject({ under: "grant" });
  });

  it("refuses a sibling of a Grant rather than under it", async () => {
    await resetFixtures();

    expect(
      await mayRead(aReadingRoot(granted), path.join(project, "documents-other", "secrets.txt")),
    ).toEqual({ readable: false, reason: "outside" });
  });

  it("refuses a path above a Grant that reached it by climbing out", async () => {
    await resetFixtures();

    // A Grant is an addition to the boundary and not a way around it: leaving it
    // puts the path back where a path with no Grant at all would be.
    expect(await mayRead(aReadingRoot(granted), `${granted}/../secrets/id_rsa`)).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("refuses a path that is under neither the Root nor the one Grant, rather than admitting through it", async () => {
    await resetFixtures();
    const elsewhere = path.join(project, "secrets", "id_rsa");

    expect(await mayRead(aReadingRoot(granted), elsewhere)).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("still reads the Root when a Grant is present, rather than the Grant replacing it", async () => {
    await resetFixtures();

    expect(await mayRead(aReadingRoot(granted), path.join(root, "README.md"))).toMatchObject({
      under: "root",
    });
  });

  it("covers a path reached through a link out of the Root, and says so as a Grant rather than as the Root", async () => {
    await resetFixtures();
    // A link inside the Root pointing at a folder a Grant covers. Read as a
    // string this looks like a path inside the Root; read as paths it is the
    // Grant's folder, and the Grant is what admits it. Which one is reported
    // matters: a read covered by the Root happens without asking, and one
    // covered by a Grant is shown as already allowed.
    await symlink(granted, path.join(root, "link-to-documents"));

    expect(await mayRead(aReadingRoot(granted), path.join(root, "link-to-documents", "notes.md"))).toEqual({
      readable: true,
      path: path.join(granted, "notes.md"),
      under: "grant",
    });
  });

  it("refuses the same path when no Grant covers where the link lands", async () => {
    await resetFixtures();
    await symlink(granted, path.join(root, "link-to-documents"));

    expect(await mayRead(aReadingRoot(), path.join(root, "link-to-documents", "notes.md"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("hands back the resolved path rather than the one asked about, so nothing re-traverses the link", async () => {
    await resetFixtures();
    await symlink(granted, path.join(root, "link-to-documents"));
    const asked = path.join(root, "link-to-documents", "notes.md");

    // The path the Model named is a link and may stop pointing where it did
    // between the check and the read. The path handed back is not, so a caller
    // that opens what it was given cannot be moved in the gap.
    expect([asked, readOrFail(await mayRead(aReadingRoot(granted), asked))]).toEqual([
      asked,
      path.join(granted, "notes.md"),
    ]);
  });

  it("skips a Grant that is not a path at all rather than admitting through it", async () => {
    await resetFixtures();

    // A Grant in the file that is relative would resolve against whichever
    // directory the server was started in. It is not resolved at all.
    expect(
      await mayRead(aReadingRoot("documents", path.join(project, "nowhere")), path.join(granted, "notes.md")),
    ).toEqual({ readable: false, reason: "outside" });
  });
});

describe("a machine that has named no Root", () => {
  it("reads nothing, and says nothing is outside it", async () => {
    await resetFixtures();
    const noRoot: ReadingRoot = { root: null, grants: [], malformed: false };

    expect(await mayRead(noRoot, path.join(root, "README.md"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("reads nothing even where a Grant would have, because a Grant is reached from the Root", async () => {
    await resetFixtures();
    const noRootButGrants: ReadingRoot = { root: null, grants: [granted], malformed: false };

    expect(await mayRead(noRootButGrants, path.join(granted, "notes.md"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });

  it("reads nothing when the file was malformed, which is the answer it reads as", async () => {
    await resetFixtures();
    const malformed: ReadingRoot = { root: null, grants: [], malformed: true };

    expect(await mayRead(malformed, path.join(root, "README.md"))).toEqual({
      readable: false,
      reason: "outside",
    });
  });
});

describe("the path a caller hands over", () => {
  it("is resolved against the Root when it is relative", () => {
    expect(resolveAgainstRoot(root, "src/index.ts")).toBe(path.join(root, "src", "index.ts"));
  });

  it("is passed to the disk with `.` and `..` still in it, rather than tidied here", () => {
    // Neither is removed, because `..` after a link means something different
    // from `..` in the string, and a tidying step cannot tell the two apart.
    // `realpath` resolves both correctly, so there is nothing to gain by
    // guessing at it first.
    expect(resolveAgainstRoot(root, "./README.md")).toBe(`${root}${path.sep}./README.md`);
    expect(resolveAgainstRoot(root, "link/../src")).toBe(`${root}${path.sep}link/../src`);
  });

  it("is left alone when it is already absolute, so a Grant is not re-read as relative to the Root", () => {
    const elsewhere = path.join(project, "secrets", "id_rsa");

    expect(resolveAgainstRoot(root, elsewhere)).toBe(elsewhere);
  });
});

describe("the Grants as a reader wrote them down", () => {
  it("reach the decision through the file, rather than only through a value in memory", async () => {
    // The end to end of it: a Grant recorded in `.reading-root.json` is a
    // boundary, and a path under it is read. Nothing else in the app gets to
    // widen what may be read, so the file is where this has to show up.
    await resetFixtures();
    const home = await mkdtemp(path.join(tmpdir(), "readable-file-"));
    const settled = await realpath(home);

    await writeFile(
      path.join(home, ".reading-root.json"),
      JSON.stringify({ root, grants: [granted] }),
      "utf8",
    );

    try {
      const reading = await readReadingRoot(home);

      expect(await mayRead(reading, path.join(granted, "notes.md"))).toEqual({
        readable: true,
        path: path.join(granted, "notes.md"),
        under: "grant",
      });
    } finally {
      await rm(settled, { recursive: true, force: true });
    }
  });
});