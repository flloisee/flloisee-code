// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RootPicker } from "@/components/root-picker";
import * as route from "@/lib/roots/declare-root";

/**
 * The Reading Root control in Settings, observed as a reader meets it.
 *
 * The walk is stubbed at the module it is called through rather than at `fetch`,
 * because what is being claimed here is about what the reader is shown and what
 * they are asked to do — not about how the request is put on the wire, which the
 * route's own tests already cover.
 */

const HOME = "/Users/reader";

/** A folder two levels down from home, as the walk would report it. */
const DEEP = `${HOME}/projects/chat`;

/** Answers the stubbed route with, in the order they are asked for. */
let answers: unknown[] = [];

beforeEach(async () => {
  answers = [];

  // The control is absent outside development, which is the ordinary case under
  // a test runner. Set here rather than in each test, so no test can accidentally
  // assert against a component that would never be rendered.
  vi.stubEnv("NODE_ENV", "development");

  vi.spyOn(route, "readRoot").mockImplementation(async () => (answers.shift() as never) ?? {
    status: "none",
    malformed: false,
  });
  vi.spyOn(route, "requestWalk").mockImplementation(async () => (answers.shift() as never) ?? {
    status: "refused",
    message: "no listing was arranged for this test",
  });
  vi.spyOn(route, "declareRoot").mockImplementation(async () => (answers.shift() as never) ?? {
    status: "declared",
    root: DEEP,
  });
  vi.spyOn(route, "forgetRoot").mockImplementation(async () => (answers.shift() as never) ?? {
    status: "none",
    malformed: false,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The dialog, once it is open. */
async function openWalk(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: /choose a folder/i }));
  return screen.getByRole("dialog");
}

function renderPicker() {
  render(<RootPicker />);
}

describe("with no Root chosen", () => {
  it("says so, rather than showing a picker with nothing in it", async () => {
    renderPicker();

    // The absence is stated and the one action that changes it is offered. An
    // empty control would leave the reader wondering whether the app reads
    // nothing or whether it has failed to load.
    expect(await screen.findByText(/no folder chosen/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /choose a folder/i })).toBeTruthy();
  });
});

describe("with a Root chosen", () => {
  it("names the folder, so the reader can see what the Model will read", async () => {
    answers.push({ status: "declared", root: `${HOME}/projects/chat` });
    renderPicker();

    // The folder's own name rather than the whole path: the name is what the
    // reader recognises a project by, and the path is below it for when two
    // folders are called the same thing.
    expect(await screen.findByText("chat")).toBeTruthy();
    expect(screen.getByText(`${HOME}/projects/chat`)).toBeTruthy();
  });

  it("offers a way to change it and a way to remove it", async () => {
    answers.push({ status: "declared", root: DEEP });
    renderPicker();

    await screen.findByText("chat");
    expect(screen.getByRole("button", { name: /change folder/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove/i })).toBeTruthy();
  });

  it("says so when the file holding it could not be read, rather than showing none", async () => {
    // The state a reader can fix and one they cannot tell apart from "no Root" if
    // it were reported as nothing: a file is there and it does not say what it
    // should.
    answers.push({ status: "none", malformed: true });
    renderPicker();

    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
  });
});

/** A listing of `folder`, holding the entries given by name. */
function listing(
  folder: string,
  entries: { name: string; kind: "directory" | "file" }[],
  parent: string | null = null,
) {
  return {
    status: "listed" as const,
    path: folder,
    parent,
    entries: entries.map((entry) => ({ ...entry, path: `${folder}/${entry.name}` })),
  };
}

