import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { locateFolder, MAX_LOCATE_FOLDERS, MAX_LOCATE_MATCHES } from "./locate";

/**
 * Turning the name the browser's folder dialog gives into somewhere on this
 * machine.
 *
 * The dialog a reader opens is their operating system's, and it hands the web
 * page a *name* — never a path. Chrome deleted `File.path` in 2017 and nothing
 * has put it back. So the reader picks something and this module is what turns
 * that into a folder, and the two things worth asserting are that it is honest
 * about where the name landed and that it never lands outside the boundary.
 *
 * The boundary is the point rather than a detail: a reader who picked a folder
 * on a volume that is not mounted, and who has a folder of the same name in
 * their home folder, must be *shown* where the app found one rather than handed
 * it. Every match here goes through the same admission the rest of the feature
 * is stood on.
 */

let project = "";
/** Stands in for the reader's home folder, and is the search's boundary. */
let home = "";
const realHome = process.env.HOME;

beforeAll(async () => {
  project = await realpath(await mkdtemp(path.join(tmpdir(), "locate-")));
});

beforeEach(async () => {
  // A fresh home for each test, so nothing is asserted against what the last
  // one left behind. "Outside the boundary" is a folder these tests made.
  await rm(home, { recursive: true, force: true });
  home = path.join(project, "home");
  await mkdir(home);
  process.env.HOME = home;
});

afterAll(async () => {
  process.env.HOME = realHome;
  await rm(project, { recursive: true, force: true });
});

async function aFolder(...segments: string[]): Promise<string> {
  const folder = path.join(project, ...segments);
  await mkdir(folder, { recursive: true });
  return folder;
}

async function aFile(...segments: string[]): Promise<string> {
  const file = path.join(project, ...segments);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "contents", "utf8");
  return file;
}

describe("a name the reader picked", () => {
  it("is answered with where a folder of that name really is", async () => {
    const wanted = await aFolder("home", "projects", "chat");

    // The whole path, resolved, because a name on its own cannot be acted on:
    // the reader chose a folder, not a folder's name, and this is the answer to
    // "which folder did you mean".
    expect(await locateFolder("chat")).toEqual({
      ok: true,
      matches: [{ path: wanted }],
      complete: true,
    });
  });

  it("offers every folder of that name, so the reader picks rather than guessing", async () => {
    const near = await aFolder("home", "projects", "chat");
    const far = await aFolder("home", "archive", "old", "chat");

    const located = await locateFolder("chat");

    // Both, and the shallower one first. Two folders can easily be called the
    // same thing, and which of them the reader meant is a fact about their
    // machine that this module cannot know — so it does not pretend to.
    expect(located).toEqual({
      ok: true,
      matches: [{ path: near }, { path: far }],
      complete: true,
    });
  });
});

/**
 * Where the search may go.
 *
 * The reader picked a folder in a dialog that could see every volume on the
 * machine, and this search can only see their home folder. Those are different
 * sets, and the gap between them is the whole reason the reader is shown the
 * path before anything is recorded.
 */
describe("a folder that is not inside the boundary", () => {
  it("is never matched, even when something inside home carries its name", async () => {
    const onAnotherVolume = await aFolder("elsewhere", "Projects");
    await symlink(onAnotherVolume, path.join(home, "Projects"));

    // `/Volumes/External/Projects` is where the reader actually pointed. The
    // search cannot reach it, and the answer it can honestly give is "nothing
    // here" — which sends them to the walk, not to a folder they did not pick.
    expect(await locateFolder("Projects")).toEqual({ ok: true, matches: [], complete: true });
  });

  it("is not matched when it is reached through a folder of the right name", async () => {
    // The name the reader picked is `Projects`, and there is one in home — but
    // what is inside that one is outside. Matching on the name alone would put
    // a path on disk in front of them that the walk would refuse a moment later.
    const outside = await aFolder("elsewhere", "secrets");
    const link = path.join(home, "Projects");
    await symlink(outside, link);

    expect(await locateFolder("secrets")).toEqual({ ok: true, matches: [], complete: true });
  });
});

describe("a link inside the boundary", () => {
  it("is offered as the folder it really is, so the reader is shown where it lands", async () => {
    const real = await aFolder("home", "work", "the-real-one");
    await symlink(real, path.join(home, "Projects"));

    // Answered with the folder the link points at rather than with the link. A
    // reader choosing the Root wants the place, and a Root recorded as a link is
    // a Root whose meaning changes when the link does.
    expect(await locateFolder("Projects")).toEqual({
      ok: true,
      matches: [{ path: real }],
      complete: true,
    });
  });

  it("is never walked into, so what is behind one is not searched", async () => {
    const behind = await aFolder("home", "work", "linked", "Projects");
    await symlink(path.join(home, "work", "linked"), path.join(home, "shortcut"));

    // Found directly, and only directly: the name is matched where the folder
    // really is in the tree, and a search that followed the link would be
    // answering about a place the walk cannot go either.
    expect(await locateFolder("Projects")).toEqual({
      ok: true,
      matches: [{ path: behind }],
      complete: true,
    });
  });

  it("is not walked into even when it points at the folder being searched", async () => {
    // A link to an ancestor is the loop every walk has to not have. Terminating
    // at all is the assertion: a search that followed this one would fill its
    // whole ceiling with copies of itself.
    await symlink(home, path.join(home, "loop"));
    await aFolder("home", "Projects");

    expect(await locateFolder("Projects")).toEqual({
      ok: true,
      matches: [{ path: path.join(home, "Projects") }],
      complete: true,
    });
  });
});

