import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { walkFiles, type WalkedEntry } from "./scan";

/**
 * The walk, asked for names rather than for text.
 *
 * `walkFiles` gained a second caller and a second way of being read: the `@`
 * menu wants to know what is in the Root without any of it being opened. What is
 * asserted here is what that second way must keep — the same skips, the same
 * order, and above all that not opening a file it was never going to open.
 */

let project = "";
let root = "";

beforeEach(async () => {
  await rm(project, { recursive: true, force: true });
  project = await realpath(await mkdtemp(path.join(tmpdir(), "walk-entries-")));
  root = path.join(project, "project");
  await mkdir(root);
});

afterAll(async () => {
  await rm(project, { recursive: true, force: true });
});

async function write(relative: string, contents: string | Uint8Array): Promise<string> {
  const written = path.join(root, relative);
  await mkdir(path.dirname(written), { recursive: true });
  await writeFile(written, contents, "utf8");
  return written;
}

async function seed(): Promise<void> {
  await write("index.ts", "export const root = 1;\n");
  await write("src/index.ts", "export const start = 2;\n");
  await write("src/util.ts", "export const help = 3;\n");
  await write("node_modules/dep/index.js", "module.exports = 1;\n");
  await write(".env.local", "SECRET=hunter2\n");
  await write(".git/config", "[core]\n");
  await write("assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await symlink(path.join(project, "elsewhere"), path.join(root, "link-out"));
}

/** Every entry the walk reached, in the order it reached them. */
async function entriesIn(from = root): Promise<WalkedEntry[]> {
  const seen: WalkedEntry[] = [];
  await walkFiles({
    from,
    onEntry: (entry) => {
      seen.push(entry);
      return true;
    },
  });
  return seen;
}

describe("the walk offering names rather than text", () => {
  it("offers a folder and what is in it, folders first", async () => {
    await write("src/util.ts", "export const help = 3;\n");

    expect((await entriesIn()).map((entry) => entry.relative)).toEqual(["src", "src/util.ts"]);
  });

  it("never offers a name the walk would never open", async () => {
    await seed();

    const offered = (await entriesIn()).map((entry) => entry.relative).join(" ");

    // The three skips, on this caller's path exactly as on the search's: one
    // walk, so a name the walk hides from a search is hidden from a menu too.
    expect(offered).not.toContain("node_modules");
    expect(offered).not.toContain(".env.local");
    expect(offered).not.toContain(".git");
  });

  it("offers a file that is not text, because naming one is not reading one", async () => {
    await seed();

    const png = (await entriesIn()).find((entry) => entry.relative === "assets/logo.png");

    // A menu that filtered by name by reading every file first would silently
    // lose every image on the machine, which is a file a developer very much
    // wants to name. `read_file` is where refusing one belongs.
    expect(png).toMatchObject({ kind: "file", name: "logo.png" });
  });

  it("offers no link, because a name is what a reader picks and not what it points at", async () => {
    await seed();

    expect((await entriesIn()).map((entry) => entry.relative)).not.toContain("link-out");
  });

  it("opens nothing at all, because nothing here was asked for text", async () => {
    await seed();

    const opened: string[] = [];
    const outcome = await walkFiles({
      from: root,
      onEntry: (entry) => {
        opened.push(entry.relative);
        return true;
      },
    });

    // `files` counts files handed to `visit`. A walk asked only for names opens
    // no file, so a Root is not read through to answer a question about letters.
    expect(opened.length).toBeGreaterThan(0);
    expect(outcome.files).toBe(0);
  });

  it("stops where the caller says to, rather than handing back the rest", async () => {
    for (let index = 0; index < 20; index += 1) {
      await write(`many/file-${index}.ts`, "export const no = 1;\n");
    }

    const offered: string[] = [];
    const outcome = await walkFiles({
      from: root,
      onEntry: (entry) => {
        offered.push(entry.relative);
        return offered.length < 3;
      },
    });

    expect(offered).toHaveLength(3);
    expect(outcome.stopped).toBe(true);
  });

  it("still hands over a file's lines to a caller that asked for them", async () => {
    await write("notes.md", "one\ntwo\n");

    const lines: string[][] = [];
    await walkFiles({
      from: root,
      visit: (file) => {
        lines.push(file.lines);
        return true;
      },
    });

    // The optional `visit` is the whole reason the other half is optional: this
    // is the walk `search_files` has always had.
    expect(lines).toEqual([["one", "two"]]);
  });
});