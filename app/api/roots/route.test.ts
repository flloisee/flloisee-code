import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRouteJSON } from "@/lib/http/route-answer";
import { clearDecisions, takeDecisions } from "@/lib/roots/named-decision";
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
  // The decisions a route records are held in this process, not in the project
  // directory `end()` removes, so they are cleared here rather than by the
  // throwaway project.
  clearDecisions();
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

    // All three halves: the route that names folders, the one that turns a name
    // into one, and the one that writes it. A build that could search a folder
    // but not record it would still be a build that hands its caller a map of
    // the machine.
    const listed = await rootsRequest({ action: "find" });
    const located = await rootsRequest({ action: "locate", name: "my-project" });
    const declared = await rootsRequest({ action: "declare", path: here });

    expect([listed.status, located.status, declared.status]).toEqual([404, 404, 404]);
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

  it("refuses a Grant request carrying a field the route does not take", async () => {
    // The browser names the path the Model asked for and nothing else. An
    // unexpected field that is silently ignored looks to the caller like it was
    // honoured — and the field a caller would most want ignored is the one that
    // decides where the Grant lands.
    const response = await rootsRequest({ action: "grant", path: here, root: "/etc" });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toHaveProperty("error");
    expect(await readRootFile()).toBeNull();
  });

  it("refuses a request that is not JSON at all", async () => {
    const response = await POST(
      new Request("http://localhost/api/roots", { method: "POST", body: "nonsense" }),
    );

    expect(response.status).toBe(400);
  });
});

/**
 * Turning a folder name into a folder, on the action that does it.
 *
 * The reader's operating system gives the browser a *name* — `File.path` was
 * removed in Chrome v61 and no picker has replaced it — so this route is the
 * thing that decides where that name actually is. Which makes it the one action
 * here whose answer the reader has to be shown rather than acted on, and the
 * reason it hands back every candidate instead of picking one.
 */
describe("finding the folder a reader picked", () => {
  it("answers with where a folder of that name really is, and that it looked everywhere", async () => {
    await mkdir(path.join(here, "my-project", "src"), { recursive: true });

    const response = await rootsRequest({ action: "locate", name: "src" });

    // The whole path, resolved: a name on its own cannot be acted on, and this
    // is the answer to "which folder did you mean".
    expect(response.status).toBe(200);
    expect(await answerOf(response)).toEqual({
      matches: [{ path: path.join(here, "my-project", "src") }],
      complete: true,
    });
  });

  it("refuses a name carrying a path separator, rather than searching along one", async () => {
    await mkdir(path.join(here, "my-project", "src"), { recursive: true });

    const response = await rootsRequest({ action: "locate", name: "my-project/src" });

    // A name is a name. A caller that could send a path would be sending one
    // with the authority this feature withholds from the browser everywhere
    // else — the route that declares a Root admits every path it is given, and
    // this is the door that would have let a caller walk up to it uninvited.
    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("name") });
  });

  it("refuses a name that is a way of naming a folder above the search", async () => {
    for (const name of ["..", "."]) {
      const response = await rootsRequest({ action: "locate", name });

      expect(response.status).toBe(400);
    }
  });

  it("refuses a name carrying a null byte, rather than letting it reach the disk", async () => {
    const response = await rootsRequest({
      action: "locate",
      name: `my-project${String.fromCharCode(0)}`,
    });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("null byte") });
  });

  it("refuses a name too long to be a folder's, rather than searching for nothing", async () => {
    const response = await rootsRequest({ action: "locate", name: "p".repeat(256) });

    expect(response.status).toBe(400);
  });

  it("does not name a folder outside the reader's home folder, whatever carries its name", async () => {
    // `here` is the home folder these tests run in, so "outside" has to be a
    // directory of its own rather than a sibling inside the project.
    const outside = await mkdtemp(path.join(tmpdir(), "roots-outside-"));
    const onAnotherVolume = path.join(outside, "Projects");
    await mkdir(onAnotherVolume, { recursive: true });
    await symlink(onAnotherVolume, path.join(here, "Projects"));

    // The reader picked this folder in a dialog that could see every volume on
    // the machine. The search cannot reach the one they meant, and the answer it
    // can honestly give is "nothing here" — which sends them to the walk rather
    // than to a folder they did not pick.
    const response = await rootsRequest({ action: "locate", name: "Projects" });

    expect(await answerOf(response)).toEqual({ matches: [], complete: true });

    await rm(outside, { recursive: true, force: true });
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
    expect(await answerOf(read)).toEqual({ root: target, grants: [], malformed: false });
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
    expect(await answerOf(response)).toEqual({ root: null, grants: [] });
    expect(await readRootFile()).toBeNull();

    const read = await rootsRequest({ action: "read" });
    expect(await answerOf(read)).toEqual({ root: null, grants: [], malformed: false });
  });
});

describe("a file that is not a Root", () => {
  it("is reported rather than quietly taken for the thing it is not", async () => {
    await writeFile(rootFile(), "{ not json at all", "utf8");

    const response = await rootsRequest({ action: "read" });

    // Told rather than hidden: a reader who declared a Root and found the app
    // quietly reading nothing deserves to know there is a file in the way.
    expect(await answerOf(response)).toEqual({ root: null, grants: [], malformed: true });
  });
});