/**
 * What is refused, and why refusing it is the feature rather than a guard on it.
 *
 * A name is a name. The whole design rests on the browser being able to hand
 * over the last component of a path and nothing else — so a caller that sends
 * `../../etc` is not sending a folder name, it is sending a path with the
 * authority this feature deliberately never gave the browser. Refusing it is
 * what keeps that authority from arriving by the back door, one string at a time.
 */
describe("something that is not a name", () => {
  it("is refused when it carries a path separator", async () => {
    for (const asked of ["projects/chat", "projects\\chat", "/projects", "projects/"]) {
      expect(await locateFolder(asked)).toEqual({ ok: false, reason: "not-a-name" });
    }
  });

  it("is refused when it is a way of naming a folder above the search", async () => {
    expect(await locateFolder("..")).toEqual({ ok: false, reason: "not-a-name" });
    expect(await locateFolder(".")).toEqual({ ok: false, reason: "not-a-name" });
  });

  it("is refused when it carries a null byte, rather than letting it reach the disk", async () => {
    expect(await locateFolder(`Projects${String.fromCharCode(0)}`)).toEqual({
      ok: false,
      reason: "not-a-name",
    });
  });

  it("is refused when it is longer than a folder name can be", async () => {
    // Not an arbitrary limit: 255 is what a single path component can be on the
    // filesystems this runs on, so a longer one could not be a folder's name at
    // all. It is refused because there is nothing it could mean, rather than
    // because it is large.
    expect(await locateFolder("p".repeat(256))).toEqual({ ok: false, reason: "not-a-name" });
    expect(await locateFolder("p".repeat(255))).toMatchObject({ ok: true });
  });

  it("is refused when it is empty, since there is no folder with no name", async () => {
    expect(await locateFolder("")).toEqual({ ok: false, reason: "not-a-name" });
  });
});

/**
 * A search that did not finish.
 *
 * Every ceiling in this feature states itself rather than being applied quietly,
 * and this one matters more than it looks: a search that stopped early and
 * reported `complete: true` would be telling the reader "this is the only folder
 * called that" about a folder it never looked past.
 */
describe("a search that stopped before the end", () => {
  it("says so rather than reporting one match as though it were the only one", async () => {
    const wanted = await aFolder("home", "Projects");
    // A home folder larger than the search will go into. Real rather than a
    // lowered ceiling, because a test that shrinks the limit to reach it is a
    // test that would also pass with the limit gone.
    await Promise.all(
      Array.from({ length: MAX_LOCATE_FOLDERS }, (_, index) =>
        mkdir(path.join(home, `f${String(index).padStart(4, "0")}`)),
      ),
    );

    const located = await locateFolder("Projects");

    // One match, found — and `complete: false`, which is what tells the
    // interface that this one might not be the one, rather than a match it can
    // present as certain.
    expect(located).toEqual({ ok: true, matches: [{ path: wanted }], complete: false });
  });

  it("says so when it gave up offering matches, and stops rather than answering longer", async () => {
    await Promise.all(
      Array.from({ length: MAX_LOCATE_MATCHES + 5 }, (_, index) =>
        aFolder("home", `p${String(index).padStart(4, "0")}`, "Projects"),
      ),
    );

    const located = await locateFolder("Projects");

    // Stopped at the ceiling rather than answering with all thirty, because a
    // list that kept growing is a list with no end to it, and a route that could
    // be aimed at "tell me every folder on this machine" is the map of the
    // machine the walk exists to refuse to be.
    if (!located.ok) throw new Error("expected a search, was refused");
    expect(located.matches).toHaveLength(MAX_LOCATE_MATCHES);
    expect(located.complete).toBe(false);
  });
});

/** The names this app never walks, said once here rather than in every walk. */
describe("names that are never searched", () => {
  it("are skipped wherever they are, so a Credential is not a folder the app offers", async () => {
    await aFolder("home", "node_modules", "Projects");
    await aFolder("home", ".git", "Projects");
    await aFile("home", "a-project", ".env");
    const wanted = await aFolder("home", "a-project", "Projects");

    // One question — *is this something we look at* — with one answer in the
    // app, so a Credential cannot be reached through whichever walk is asked.
    expect(await locateFolder("Projects")).toEqual({
      ok: true,
      matches: [{ path: wanted }],
      complete: true,
    });
  });
});