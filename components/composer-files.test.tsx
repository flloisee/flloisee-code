// @vitest-environment jsdom

import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/files/route";
import { Chat } from "@/components/chat";
import { resolvePath } from "@/lib/roots/file-finder";
import { ROOT_FILE } from "@/lib/roots/reading-root";
import { temporaryProject, type TemporaryProject } from "@/lib/testing/temporary-project";

/**
 * Naming a file from the Root with `@`, driven as a reader drives it.
 *
 * The composer is rendered against the real Route Handler with the Root on a
 * throwaway disk, so every row in the menu is one the shipping walk actually
 * found — a stubbed route would prove only that the composer renders what it was
 * handed. Nothing in the model layer is stubbed either: these tests never send a
 * message except the one about Enter, and that one reads the composer's own
 * reaction rather than waiting on a Response.
 */

const project: TemporaryProject = await temporaryProject("composer-files-");
const { begin, end } = project;

const REAL_FETCH = globalThis.fetch;

let here = "";
let inRoot = "";

async function write(relative: string, contents: string | Uint8Array): Promise<void> {
  const target = path.join(inRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

/** A project with source in it, and names the walk would never offer. */
async function seed(withRoot: boolean): Promise<void> {
  inRoot = path.join(here, "project");
  await mkdir(inRoot, { recursive: true });

  await write("index.ts", "export const root = 1;\n");
  await write("notes.md", "later\n");
  await write("src/index.ts", "export const start = 2;\n");
  await write("src/util.ts", "export const help = 3;\n");
  await write("src/deep/nested.ts", "export const deep = 4;\n");
  await write("assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await write("node_modules/dep/index.js", "module.exports = 1;\n");
  await write(".env.local", "SECRET=hunter2\n");

  // A sibling of the Root, which shares its name and is beside it rather than
  // under it.
  await mkdir(path.join(here, "project-other"), { recursive: true });
  await writeFile(path.join(here, "project-other", "private.ts"), "export const no = 1;\n");

  if (withRoot) {
    await writeFile(
      path.join(here, ROOT_FILE),
      `${JSON.stringify({ root: inRoot, grants: [] }, null, 2)}\n`,
    );
  }
}

beforeEach(async () => {
  await begin();
  here = await realpath(project.dir);

  // Only the browser → Route Handler hop is rewired. The walk behind it is the
  // real one over a real folder, so what the menu offers is what shipping code
  // would offer on a reader's own disk.
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
  cleanup();
  globalThis.fetch = REAL_FETCH;
  await end();
});

const onSave: (messages: UIMessage[]) => void = () => {};

/** The composer, opened on a project whose Root is declared — or is not. */
async function openComposer(withRoot = true): Promise<HTMLTextAreaElement> {
  await seed(withRoot);
  render(
    <Chat
      endpointId="ollama"
      endpointName="Ollama"
      modelId="llama3.2"
      conversation={null}
      onSave={onSave}
    />,
  );

  // Focused before typing, because `fireEvent` does not move focus the way a
  // keystroke does: without it every assertion about who holds the caret would be
  // an assertion about jsdom rather than about the composer. This is a fact about
  // the harness, not about the interface.
  const field = composer();
  field.focus();
  return field;
}

function composer(): HTMLTextAreaElement {
  return screen.getByLabelText("Message") as HTMLTextAreaElement;
}

/** Types into the composer the way a reader does, caret ending at the end. */
function type(text: string): void {
  fireEvent.change(composer(), { target: { value: text } });
}

/** Presses a key on the composer, which is the only place the menu can hear it. */
function press(key: string, shiftKey = false): void {
  fireEvent.keyDown(composer(), { key, shiftKey });
}

/** The rows in the menu, as the paths a reader is choosing between. */
function offered(): string[] {
  return rows().map((row) => row.getAttribute("data-offered") ?? "");
}

function rows(): HTMLElement[] {
  const list = screen.queryByRole("listbox");
  return list === null ? [] : [...list.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** The row the reader has moved to, read the way a screen reader announces it. */
function highlighted(): string | null {
  const active = composer().getAttribute("aria-activedescendant");
  return active === null ? null : (document.getElementById(active)?.getAttribute("data-offered") ?? null);
}

const waitForMenu = () => waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());

const OFFERED = "picking a file from the Root";

describe(OFFERED, () => {
  it("opens on `@` and offers what is in the folder the reader chose", async () => {
    await openComposer();

    type("look at @");

    await waitForMenu();
    // Named from the Root: what lands in the message is short to read, and the
    // reader's own home directory is not spelled out in their Conversation.
    expect(offered()).toEqual([
      "assets",
      "assets/logo.png",
      "src",
      "src/deep",
      "src/deep/nested.ts",
      "src/index.ts",
      "src/util.ts",
      "index.ts",
      "notes.md",
    ]);
  });

  it("filters to what the words after the `@` are reaching for", async () => {
    await openComposer();

    type("@ut");

    await waitForMenu();
    expect(offered()).toEqual(["src/util.ts"]);
  });

  it("filters again as the reader keeps typing, rather than answering once", async () => {
    await openComposer();

    type("@");
    await waitForMenu();
    expect(offered().length).toBeGreaterThan(1);

    type("@u");

    await waitFor(() => expect(offered()).toEqual(["src/util.ts"]));
  });

  it("never offers anything outside the Root, or a name the walk would never open", async () => {
    await openComposer();

    type("@");

    await waitForMenu();
    const shown = offered().join(" ");
    expect(shown).not.toContain("private.ts");
    expect(shown).not.toContain("dep");
    expect(shown).not.toContain(".env");
    expect(shown).not.toContain(here);
  });

  it("offers a folder and a file side by side, and says which is which", async () => {
    await openComposer();

    type("@");

    await waitForMenu();
    // A folder is a name a reader would otherwise have to type out in full, so it
    // belongs in the same list — and it has to be distinguishable from a file,
    // because picking one and picking the other mean different things.
    expect(rows()[0].getAttribute("data-kind")).toBe("directory");
    expect(rows()[0].textContent).toContain("folder");
    expect(rows()[1].getAttribute("data-kind")).toBe("file");
    expect(rows()[1].textContent).not.toContain("folder");
  });

  it("announces itself as a listbox, with exactly one row chosen", async () => {
    await openComposer();

    type("@");

    await waitForMenu();
    // The first is already chosen, so Enter does the obvious thing without the
    // reader having to learn the menu before using it.
    expect(rows().filter((row) => row.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(rows()[0].getAttribute("aria-selected")).toBe("true");
  });
});

const CHOSEN = "choosing with the keyboard";

describe(CHOSEN, () => {
  it("moves through the list with the arrow keys", async () => {
    await openComposer();
    type("@");
    await waitForMenu();

    const all = offered();
    expect(highlighted()).toBe(all[0]);

    press("ArrowDown");
    expect(highlighted()).toBe(all[1]);

    press("ArrowDown");
    expect(highlighted()).toBe(all[2]);

    press("ArrowUp");
    expect(highlighted()).toBe(all[1]);
  });

  it("wraps around the ends, so a long list is reachable without watching the caret", async () => {
    await openComposer();
    type("@");
    await waitForMenu();

    const all = offered();
    press("ArrowUp");

    expect(highlighted()).toBe(all.at(-1));
  });

  it("inserts the path of the one chosen, from the Root rather than from the disk", async () => {
    await openComposer();
    type("@ut");
    await waitForMenu();

    press("Enter");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    // The `@` goes with the words after it. It was how the name was chosen and
    // it is not part of it, so what is left is a plain Root-relative path: what
    // the reader can check, what the Model is asked for, and what the pasted-path
    // check in ticket 09 recognises as a path rather than as punctuation.
    expect(composer().value).toBe("src/util.ts ");
  });

  it("inserts the path of a folder, rather than what is in it", async () => {
    await openComposer();
    type("@src");
    await waitForMenu();

    press("Enter");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(composer().value).toBe("src ");
  });

  it("leaves the reader able to carry on typing after the path", async () => {
    await openComposer();
    type("@ut");
    await waitForMenu();
    press("Enter");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    type("src/util.ts and ");

    // The insertion is an ordinary edit in an ordinary textarea, and the caret
    // lands after it: the reader takes it as a starting point rather than as a
    // finished thing.
    expect(composer().value).toBe("src/util.ts and ");
    expect(composer().selectionStart).toBe("src/util.ts and ".length);
  });

  it("closes on Escape and leaves what was typed where it was", async () => {
    await openComposer();
    type("ask me about @ut");
    await waitForMenu();

    press("Escape");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    // Dismissed, not undone: the menu never edited the composer, so there is
    // nothing to take back and nothing the reader has to type again.
    expect(composer().value).toBe("ask me about @ut");
  });

  it("comes back the moment the reader carries on typing", async () => {
    await openComposer();
    type("@ut");
    await waitForMenu();

    press("Escape");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    type("@utx");

    // Dismissal lasts until the next keystroke, the way an editor's completion is
    // dismissed — otherwise a reader who pressed Escape by accident would have to
    // delete the whole mention to ask again.
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("utx"));
  });

  it("still offers the list when the words go back to something that matches", async () => {
    await openComposer();
    type("@");
    await waitForMenu();

    press("Escape");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    type("@u");

    // Dismissal is not remembered against the words, only against the reader
    // having stopped typing: two mentions of the same file are two mentions.
    await waitForMenu();
    expect(offered()).toEqual(["src/util.ts"]);
  });
});

const CARET = "the menu and the composer underneath it";

describe(CARET, () => {
  it("never takes the caret, so what is being typed still lands in the composer", async () => {
    const field = await openComposer();

    type("@ut");
    await waitForMenu();

    // Focus is the reader's own, all through. A menu that focused itself would
    // be a menu that silently stops taking the words being typed into the very
    // message they are writing.
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("@ut");
    expect(field.selectionStart).toBe(3);
  });

  it("leaves the keys to the composer whenever it is closed", async () => {
    const field = await openComposer();

    type("just a message");
    press("ArrowDown");
    press("ArrowUp");

    expect(field.value).toBe("just a message");
    expect(screen.queryByRole("listbox")).toBeNull();

    // Enter sends, which the composer shows by clearing itself — the one part of
    // that a reader sees without a Response coming back.
    press("Enter");
    expect(field.value).toBe("");
  });

  it("keeps writing an ordinary message once the mention is behind them", async () => {
    await openComposer();

    type("@src/util.ts and then what does it do?");

    // A mention ends at the first space. The rest of the sentence is the reader's,
    // and a menu opening over it would be a menu answering a different question
    // from the one they are asking.
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(composer().value).toBe("@src/util.ts and then what does it do?");
  });

  it("leaves an address alone, because that is what an `@` in the middle of one is", async () => {
    await openComposer();

    type("write to me@example.com about it");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(composer().value).toBe("write to me@example.com about it");
  });
});

describe("a path the menu chose", () => {
  it("is one the app can resolve, which is the only claim that matters about it", async () => {
    await openComposer();
    type("@ut");
    await waitForMenu();
    press("Enter");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    // What the menu inserted is not a label — it is a path the Tools will be asked
    // for and the pasted-path check will recognise, so the two are put to each
    // other here rather than each being asserted separately.
    const resolved = await resolvePath(composer().value.trim());

    expect(resolved).toMatchObject({
      status: "resolved",
      path: "src/util.ts",
      under: "root",
      kind: "file",
    });
  });

  it("resolves a folder the same way, because picking one is naming it", async () => {
    await openComposer();
    type("@src");
    await waitForMenu();
    press("Enter");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    expect(await resolvePath(composer().value.trim())).toMatchObject({
      status: "resolved",
      path: "src",
      kind: "directory",
    });
  });
});

const NO_ROOT = "a Root that cannot be offered from";

describe(NO_ROOT, () => {
  it("says no folder has been chosen, rather than opening a list of nothing", async () => {
    await openComposer(false);

    type("@");

    // The two are opposite things for a reader — one is something they can go and
    // fix — so neither is ever shown as an empty list.
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("not chosen a folder"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says so when nothing matches, rather than closing in silence", async () => {
    await openComposer();

    type("@zzzz");

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("zzzz"));
    // The menu stays open: a reader who typed a wrong letter needs to see what
    // was looked for, not a menu that vanished and left them guessing.
    expect(composer().value).toBe("@zzzz");
  });
});