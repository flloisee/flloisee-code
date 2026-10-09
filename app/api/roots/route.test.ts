import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRouteJSON } from "@/lib/http/route-answer";
import {
  setEnvVar,
  temporaryProject,
  type TemporaryProject,
} from "@/lib/testing/temporary-project";

import { POST } from "./route";

/**
 * Declaring a Root, at the Route Handler a reader walks folders through.
 *
 * This route writes a record of a folder on the developer's machine and it lists
 * folders from it, so it is the one place in the app that could both be aimed at
 * a directory the caller chose and hand back what is in it. Every test drives the
 * real handler against a throwaway project: the handler reads its target from the
 * working directory, so pointing that at a temporary directory exercises the real
 * writes without ever recording a real folder as the Root.
 */

const project: TemporaryProject = await temporaryProject("writing-root-route-");
// `dir` is a getter and is deliberately not destructured: a copy taken before the
// first `begin()` would be the empty string rather than a directory.
const { begin, end, rootFile } = project;

const realHome = process.env.HOME;

/**
 * The throwaway project, reached the way the disk reaches it.
 *
 * The walk resolves what it is given and answers with resolved paths, so an
 * expectation written against `project.dir` would be asserting the unresolved
 * form — and on macOS that is a different string. Resolved once here so the
 * expectations below can be written as the literal paths they are.
 */
let here = "";

beforeEach(async () => {
  await begin();

  // The walk is bounded by the reader's home folder, and `begin()` has just put
  // the process somewhere new — so the home folder is set to the throwaway
  // project's own, and every folder these tests walk is inside it.
  process.env.HOME = project.dir;
  here = await realpath(project.dir);
  await mkdir(path.join(here, "my-project"));
});

afterEach(async () => {
  process.env.HOME = realHome;
  await end();
});

function rootsRequest(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/roots", {
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

/** The Root file's contents, or `null` when there is no file at all. */
function readRootFile(): Promise<string | null> {
  return readFile(rootFile(), "utf8").catch(() => null);
}

describe("declaring a Root outside development", () => {
  it("refuses, so no deployed build can record a folder or list one", async () => {
    setEnvVar("NODE_ENV", "production");

    // Both halves: the route that names folders and the route that writes one.
    // A build that could list but not write would still be a build that hands
    // its caller a map of the machine.
    const listed = await rootsRequest({ action: "find" });
    const declared = await rootsRequest({ action: "declare", path: here });

    expect([listed.status, declared.status]).toEqual([404, 404]);
    expect(await answerOf(declared)).toHaveProperty("error");
    // Nothing was written, so refusing has left the machine as it was found.
    expect(await readRootFile()).toBeNull();
  });
});

describe("the folder the walk offers", () => {
  it("lists what is in the folder it starts at, and says which folder that was", async () => {
    await mkdir(path.join(here, "another-project"));

    const response = await rootsRequest({ action: "find" });

    expect(response.status).toBe(200);
    expect(await answerOf(response)).toEqual({
      path: here,
      parent: null,
      entries: [
        { name: "another-project", path: path.join(here, "another-project"), kind: "directory" },
        { name: "my-project", path: path.join(here, "my-project"), kind: "directory" },
      ],
    });
  });

  it("lists the folder it is asked about, so the reader can walk down into one", async () => {
    await mkdir(path.join(here, "my-project", "src"));

    const response = await rootsRequest({ action: "find", path: path.join(here, "my-project") });

    expect(response.status).toBe(200);
    expect(await answerOf(response)).toMatchObject({
      path: path.join(here, "my-project"),
      parent: here,
      entries: [{ name: "src", kind: "directory" }],
    });
  });

  it("refuses a folder it would not itself offer, rather than listing it", async () => {
    // Somewhere else on the developer's machine entirely. The walk is bounded to
    // the reader's home folder, and the answer says which edge that is rather
    // than whether this one path happened to exist.
    const response = await rootsRequest({ action: "find", path: "/etc" });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("home folder") });
  });

  it("refuses a path carrying a null byte", async () => {
    const response = await rootsRequest({
      action: "find",
      path: `${here}${String.fromCharCode(0)}/etc`,
    });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("null byte") });
  });

  it("refuses a request naming no action, rather than guessing which was meant", async () => {
    const response = await rootsRequest({ path: here });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toHaveProperty("error");
  });

  it("refuses a request that is not JSON at all", async () => {
    const response = await POST(
      new Request("http://localhost/api/roots", { method: "POST", body: "nonsense" }),
    );

    expect(response.status).toBe(400);
  });
});

describe("declaring a Root", () => {
  it("records the folder, and reports which one, so a later request can be made about it", async () => {
    const target = path.join(here, "my-project");

    const response = await rootsRequest({ action: "declare", path: target });

    // The answer carries the folder back because a caller that walked here and a
    // server that recorded it are two processes that may disagree about where
    // the folder really is. The server's word is the resolved one, and that is
    // the one every later check is made against.
    expect(await answerOf(response)).toEqual({ root: target });

    const read = await rootsRequest({ action: "read" });
    expect(await answerOf(read)).toEqual({ root: target, malformed: false });
  });

  it("refuses a file, so a Root is always a folder that is there", async () => {
    const file = path.join(here, "a-file.txt");
    await writeFile(file, "contents", "utf8");

    const response = await rootsRequest({ action: "declare", path: file });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("not a folder") });
    // Nothing written, so the refusal left the machine as it was found rather
    // than replacing a good Root with one that cannot be read from.
    expect(await readRootFile()).toBeNull();
  });

  it("refuses a folder that is not there, rather than recording one that cannot be read", async () => {
    const response = await rootsRequest({ action: "declare", path: path.join(here, "never-made") });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("nothing at") });
    expect(await readRootFile()).toBeNull();
  });
});

describe("forgetting a Root", () => {
  it("leaves nothing behind, so a later Turn reads nothing", async () => {
    await rootsRequest({ action: "declare", path: path.join(here, "my-project") });

    const response = await rootsRequest({ action: "forget" });

    expect(response.status).toBe(200);
    expect(await answerOf(response)).toEqual({ root: null });
    expect(await readRootFile()).toBeNull();

    const read = await rootsRequest({ action: "read" });
    expect(await answerOf(read)).toEqual({ root: null, malformed: false });
  });
});

describe("a file that is not a Root", () => {
  it("is reported rather than quietly taken for the thing it is not", async () => {
    await writeFile(rootFile(), "{ not json at all", "utf8");

    const response = await rootsRequest({ action: "read" });

    // Told rather than hidden: a reader who declared a Root and found the app
    // quietly reading nothing deserves to know there is a file in the way.
    expect(await answerOf(response)).toEqual({ root: null, malformed: true });
  });
});