// @vitest-environment jsdom

import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as FILES } from "@/app/api/files/route";
import { POST as ROOTS } from "@/app/api/roots/route";
import { Chat } from "@/components/chat";
import { readRoot } from "@/lib/roots/declare-root";
import { resolvePath } from "@/lib/roots/file-finder";
import { ROOT_FILE } from "@/lib/roots/reading-root";
import {
  setEnvVar,
  temporaryProject,
  type TemporaryProject,
} from "@/lib/testing/temporary-project";

/**
 * A path the reader named, asked about in the composer before the Turn exists.
 *
 * The composer is rendered against the real Route Handlers with a Root on a
 * throwaway disk, so a question that appears is one the server really raised and an
 * answer that is recorded is one the server really holds. The Endpoint is never
 * reached: these tests are about what happens before anything is sent, and every
 * assertion that matters is that *nothing was sent*.
 */

const project: TemporaryProject = await temporaryProject("composer-named-paths-");
const { begin, end } = project;

const REAL_FETCH = globalThis.fetch;

/** The reader's own home folder, captured so it can be put back. */
const realHome = process.env.HOME;

let here = "";
let inRoot = "";

async function write(relative: string, contents: string): Promise<void> {
  const target = path.join(inRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function seed(): Promise<void> {
  inRoot = path.join(here, "project");
  await mkdir(inRoot, { recursive: true });

  await write("src/util.ts", "export const help = 3;\n");
  await write("notes.md", "later\n");

  const elsewhere = path.join(here, "elsewhere");
  await mkdir(elsewhere, { recursive: true });
  await writeFile(path.join(elsewhere, "plan.md"), "ship the thing\n", "utf8");
}

beforeEach(async () => {
  await begin();
  // The walk `/api/roots` bounds a decision by is bounded by the reader's home
  // folder, and `begin()` has just put the process somewhere new — so the home
  // folder is the throwaway project's own and every path here is inside it.
  setEnvVar("HOME", project.dir);
  here = await realpath(project.dir);
  await seed();
  await writeFile(
    path.join(here, ROOT_FILE),
    `${JSON.stringify({ root: inRoot, grants: [] }, null, 2)}\n`,
  );

  // Only the browser → Route Handler hop is rewired. Everything behind it is the
  // real walk, the real containment and the real file on disk.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, "http://localhost");
    if (url.pathname === "/api/files") return FILES(new Request(url.href, init));
    if (url.pathname === "/api/roots") return ROOTS(new Request(url.href, init));
    return REAL_FETCH(input, init);
  }) as typeof fetch;
});

afterEach(async () => {
  cleanup();
  globalThis.fetch = REAL_FETCH;
  setEnvVar("HOME", realHome);
  await end();
});

const onSave: (messages: UIMessage[]) => void = () => {};

function openComposer(): HTMLTextAreaElement {
  render(
    <Chat
      endpointId="ollama"
      endpointName="Ollama"
      modelId="llama3.2"
      conversation={null}
      onSave={onSave}
    />,
  );

  const field = screen.getByLabelText("Message") as HTMLTextAreaElement;
  // Focused before typing, because `fireEvent` does not move focus the way a
  // keystroke does — a fact about the harness rather than about the interface.
  field.focus();
  return field;
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText("Message") as HTMLTextAreaElement;
}

function type(text: string): void {
  fireEvent.change(composer(), { target: { value: text } });
}

/** One row per file the message is about, read as the reader reads it. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-named]")];
}

/** The paths the composer is showing, which is what the reader sees it is about. */
function named(): string[] {
  return rows().map((row) => row.getAttribute("data-named") ?? "");
}

/** The one row for a path, so a test can ask what the reader would be told. */
function row(path: string): HTMLElement {
  const found = rows().find((one) => one.getAttribute("data-named") === path);
  if (found === undefined) throw new Error(`no row for ${path}; showing ${named().join(", ")}`);
  return found;
}