/**
 * Grants: the paths a reader has allowed beyond the Root, because they said yes
 * to one when the Model asked.
 *
 * Written here rather than in the reader's browser, which is the whole security
 * argument of the feature: the browser resends the whole message history each
 * Turn and can post anything to this route, so a Grant held in the browser is a
 * Grant something in the browser can pre-approve. A Grant is therefore the second
 * capability this route has, and it is bounded the way the first one is.
 */
describe("answering \"always\" for a path outside the Root", () => {
  /** A file the Model can ask for and the Root does not cover. */
  async function elsewhere(): Promise<string> {
    const folder = path.join(here, "elsewhere");
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, "notes.md");
    await writeFile(file, "ship the thing\n", "utf8");
    return file;
  }

  beforeEach(async () => {
    await rootsRequest({ action: "declare", path: path.join(here, "my-project") });
  });

  it("records the path the Model asked for, resolved, so the next read of it asks nothing", async () => {
    const asked = await elsewhere();

    // The browser sends what the Model wrote — `../elsewhere/notes.md` — and the
    // server resolves it, because the browser has no Root and cannot.
    const response = await rootsRequest({ action: "grant", path: "../elsewhere/notes.md" });

    expect(response.status).toBe(200);
    expect(await answerOf(response)).toEqual({
      root: path.join(here, "my-project"),
      grants: [asked],
    });
    expect(JSON.parse((await readRootFile()) ?? "{}").grants).toEqual([asked]);
  });

  it("is remembered by the next read of the Root, rather than only by the file", async () => {
    const asked = await elsewhere();

    await rootsRequest({ action: "grant", path: asked });

    // A Grant is an admitted prefix, so anything under it is covered — and the
    // read answer says so, which is what the transcript marks as automatic.
    const read = await rootsRequest({ action: "read" });
    expect(await answerOf(read)).toEqual({
      root: path.join(here, "my-project"),
      grants: [asked],
      malformed: false,
    });
  });

  it("refuses a path it would not itself offer, so a Grant cannot reach outside the reader's own folders", async () => {
    await elsewhere();

    // `/etc` is somewhere else on the machine entirely. The walk is bounded to the
    // home folder for the same reason the Root is, and a Grant is no exception to
    // the rule it was meant to widen.
    const response = await rootsRequest({ action: "grant", path: "/etc" });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("home folder") });
    expect(JSON.parse((await readRootFile()) ?? "{}").grants).toEqual([]);
  });

  it("refuses a path the Root already covers, rather than listing a decision that was never a question", async () => {
    const inside = path.join(here, "my-project", "src");
    await mkdir(inside, { recursive: true });

    const response = await rootsRequest({ action: "grant", path: "src" });

    // Nothing was ever asked about this path, so a Grant for it is a claim in the
    // list that no decision backs — and the reader removing it later would be
    // removing something they never gave.
    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("already") });
    expect(JSON.parse((await readRootFile()) ?? "{}").grants).toEqual([]);
  });

  it("refuses when no Root has been chosen, because a Grant is an addition to one", async () => {
    await rootsRequest({ action: "forget" });
    await elsewhere();

    const response = await rootsRequest({ action: "grant", path: "../elsewhere/notes.md" });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("folder") });
    expect(await readRootFile()).toBeNull();
  });

  it("records the same path once, so asking twice does not widen anything", async () => {
    const asked = await elsewhere();

    await rootsRequest({ action: "grant", path: "../elsewhere/notes.md" });
    const again = await rootsRequest({ action: "grant", path: asked });

    expect(await answerOf(again)).toEqual({
      root: path.join(here, "my-project"),
      grants: [asked],
    });
  });

  it("leaves the Root alone, so granting does not cost the reader the folder they chose", async () => {
    const asked = await elsewhere();

    const response = await rootsRequest({ action: "grant", path: asked });

    expect((await answerOf(response)).root).toBe(path.join(here, "my-project"));
  });
});

describe("removing a Grant", () => {
  /** The file a Grant is recorded for, created so the route can resolve it. */
  async function granted(): Promise<string> {
    const folder = path.join(here, "elsewhere");
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, "notes.md");
    await writeFile(file, "ship the thing\n", "utf8");
    return file;
  }

  beforeEach(async () => {
    await rootsRequest({ action: "declare", path: path.join(here, "my-project") });
    await rootsRequest({ action: "grant", path: await granted() });
  });

  it("takes it back out of the file, so the reason for it does not outlive it", async () => {
    const response = await rootsRequest({ action: "revoke", path: await granted() });

    expect(response.status).toBe(200);
    expect(await answerOf(response)).toEqual({
      root: path.join(here, "my-project"),
      grants: [],
    });
    expect(JSON.parse((await readRootFile()) ?? "{}").grants).toEqual([]);
  });

  it("takes out only the one named, so removing one decision does not revoke another", async () => {
    const folder = path.join(here, "elsewhere");
    const other = path.join(folder, "other.md");
    await writeFile(other, "another\n", "utf8");
    await rootsRequest({ action: "grant", path: other });

    const response = await rootsRequest({ action: "revoke", path: path.join(folder, "notes.md") });

    expect((await answerOf(response)).grants).toEqual([other]);
  });

  it("is a no-op for a path that was never granted, because it can only ever narrow", async () => {
    const response = await rootsRequest({ action: "revoke", path: "/etc" });

    // Nothing to refuse: the only thing this can do is remove an entry, so a path
    // that is not one leaves the file exactly as it was.
    expect(response.status).toBe(200);
    expect((await answerOf(response)).grants).toEqual([await granted()]);
  });

  it("leaves no Grant behind when the Root is forgotten", async () => {
    await rootsRequest({ action: "forget" });

    expect(await readRootFile()).toBeNull();
  });
});

