import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRouteJSON } from "@/lib/http/route-answer";
import {
  temporaryProject,
  type TemporaryProject,
} from "@/lib/testing/temporary-project";

import { POST, MAX_FIND_MATCHES } from "./route";

/**
 * Naming a file from the Root, at the Route Handler the `@` menu asks.
 *
 * This route is the one the composer reaches through on every keystroke, so it is
 * bounded twice over: it cannot name anything outside the Root, and it cannot
 * walk forever looking. Every test drives the real handler against a throwaway
 * project — the handler reads the Root from the working directory, so pointing
 * that at a temporary directory exercises the real containment without any test
 * being able to record the developer's own folder.
 */

const project: TemporaryProject = await temporaryProject("composer-files-route-");
const { begin, end, rootFile } = project;

let here = "";
let inRoot = "";

/** Writes the file that declares the Root, the way the development route does. */
async function declare(root: string): Promise<void> {
  await writeFile(rootFile(), `${JSON.stringify({ root, grants: [] }, null, 2)}\n`);
}

async function write(relative: string, contents: string | Uint8Array): Promise<void> {
  const target = path.join(inRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

/**
 * A project with something in it: source under a Root, and neighbours the Root
 * must never name.
 */
async function seed(): Promise<void> {
  await mkdir(inRoot, { recursive: true });

  await write("README.md", "# the project\n");
  await write("index.ts", "export const root = 1;\n");
  await write("src/index.ts", "export const start = 2;\n");
  await write("src/util.ts", "export const help = 3;\n");
  await write("notes/ideas.md", "later\n");
  await write("assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));

  // What the walk never opens, whatever folder they are in.
  await write("node_modules/left-pad/index.js", "module.exports = 1;\n");
  await write(".env.local", "SECRET=hunter2\n");
  await write(".git/config", "[core]\n");

  // A sibling of the Root, which is outside it despite sharing its name.
  await mkdir(path.join(here, "project-other"), { recursive: true });
  await writeFile(path.join(here, "project-other", "private.ts"), "export const no = 1;\n");
}

beforeEach(async () => {
  await begin();
  here = await realpath(project.dir);
  inRoot = path.join(here, "project");
  await seed();
});

afterEach(async () => {
  await end();
});

function filesRequest(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** The body of an answer, read the way the interface reads it. */
async function answerOf(response: Response): Promise<Record<string, unknown>> {
  const body = await readRouteJSON(response);
  if (typeof body !== "object" || body === null) throw new Error("the route answered with no body");
  return body as Record<string, unknown>;
}

const OFFERED = "offers what is in the Root, and nothing else";

describe(OFFERED, () => {
  it("names the Root's own files and folders, from the Root rather than from the disk", async () => {
    await declare(inRoot);

    const response = await filesRequest({ action: "find", query: "" });
    const body = await answerOf(response);

    expect(response.status).toBe(200);
    expect(body.matches).toEqual([
      { name: "assets", path: "assets", kind: "directory" },
      { name: "logo.png", path: "assets/logo.png", kind: "file" },
      { name: "notes", path: "notes", kind: "directory" },
      { name: "ideas.md", path: "notes/ideas.md", kind: "file" },
      { name: "src", path: "src", kind: "directory" },
      { name: "index.ts", path: "src/index.ts", kind: "file" },
      { name: "util.ts", path: "src/util.ts", kind: "file" },
      { name: "index.ts", path: "index.ts", kind: "file" },
      { name: "README.md", path: "README.md", kind: "file" },
    ]);
  });

  it("never names anything the walk itself would never open", async () => {
    await declare(inRoot);

    const offered = String((await answerOf(await filesRequest({ action: "find", query: "" }))).matches);

    // `node_modules` and `.git` are volume, and anything named `.env` is a file
    // this app holds Credentials in. A menu that offered any of them would be
    // offering a file the Model can never be shown, from the one place a reader
    // picks a file by hand.
    expect(offered).not.toContain("node_modules");
    expect(offered).not.toContain("left-pad");
    expect(offered).not.toContain(".env.local");
    expect(offered).not.toContain(".git");
  });

  it("never names anything outside the Root, and never the Root's own address", async () => {
    await declare(inRoot);

    const response = await filesRequest({ action: "find", query: "" });
    const offered = String((await answerOf(response)).matches);

    // `project-other` shares the Root's name and sits beside it. A containment
    // check done as a string prefix would hand it over.
    expect(offered).not.toContain("private.ts");
    expect(offered).not.toContain("..");

    // Every path is from the Root, so the browser is never told where on this
    // machine the folder is. What lands in a message is what the reader chose.
    expect(offered).not.toContain(here);
    expect(offered).not.toContain("project");
  });

  it("narrows to what the words after the `@` were reaching for", async () => {
    await declare(inRoot);

    const body = await answerOf(await filesRequest({ action: "find", query: "uti" }));

    expect(body.matches).toEqual([{ name: "util.ts", path: "src/util.ts", kind: "file" }]);
  });

  it("matches the whole path rather than only the name, because the words include the folder", async () => {
    await declare(inRoot);

    // `src/uti` is most of a path a reader is halfway through typing, and a
    // matcher that only knew file names would answer "nothing matches" for it.
    const body = await answerOf(await filesRequest({ action: "find", query: "src/uti" }));

    expect(body.matches).toEqual([{ name: "util.ts", path: "src/util.ts", kind: "file" }]);
  });

  it("matches without regard to case, because nobody remembers which case a folder is in", async () => {
    await declare(inRoot);

    const body = await answerOf(await filesRequest({ action: "find", query: "README" }));

    expect(body.matches).toEqual([{ name: "README.md", path: "README.md", kind: "file" }]);
  });

  it("offers a folder and a file side by side, and says which is which", async () => {
    await declare(inRoot);

    const body = await answerOf(await filesRequest({ action: "find", query: "notes" }));

    // A folder a reader wants to name is a name they would otherwise have to
    // type out in full, and picking one inserts its path rather than its
    // contents — which is a different ticket's decision about what to send.
    expect(body.matches).toEqual([
      { name: "notes", path: "notes", kind: "directory" },
      { name: "ideas.md", path: "notes/ideas.md", kind: "file" },
    ]);
  });
});

const THE_CEILINGS = "refuses rather than answering half an answer";

describe(THE_CEILINGS, () => {
  it("says so when no folder has been chosen, rather than opening an empty menu", async () => {
    // The ordinary state of a machine that has not used this feature. An empty
    // list of matches here would read to the reader as "your folder is empty".
    const response = await filesRequest({ action: "find", query: "" });
    const body = await answerOf(response);

    expect(response.status).toBe(200);
    expect(body.rootDeclared).toBe(false);
    expect(body.matches).toEqual([]);
    expect(body.note).toContain("not chosen a folder");
  });

  it("distinguishes a Root file it cannot read from a Root that was never chosen", async () => {
    // A Root that reads as absent with nothing said is a Root that silently
    // stopped being read, and the reader is the one who can fix it.
    await writeFile(rootFile(), "this is not json");

    const body = await answerOf(await filesRequest({ action: "find", query: "" }));

    expect(body.rootDeclared).toBe(false);
    expect(body.note).toContain("cannot be read");
    expect(body.note).not.toContain("not chosen a folder");
  });

  it("says so when the folder itself is gone, rather than reporting nothing to pick", async () => {
    await declare(path.join(here, "a-project-that-was-deleted"));

    const response = await filesRequest({ action: "find", query: "" });
    const body = await answerOf(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("no longer there");
  });

  it("says so when nothing matches, and completes the answer as complete", async () => {
    await declare(inRoot);

    const response = await filesRequest({ action: "find", query: "zzzz" });
    const body = await answerOf(response);

    expect(response.status).toBe(200);
    expect(body.matches).toEqual([]);
    // An empty list found by looking everywhere is a real answer; it is only
    // "partial" that a reader has to be told about.
    expect(body.complete).toBe(true);
    expect(body.note).toContain("zzzz");
  });

  it("stops at a ceiling and says the list is not the whole of it", async () => {
    await declare(inRoot);
    for (let index = 0; index < MAX_FIND_MATCHES + 5; index += 1) {
      await write(`many/file-${index}.ts`, "export const no = 1;\n");
    }

    const body = await answerOf(await filesRequest({ action: "find", query: "file-" }));

    expect(body.matches).toHaveLength(MAX_FIND_MATCHES);
    // The walk is stopped there rather than handed the rest and truncated, so a
    // folder of half a million files ends at the ceiling rather than at the end.
    expect(body.complete).toBe(false);
    expect(body.note).toContain(`first ${MAX_FIND_MATCHES}`);
  });

  it("reports a list that fits as complete, because nothing was left out of it", async () => {
    await declare(inRoot);

    const body = await answerOf(await filesRequest({ action: "find", query: "util" }));

    expect(body.complete).toBe(true);
    expect(body.note).toBe("1 file or folder.");
  });
});

const REFUSES = "refuses a request it cannot answer";

describe(REFUSES, () => {
  it("names the actions it takes, rather than guessing which one was meant", async () => {
    const response = await filesRequest({ action: "search" });
    const body = await answerOf(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("find");
    expect(body.error).toContain("resolve");
  });

  it("refuses a field it does not understand rather than silently ignoring it", async () => {
    // A field that is dropped looks to the caller like it was honoured, which for
    // a query is a menu filtering by something other than what was asked for.
    const response = await filesRequest({ action: "find", query: "util", path: "../" });

    expect(response.status).toBe(400);
  });

  it("refuses a query longer than any path could be", async () => {
    await declare(inRoot);

    const response = await filesRequest({ action: "find", query: "x".repeat(500) });

    expect(response.status).toBe(400);
  });

  it("refuses a body that is not JSON at all, rather than throwing at it", async () => {
    const response = await POST(
      new Request("http://localhost/api/files", { method: "POST", body: "{" }),
    );

    expect(response.status).toBe(400);
  });
});

const VERDICT = "the verdict on a path the reader named";

describe(VERDICT, () => {
  it("answers for a file in the Root, named from the Root", async () => {
    await declare(inRoot);

    const response = await filesRequest({ action: "resolve", path: "src/util.ts" });

    expect(response.status).toBe(200);
    expect(await answerOf(response)).toEqual({
      path: "src/util.ts",
      under: "root",
      kind: "file",
      size: "export const help = 3;\n".length,
    });
  });

  it("answers for a folder too, because naming one is a thing a reader does", async () => {
    await declare(inRoot);

    const response = await filesRequest({ action: "resolve", path: "src" });

    expect(await answerOf(response)).toMatchObject({ path: "src", kind: "directory", size: null });
  });

  it("answers for a path given in full as well as one given from the Root", async () => {
    await declare(inRoot);

    const response = await filesRequest({ action: "resolve", path: path.join(inRoot, "index.ts") });

    expect(await answerOf(response)).toMatchObject({ path: "index.ts", under: "root" });
  });

  it("says which boundary answered, so a Grant is not reported as the Root", async () => {
    const elsewhere = path.join(here, "notes-outside");
    await mkdir(elsewhere);
    await writeFile(path.join(elsewhere, "plan.md"), "the plan\n");
    await writeFile(rootFile(), `${JSON.stringify({ root: inRoot, grants: [elsewhere] }, null, 2)}\n`);

    const response = await filesRequest({ action: "resolve", path: path.join(elsewhere, "plan.md") });

    // A path beyond the Root is named in full rather than as a way out of the
    // Root: there is no shorter form of it that is not a trick.
    expect(await answerOf(response)).toMatchObject({ under: "grant", path: path.join(elsewhere, "plan.md") });
  });

  it("refuses a path outside the Root, and says where to go instead", async () => {
    await declare(inRoot);

    const response = await filesRequest({
      action: "resolve",
      path: "../project-other/private.ts",
    });
    const body = await answerOf(response);

    // A sibling of the Root whose name begins with the Root's own, so a
    // containment check written as a string prefix would have admitted it.
    expect(response.status).toBe(400);
    expect(body.error).toContain("Grant");
  });

  it("refuses a link out of the Root rather than following it", async () => {
    await declare(inRoot);
    await symlink(here, path.join(inRoot, "out"));

    const response = await filesRequest({ action: "resolve", path: "out/private.ts" });

    // Resolving first and comparing second is the order that makes this refusal
    // possible at all; containment checked on the string would have followed it.
    expect(response.status).toBe(400);
  });

  it("refuses a path that is not there, and does not say it is outside", async () => {
    await declare(inRoot);

    const response = await filesRequest({ action: "resolve", path: "src/never-written.ts" });
    const body = await answerOf(response);

    // A typo and a refusal to leave the Root send the reader to different places,
    // and a message that confuses them costs them their own time.
    expect(response.status).toBe(400);
    expect(body.error).toContain("moved or deleted");
  });

  it("refuses anything at all when no folder has been chosen", async () => {
    const response = await filesRequest({ action: "resolve", path: "src/util.ts" });

    // Not a Root that hides everything, but one that has nothing to read: with no
    // Root there are no boundaries, so nothing is inside any of them.
    expect(response.status).toBe(400);
  });

  it("refuses an empty path rather than answering about the Root itself", async () => {
    await declare(inRoot);

    expect((await filesRequest({ action: "resolve", path: "" })).status).toBe(400);
  });
});

/**
 * Why a path was refused, in words the composer can act on.
 *
 * The composer has to decide what to do with a refusal, and the only thing that
 * separates the two behaviours is what *kind* of refusal it is: a path outside the
 * Root puts a question to the reader, and every other refusal puts a sentence on
 * screen. It cannot tell them apart from the prose — both are one sentence about
 * something that was not done — so the reason travels beside the sentence rather
 * than being parsed out of it.
 *
 * It does not travel in the 200. A body the interface already parses strictly
 * gains no field here: `path`, `under`, `kind` and `size` are the whole answer to
 * a question, and a caller that sent something this app does not understand is
 * told so rather than handed a shape it might act on.
 */
const WHY = "a refusal that says what kind it is";

describe(WHY, () => {
  it("names a path beyond the Root as the one that puts a question to the reader", async () => {
    await declare(inRoot);

    const response = await filesRequest({
      action: "resolve",
      path: "../project-other/private.ts",
    });
    const body = await answerOf(response);

    // This is the one refusal the composer turns into an ask rather than a note,
    // and the only one that means "the reader has not been asked about this yet".
    expect(response.status).toBe(400);
    expect(body.reason).toBe("outside");
  });

  it("names a path that is not there as a typo rather than as a boundary", async () => {
    await declare(inRoot);

    const body = await answerOf(
      await filesRequest({ action: "resolve", path: "src/never-written.ts" }),
    );

    // A reader who mistyped has a word to fix, not a decision to make, and asking
    // them to allow a file that is not there would be a question none of the
    // answers can act on.
    expect(body.reason).toBe("unreadable");
  });

  it("names an unusable path as one, so a null byte is not read as a boundary", async () => {
    await declare(inRoot);

    const body = await answerOf(
      await filesRequest({ action: "resolve", path: "src/util\u0000.ts" }),
    );

    expect(body.reason).toBe("unusable");
  });

  it("names a machine with no folder chosen as that, rather than as everything being outside one", async () => {
    // `mayRead` answers `outside` for every path when there is no Root, because
    // with no boundary at all nothing can be inside one. Passing that on
    // unchanged would put "you have not chosen a folder" to the reader as "allow
    // this path", which is not a question any of the three answers can act on.
    const body = await answerOf(await filesRequest({ action: "resolve", path: "src/util.ts" }));

    expect(body.reason).toBe("no-root");
  });

  it("names a request it could not read as that, rather than as a boundary", async () => {
    const body = await answerOf(await filesRequest({ action: "search" }));

    expect(body.reason).toBe("malformed");
  });

  it("never puts a reason on a success, because an answer cannot be handed one it did not ask for", async () => {
    await declare(inRoot);

    const body = await answerOf(await filesRequest({ action: "resolve", path: "src/util.ts" }));

    expect(Object.keys(body)).toEqual(["path", "under", "kind", "size"]);
  });
});