/** What the reader is told about one file, which is a sentence rather than a class. */
function saidAbout(path: string): string {
  return row(path).textContent ?? "";
}

/**
 * What one row has come to say, once the server has answered.
 *
 * A row appears the instant the path is recognised and says "checking…" until the
 * route replies, so a test that waited only for the row would be asserting about a
 * question the app had not finished asking.
 */
async function settledAbout(path: string): Promise<string> {
  await waitFor(() => {
    const state = row(path).getAttribute("data-state");
    expect(state === null || state === "checking").toBe(false);
  });
  return saidAbout(path);
}

function press(label: string): void {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
}

/** How many Turns exist, which is the claim "before the Turn exists" is about. */
function turns(): number {
  return document.querySelectorAll("[data-turn]").length;
}

const ASKED = "a file the reader named that the folder does not cover";

/**
 * A file the Root does not cover, reached the way the disk reaches it.
 *
 * A function rather than a constant because `here` is only known once the
 * throwaway project exists — a path joined against an empty string is a relative
 * path, and a relative one would resolve inside the Root and ask nothing.
 */
function outside(): string {
  return path.join(here, "elsewhere", "plan.md");
}

describe(ASKED, () => {
  it("puts the question in the composer, before anything has been sent", async () => {
    openComposer();

    type(`what does ${outside()} say?`);

    await settledAbout(outside());
    // A Turn does not exist yet — no Turn, no Response, nothing in the transcript.
    expect(turns()).toBe(0);
    expect(sendButton().disabled).toBe(true);
  });

  it("says the reader named the file, because the Model did not ask for it", async () => {
    openComposer();

    type(`what does ${outside()} say?`);

    const said = await settledAbout(outside());
    // The words of a Tool Call's approval would claim an agency that is not here:
    // nothing has been generated and nothing was asked of anybody.
    expect(said).toContain("You named");
    expect(said).not.toContain("the Model wants");
  });

  it("offers the same three answers as a Tool Call's approval, in the same words", async () => {
    openComposer();

    type(`what does ${outside()} say?`);

    await settledAbout(outside());
    // One vocabulary of answers across the app. A second set of buttons saying
    // "Yes"/"No" would make the reader learn the same decision twice, and the two
    // moments are not the same — which is why the words here are the words there.
    expect(() => screen.getByRole("button", { name: "Allow once" })).not.toThrow();
    expect(() => screen.getByRole("button", { name: "Always allow" })).not.toThrow();
    expect(() => screen.getByRole("button", { name: "Deny" })).not.toThrow();
  });

  it("shows which Endpoint the file would go to, at the moment it is being named", async () => {
    openComposer();

    type(`what does ${outside()} say?`);

    await waitFor(() => expect(row(outside())).toBeTruthy());
    // The file's contents go to whichever Endpoint is selected, and off the machine
    // if that one is a Cloud Endpoint. The readout sits above the composer so the
    // question and the consequence are read together rather than one Turn apart.
    const inUse = document.querySelector("[data-in-use]");
    expect(inUse?.textContent).toContain("Ollama");
    expect(inUse?.textContent).toContain("llama3.2");
  });

  it("lets the reader allow this one read, and the message can then be sent", async () => {
    openComposer();
    type(`what does ${outside()} say?`);
    await settledAbout(outside());

    press("Allow once");

    await waitFor(() => expect(sendButton().disabled).toBe(false));
    expect(saidAbout(outside())).toContain("allowed this read");
    expect(turns()).toBe(0);
  });

  it("lets the reader refuse it, and the message can still be sent", async () => {
    openComposer();
    type(`what does ${outside()} say?`);
    await settledAbout(outside());

    press("Deny");

    // Refusing one thing must not end the Turn: the reader still has a question,
    // and a Turn they cannot send at all would be refusing everything.
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    await waitFor(() => expect(saidAbout(outside())).toContain("not to let this read happen"));
  });

  it("records a Grant for \"always allow\", so the next message is not asked again", async () => {
    openComposer();
    type(`what does ${outside()} say?`);
    await settledAbout(outside());

    press("Always allow");

    await waitFor(async () => {
      const answer = await readRoot();
      expect(answer.status === "declared" && answer.grants).toEqual([outside()]);
    });

    // A Grant lasts, so the same file in the next message is resolved rather than
    // asked about — which is the difference between the two positive answers.
    expect(await resolvePath(outside())).toMatchObject({ status: "resolved", under: "grant" });
  });

  it("says in its own words what \"always allow\" did, rather than leaving it to the Grant list", async () => {
    openComposer();
    type(`what does ${outside()} say?`);
    await settledAbout(outside());

    press("Always allow");

    await waitFor(() => expect(saidAbout(outside())).toContain("any after it at this path"));
  });

  it("holds the question up rather than answering it, when the server refuses the Grant", async () => {
    openComposer();
    type(`what does ${outside()} say?`);
    await settledAbout(outside());

    setEnvVar("NODE_ENV", "production");
    press("Always allow");

    // A reader who pressed "from now on" and got no Grant has been told the read
    // will not be asked about again, and it will. So the question stands.
    await waitFor(() => expect(saidAbout(outside())).toContain("development"));
    expect(() => screen.getByRole("button", { name: "Allow once" })).not.toThrow();
    expect(sendButton().disabled).toBe(true);
  });
});