/**
 * Deciding about one path, once, for one message.
 *
 * The other two answers a reader gives when they name a file themselves. Unlike a
 * Grant these leave nothing on disk: they are held by this process until the next
 * send spends them, which is what makes them "once" rather than "always".
 *
 * They are here, on the route that writes, for the reason every other write is:
 * **the browser must not be able to mint one.** A decision that arrived in the
 * request would be a request-supplied path being read, which is exactly the
 * primitive this route's development guard and the chat route's refusal of a Root
 * from a request exist to prevent.
 */
describe("deciding about a path the reader named", () => {
  /** A file outside the Root, named the way a reader pastes it. */
  async function elsewhere(): Promise<string> {
    const folder = path.join(here, "elsewhere");
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, "notes.md");
    await writeFile(file, "ship the thing\n", "utf8");
    return file;
  }

  beforeEach(async () => {
    await rootsRequest({ action: "declare", path: path.join(here, "my-project") });
  });

  it("reaches the send that follows it, which is the whole point of the answer", async () => {
    const asked = await elsewhere();

    const response = await rootsRequest({ action: "allow", path: asked });

    expect(response.status).toBe(200);
    expect(takeDecisions().get(asked)).toBe("allowed");
  });

  it("writes nothing to disk, so an answer about one message leaves no standing grant", async () => {
    const asked = await elsewhere();
    const before = await readRootFile();

    await rootsRequest({ action: "allow", path: asked });

    // A Grant is the answer that lasts; this one must not turn into one by
    // accident, or "allow once" would be "allow always" with a different label.
    expect(await readRootFile()).toBe(before);
    expect(JSON.parse(before ?? "{}").grants).toEqual([]);
  });

  it("is spent by the first send that follows, so the second message asks again", async () => {
    const asked = await elsewhere();

    await rootsRequest({ action: "allow", path: asked });
    takeDecisions();

    // The Turn was decided by the answers that were on the books when it arrived.
    // Anything recorded afterwards is for whatever the reader writes next.
    expect(takeDecisions().size).toBe(0);
  });

  it("remembers a refusal as readily as a yes, because refusing one file must not end the Turn", async () => {
    const asked = await elsewhere();

    const response = await rootsRequest({ action: "deny", path: asked });

    expect(response.status).toBe(200);
    expect(takeDecisions().get(asked)).toBe("denied");
  });

  it("is refused outside development, because a deployed build must not mint decisions", async () => {
    await elsewhere();
    setEnvVar("NODE_ENV", "production");

    const response = await rootsRequest({ action: "allow", path: path.join(here, "elsewhere", "notes.md") });

    expect(response.status).toBe(404);
    expect(takeDecisions().size).toBe(0);
  });

  it("refuses a path the walk would not itself offer, so a decision cannot reach further than a Grant", async () => {
    const response = await rootsRequest({ action: "allow", path: "/etc/passwd" });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("home folder") });
    expect(takeDecisions().size).toBe(0);
  });

  it("refuses a path the Root already covers, because no question was ever asked about it", async () => {
    await mkdir(path.join(here, "my-project", "src"), { recursive: true });

    const response = await rootsRequest({ action: "allow", path: "src" });

    expect(response.status).toBe(400);
    expect(takeDecisions().size).toBe(0);
  });

  it("refuses a path that is not there, rather than answering for a file that is not", async () => {
    const response = await rootsRequest({ action: "allow", path: "../elsewhere/never-written.md" });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("moved or deleted") });
    expect(takeDecisions().size).toBe(0);
  });

  it("refuses when no Root has been chosen, because a decision is an addition to one", async () => {
    await rootsRequest({ action: "forget" });
    const asked = await elsewhere();

    const response = await rootsRequest({ action: "allow", path: asked });

    expect(response.status).toBe(400);
    expect(await answerOf(response)).toMatchObject({ error: expect.stringContaining("folder") });
    expect(takeDecisions().size).toBe(0);
  });

  it("does not add to the Grant list, so the reader's standing decisions stay visible as they are", async () => {
    await elsewhere();

    const response = await rootsRequest({ action: "allow", path: "../elsewhere/notes.md" });

    expect((await answerOf(response)).grants).toEqual([]);
  });
});