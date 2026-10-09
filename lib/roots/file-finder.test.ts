import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/files/route";
import { ROOT_FILE } from "@/lib/roots/reading-root";
import { temporaryProject, type TemporaryProject } from "@/lib/testing/temporary-project";

import { findFiles, resolvePath } from "./file-finder";

/**
 * Reading the `/api/files` route's answer, at the one place the interface reads it.
 *
 * The route is not stubbed here: `fetch` is rewired to call the real handler
 * against a throwaway project, so these tests pin the contract — what goes out,
 * what comes back, and what the interface is left holding — rather than the
 * client's reading of a shape invented beside it. Ticket 09 builds on the other
 * half of that contract, and a shape that only one of the two sides knows about
 * is the way that goes wrong.
 */

const project: TemporaryProject = await temporaryProject("file-finder-");
const { begin, end } = project;

const REAL_FETCH = globalThis.fetch;

let here = "";
let inRoot = "";

beforeEach(async () => {
  await begin();
  here = await realpath(project.dir);
  inRoot = path.join(here, "project");

  await mkdir(path.join(inRoot, "src"), { recursive: true });
  await writeFile(path.join(inRoot, "src", "util.ts"), "export const help = 1;\n");
  await writeFile(path.join(inRoot, "src", "index.ts"), "export const start = 2;\n");
  await writeFile(path.join(inRoot, "notes.md"), "later\n");

  // A sibling of the Root, which is beside it and not inside it.
  await mkdir(path.join(here, "project-other"), { recursive: true });
  await writeFile(path.join(here, "project-other", "private.ts"), "export const no = 1;\n");

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    POST(
      new Request(
        new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          "http://localhost",
        ).href,
        init,
      ),
    )) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = REAL_FETCH;
  await end();
});

async function choose(root: string): Promise<void> {
  await writeFile(path.join(here, ROOT_FILE), `${JSON.stringify({ root, grants: [] }, null, 2)}\n`);
}

/** The Root of this machine, for asserting that it never reaches the browser. */
async function rootOnDisk(): Promise<string> {
  return inRoot;
}

describe("asking what is in the Root", () => {
  it("answers with the files it found, in the form the Tools are asked with", async () => {
    await choose(await rootOnDisk());

    const answer = await findFiles("util");

    expect(answer).toMatchObject({
      status: "found",
      complete: true,
      matches: [{ name: "util.ts", path: "src/util.ts", kind: "file" }],
    });
  });

  it("sends the words after the `@`, and nothing the reader did not type", async () => {
    await choose(await rootOnDisk());
    const sent: unknown[] = [];
    const reading = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await reading(input, init);
      sent.push(JSON.parse(String(init?.body)));
      return response;
    }) as typeof fetch;

    await findFiles("src/uti");

    expect(sent).toEqual([{ action: "find", query: "src/uti" }]);
  });

  it("holds no Root and no path from this machine, only paths from the Root", async () => {
    await choose(await rootOnDisk());

    const answer = await findFiles("");

    // The address of the folder is the server's business. What lands in a
    // Conversation is what the reader chose to point at.
    expect(JSON.stringify(answer)).not.toContain(await rootOnDisk());
  });

  it("says nothing matched rather than answering with an empty list of nothing", async () => {
    await choose(await rootOnDisk());

    const answer = await findFiles("zzzz");

    // A list of zero with no sentence reads as "your folder is empty", which is a
    // different and much more alarming claim than "no file is called that".
    expect(answer.status).toBe("found");
    expect(answer).toMatchObject({ matches: [], complete: true });
    expect(answer.status === "found" && answer.note).toContain("zzzz");
  });

  it("reports a list that was cut short, rather than presenting it as the whole Root", async () => {
    await choose(await rootOnDisk());

    // The route reports this; the interface is the only thing that can decide
    // whether to say it, so it must survive the trip across.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ rootDeclared: true, matches: [], complete: false, note: "cut short" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const answer = await findFiles("");

    expect(answer).toMatchObject({ status: "found", complete: false, note: "cut short" });
  });

  it("says no folder has been chosen, distinctly from a folder with nothing in it", async () => {
    const answer = await findFiles("");

    // The reader has to be told which of the two it is, because only one of them
    // is something they can go and fix by choosing a folder.
    expect(answer).toMatchObject({ status: "no-root" });
    expect(answer.status === "no-root" && answer.note).not.toBe("");
  });

  it("treats an answer in a shape it does not know as a refusal, not as an empty Root", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ matches: "everything" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const answer = await findFiles("");

    // Silently showing "nothing here matches" for a route that answered in a
    // shape it did not recognise is a bug that reads as a feature.
    expect(answer.status).toBe("refused");
    expect(answer.status === "refused" && answer.message).toContain("unexpected form");
  });

  it("says the route could not be reached, rather than throwing at the composer", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;

    const answer = await findFiles("");

    expect(answer).toMatchObject({ status: "refused" });
  });
});

describe("the verdict on a path the reader named", () => {
  it("answers for a file inside the Root", async () => {
    await choose(await rootOnDisk());

    expect(await resolvePath("src/util.ts")).toMatchObject({
      status: "resolved",
      path: "src/util.ts",
      under: "root",
      kind: "file",
    });
  });

  it("passes the route's own words back when the path is refused", async () => {
    await choose(await rootOnDisk());

    const answer = await resolvePath("../project-other/private.ts");

    // Rewritten here would be this app's words about a decision the route made,
    // and there are two of them to keep in step.
    expect(answer.status).toBe("refused");
    expect(answer.status === "refused" && answer.message).toContain("Grant");
  });

  it("treats an answer in a shape it does not know as a refusal", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ path: "src/util.ts" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const answer = await resolvePath("src/util.ts");

    expect(answer.status).toBe("refused");
  });
});