const QUIET = "a file the folder the reader chose does cover";

describe(QUIET, () => {
  it("is resolved without interrupting, because nothing is being asked", async () => {
    openComposer();

    type("what does src/util.ts do?");

    await waitFor(() => expect(named()).toEqual(["src/util.ts"]));
    expect(await settledAbout("src/util.ts")).toContain("inside the folder you chose");
    expect(() => screen.getByRole("button", { name: "Allow once" })).toThrow();
  });

  it("is resolved without interrupting when a Grant covers it, and says which", async () => {
    const { grantPath } = await import("@/lib/roots/reading-root");
    await grantPath({ dir: project.dir, path: path.join(here, "elsewhere") });
    openComposer();

    type(`what does ${outside()} say?`);

    await waitFor(() => expect(named()).toEqual([outside()]));
    expect(await settledAbout(outside())).toContain("Grant");
    expect(() => screen.getByRole("button", { name: "Allow once" })).toThrow();
  });

  it("shows one row per file, so the reader sees what the message is about before sending it", async () => {
    openComposer();

    type("compare src/util.ts with notes.md");

    await waitFor(() => expect(named()).toEqual(["src/util.ts", "notes.md"]));
  });
});

const SILENT = "a message that names no file";

describe(SILENT, () => {
  it("shows nothing at all, rather than an empty panel the reader has to read past", async () => {
    openComposer();

    type("and/or is not a path, and neither is e.g. or 3/4");

    await waitFor(() => expect(composer().value).toContain("and/or"));
    expect(named()).toEqual([]);
  });

  it("says so for a path that is not there, rather than asking about a file that does not exist", async () => {
    openComposer();

    type("what does src/never-written.md do?");

    // A typo is a word to fix, not a decision to make: a question here would offer
    // three answers to a problem none of them solves.
    await waitFor(async () =>
      expect(await settledAbout("src/never-written.md")).toContain("moved or deleted"),
    );
    expect(() => screen.getByRole("button", { name: "Allow once" })).toThrow();
    expect(sendButton().disabled).toBe(false);
  });

  it("says so when no folder has been chosen, rather than asking to allow something", async () => {
    const { forgetRoot } = await import("@/lib/roots/reading-root");
    await forgetRoot({ dir: project.dir });
    openComposer();

    type("what does src/util.ts do?");

    await waitFor(async () =>
      expect(await settledAbout("src/util.ts")).toContain("not chosen a folder"),
    );
    expect(() => screen.getByRole("button", { name: "Allow once" })).toThrow();
  });
});