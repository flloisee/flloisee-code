import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listDirectory, walkBoundary } from "./walk";

/**
 * Walking folders for a reader who cannot type a path, observed at the listing
 * the route hands back.
 *
 * The walk is a reader's browser for their own machine, so the two things worth
 * asserting are that it shows what is there and that it does not show what it
 * must not. The second is not a matter of taste: a row here is one click from
 * being the Root, and this app has Credentials on the machine being browsed.
 */

let project = "";
/** Stands in for the reader's home folder, and is the walk's boundary. */
let home = "";
const realHome = process.env.HOME;

beforeAll(async () => {
  project = await realpath(await mkdtemp(path.join(tmpdir(), "walk-")));
});

/**
 * A fresh home folder for each test.
 *
 * The walk is bounded by the home folder of the process asking, so the tests
 * need a home folder of their own — inside the temporary project, so that
 * "outside the boundary" is a folder these tests made rather than somebody
 * else's — and a fresh one each time, because a listing that accumulates across
 * tests is asserting on what the previous test left behind.
 */
beforeEach(async () => {
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

/** The names a listing showed, which is what a reader actually looks at. */
async function namesIn(target: string): Promise<string[]> {
  const listing = await listDirectory(target);
  if (!listing.ok) throw new Error(`expected a listing, was refused: ${listing.reason}`);
  return listing.entries.map((entry) => entry.name);
}

describe("a folder that is there", () => {
  it("is answered with what is in it, folders before files and each group by name", async () => {
    await aFolder("home", "src");
    await aFolder("home", "app");
    await aFile("home", "README.md");
    await aFile("home", "LICENSE");

    const listing = await listDirectory(home);

    // The folder walked is reported back, because the reader's next move is to
    // name one of its entries and the answer has to say where they are.
    expect(listing).toMatchObject({
      ok: true,
      path: home,
      entries: [
        { name: "app", kind: "directory" },
        { name: "src", kind: "directory" },
        { name: "LICENSE", kind: "file" },
        { name: "README.md", kind: "file" },
      ],
    });
  });

  it("answers an empty folder as empty rather than as nothing to show", async () => {
    expect(await listDirectory(await aFolder("home", "empty"))).toMatchObject({
      ok: true,
      entries: [],
    });
  });
});

describe("a folder holding Credentials", () => {
  it("does not list anything named `.env`, in any of the forms those names take", async () => {
    // Every form Next reads, all of which can hold a Credential. They are
    // skipped rather than offered behind a click: a row here is one click from
    // being the Root, and a Root over `.env.local` is a capability this feature
    // must not present as a choice.
    for (const name of [".env", ".env.local", ".env.development.local", ".env.production"]) {
      await aFile("home", name);
    }
    await aFile("home", "README.md");

    expect(await namesIn(home)).toEqual(["README.md"]);
  });

  it("does not list a `.env.local` that is a link either, since the name is what is listed", async () => {
    const secret = await aFile("secrets", "real-env-content");
    await aFile("home", "README.md");
    await symlink(secret, path.join(home, ".env.local"));

    expect(await namesIn(home)).toEqual(["README.md"]);
  });

  it("lists a folder whose name merely begins with a dot, which is not a Credential", async () => {
    // The skip is on `.env` and not on all dotfiles: `.github` is a folder in
    // almost every project, and hiding it would be a listing that lies about
    // what is there.
    await aFolder("home", ".github");
    await mkdir(path.join(home, ".config"));

    expect((await namesIn(home)).sort()).toEqual([".config", ".github"]);
  });
});

describe("where the walk may go", () => {
  it("starts at the reader's home folder, which is where their projects are", () => {
    // Read per call rather than at import, so the boundary belongs to the
    // process asking rather than to whichever process loaded this module.
    expect(walkBoundary()).toBe(home);
  });

  it("refuses a folder outside the boundary, rather than listing it", async () => {
    const elsewhere = await aFolder("elsewhere");

    expect(await listDirectory(elsewhere)).toEqual({ ok: false, reason: "outside" });
  });

  it("offers the way back up only while the parent is itself inside the boundary", async () => {
    await aFolder("home", "one", "two");

    expect(await listDirectory(path.join(home, "one", "two"))).toMatchObject({
      ok: true,
      // The parent is a row the reader clicks, not a path they can be handed.
      parent: path.join(home, "one"),
    });

    // One level up is the boundary itself, and there is nothing above it that
    // this walk is allowed to show.
    expect(await listDirectory(home)).toMatchObject({ ok: true, parent: null });
  });

  it("refuses a file where a folder was named, and says which it was", async () => {
    const file = await aFile("home", "README.md");

    expect(await listDirectory(file)).toEqual({ ok: false, reason: "not-a-directory" });
  });

  it("refuses a path carrying a null byte, rather than letting it reach the disk", async () => {
    expect(await listDirectory(`${home}${String.fromCharCode(0)}/secrets`)).toEqual({
      ok: false,
      reason: "unusable",
    });
  });
});