describe("walking to a folder", () => {
  it("opens at the folder already in use, so the reader starts where they left off", async () => {
    answers.push({ status: "declared", root: DEEP }, listing(DEEP, [{ name: "src", kind: "directory" }]));
    renderPicker();

    const dialog = await openWalk();

    // Asked for the Root itself rather than for the reader's home folder, and
    // naming the folder it reached: a reader changing a Root is usually standing
    // in it, and starting them at home would make them walk back every time.
    expect(await within(dialog).findByText("src")).toBeTruthy();
    expect(within(dialog).getByText(DEEP)).toBeTruthy();
  });

  it("opens at the reader's home folder when no Root has been chosen", async () => {
    answers.push({ status: "none", malformed: false }, listing(HOME, [{ name: "projects", kind: "directory" }]));
    renderPicker();

    const dialog = await openWalk();

    expect(await within(dialog).findByText("projects")).toBeTruthy();
    // No path at all, so the server starts the walk itself rather than the
    // browser naming somewhere to begin.
    expect(route.requestWalk).toHaveBeenCalledWith(undefined);
  });

  it("walks down into a folder that is clicked, and back up when the way back is offered", async () => {
    answers.push(
      { status: "declared", root: DEEP },
      listing(DEEP, [{ name: "src", kind: "directory" }], `${HOME}/projects`),
      listing(`${DEEP}/src`, [{ name: "index.ts", kind: "file" }], DEEP),
      listing(DEEP, [{ name: "src", kind: "directory" }], `${HOME}/projects`),
    );
    renderPicker();

    const dialog = await openWalk();

    fireEvent.click(await within(dialog).findByText("src"));

    // Asked again, at the folder just clicked, rather than worked out in the
    // browser: the server is the only place that knows what is in it.
    await waitFor(() => expect(route.requestWalk).toHaveBeenLastCalledWith(`${DEEP}/src`));
    expect(await within(dialog).findByText("index.ts")).toBeTruthy();

    // Back to the folder it was opened on — the parent the server reported, not
    // a string trimmed off the end of a path in the browser.
    fireEvent.click(within(dialog).getByRole("button", { name: ".." }));

    await waitFor(() => expect(route.requestWalk).toHaveBeenLastCalledWith(DEEP));
  });

  it("offers no way back up at the edge, rather than one that goes nowhere", async () => {
    answers.push({ status: "none", malformed: false }, listing(HOME, [{ name: "projects", kind: "directory" }]));
    renderPicker();

    const dialog = await openWalk();
    await within(dialog).findByText("projects");

    // The walk is bounded to the home folder, so going above it is not a place
    // it will go. Offering the row anyway would be offering a dead end.
    expect(within(dialog).queryByRole("button", { name: ".." })).toBeNull();
  });

  it("records the folder the reader is in, and says it is in use", async () => {
    answers.push(
      { status: "declared", root: DEEP },
      listing(DEEP, [{ name: "src", kind: "directory" }]),
      { status: "declared", root: DEEP },
    );
    renderPicker();

    const dialog = await openWalk();
    fireEvent.click(await within(dialog).findByRole("button", { name: /use this folder/i }));

    // The folder being shown, which is the one the reader navigated to — not a
    // path the browser constructed.
    expect(route.declareRoot).toHaveBeenCalledWith(DEEP);
    // Said plainly and immediately: a reader who cannot tell whether a Root took
    // effect has no way to know whether the Model can read anything.
    expect(await within(dialog).findByText(/now reads/i)).toBeTruthy();
  });

  it("shows a file as a name rather than as a way in, since a Root is a folder", async () => {
    answers.push(
      { status: "declared", root: DEEP },
      listing(DEEP, [{ name: "index.ts", kind: "file" }]),
    );
    renderPicker();

    const dialog = await openWalk();

    // Listed, so the reader can see the folder is not empty, but not clickable:
    // the route refuses a file, and offering the click would be offering a
    // mis-click.
    const row = await within(dialog).findByText("index.ts");
    expect(row.tagName).not.toBe("BUTTON");
  });

  it("shows what the route refused rather than an empty listing", async () => {
    answers.push(
      { status: "declared", root: DEEP },
      { status: "refused", message: "There is nothing at that path." },
    );
    renderPicker();

    const dialog = await openWalk();

    // The route's wording names the cause and what to do about it, so it is
    // shown rather than replaced with something generic.
    expect(await within(dialog).findByText(/nothing at that path/i)).toBeTruthy();
  });
});

describe("removing the Root", () => {
  it("tells the reader nothing will be read, rather than leaving them to guess", async () => {
    answers.push({ status: "declared", root: DEEP }, { status: "none", malformed: false });
    renderPicker();

    await screen.findByText("chat");
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(route.forgetRoot).toHaveBeenCalled();
    expect(await screen.findByText(/no folder chosen/i)).toBeTruthy();
  });

  it("keeps the Root in place when the route refuses, rather than dropping it silently", async () => {
    // A removal that appears to have worked and has not is the worst outcome
    // here: the reader would go on believing the Model could read a folder it
    // can no longer reach.
    answers.push(
      { status: "declared", root: DEEP },
      { status: "refused", message: "The app refused that. Nothing was written." },
    );
    renderPicker();

    await screen.findByText("chat");
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    // Named as a refusal, which is a different thing from the folder being gone:
    // the reader has to know whether to try again or go looking for a cause.
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringMatching(/refused/i),
    );
    expect(screen.getByText("chat")).toBeTruthy();
  });
});