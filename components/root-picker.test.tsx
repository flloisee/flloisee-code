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

/**
 * Answers to the name search, kept on their own queue.
 *
 * Separate from `answers` because it is asked for only after a reader has opened
 * a dialog, and a test that pushed both would be asserting on an ordering
 * nothing about the reader's own actions guarantees.
 */
let locations: unknown[] = [];

beforeEach(async () => {
  answers = [];
  locations = [];

  // The control is absent outside development, which is the ordinary case under
  // a test runner. Set here rather than in each test, so no test can accidentally
  // assert against a component that would never be rendered.
  vi.stubEnv("NODE_ENV", "development");

  vi.spyOn(route, "readRoot").mockImplementation(async () => (answers.shift() as never) ?? {
    status: "none",
    malformed: false,
    grants: [],
  });
  vi.spyOn(route, "requestWalk").mockImplementation(async () => (answers.shift() as never) ?? {
    status: "refused",
    message: "no listing was arranged for this test",
  });
  vi.spyOn(route, "locateFolder").mockImplementation(
    async () => (locations.shift() as never) ?? { status: "located", name: "?", matches: [], complete: true },
  );
  vi.spyOn(route, "declareRoot").mockImplementation(async () => (answers.shift() as never) ?? {
    status: "declared",
    root: DEEP,
    grants: [],
  });
  vi.spyOn(route, "forgetRoot").mockImplementation(async () => (answers.shift() as never) ?? {
    status: "none",
    malformed: false,
    grants: [],
  });
});

afterEach(() => {
  cleanup();
  withoutNativeDialog();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The dialog the reader lands on, which is the machine's own folder dialog. */
async function openChooser(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: /choose a folder/i }));
  return screen.getByRole("dialog");
}

/** The walk, reached the way a reader reaches it: from the chooser. */
async function openWalk(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: /choose a folder/i }));
  fireEvent.click(await screen.findByRole("button", { name: /choose a folder another way/i }));
  return screen.getByRole("dialog");
}

/** Stands the browser's own folder dialog up, and takes it away again. */
function withNativeDialog(opened: () => Promise<{ name: string }>) {
  (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = opened;
}

function withoutNativeDialog() {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
}

/** The hidden input the fallback tier is built on. */
function folderInput(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (found === null) throw new Error("the chooser offered no folder input");
  return found;
}

/** What a `webkitdirectory` input reports for a folder holding `relative`. */
function filesIn(relative: string | null) {
  const file = relative === null ? null : { webkitRelativePath: relative };
  return file === null ? [] : [file];
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
    answers.push({ status: "declared", root: `${HOME}/projects/chat`, grants: [] });
    renderPicker();

    // The folder's own name rather than the whole path: the name is what the
    // reader recognises a project by, and the path is below it for when two
    // folders are called the same thing.
    expect(await screen.findByText("chat")).toBeTruthy();
    expect(screen.getByText(`${HOME}/projects/chat`)).toBeTruthy();
  });

  it("offers a way to change it and a way to remove it", async () => {
    answers.push({ status: "declared", root: DEEP, grants: [] });
    renderPicker();

    await screen.findByText("chat");
    expect(screen.getByRole("button", { name: /change folder/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove/i })).toBeTruthy();
  });

  it("says so when the file holding it could not be read, rather than showing none", async () => {
    // The state a reader can fix and one they cannot tell apart from "no Root" if
    // it were reported as nothing: a file is there and it does not say what it
    // should.
    answers.push({ status: "none", malformed: true, grants: [] });
    renderPicker();

    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
  });
});

/**
 * The folder dialog belonging to the reader's own machine.
 *
 * **No browser folder dialog can return a path.** Chrome removed `File.path` in
 * v61 as a privacy fix and nothing has put it back, so both tiers below hand
 * the app a *name* and the app asks its own server where that name really is.
 * Every assertion here is about that: what was sent up, what came back, and
 * that nothing is recorded until the reader has read the path and asked for it.
 */
describe("choosing a folder in the machine's own dialog", () => {
  /** The one folder the search is going to find. */
  const HERE = `${HOME}/projects`;
  /** A second one with the same name, further in. */
  const THERE = `${HOME}/archive/old/projects`;

  it("sends the native dialog's name up and shows where that name really is", async () => {
    withNativeDialog(async () => ({ name: "projects" }));
    locations.push({ status: "located", matches: [{ path: HERE }], complete: true });
    renderPicker();

    const dialog = await openChooser();

    // The name, and nothing else — the handle a native dialog returns carries no
    // path at all, so this is the whole of what the browser was ever given.
    expect(route.locateFolder).toHaveBeenCalledWith("projects");

    // ... and the path came back from the server. Whole, because the reader is
    // about to hand over a location and a location has to be readable.
    expect(await within(dialog).findByText(HERE)).toBeTruthy();
  });

  it("records nothing until the reader has seen that path and pressed for it", async () => {
    answers.push({ status: "none", malformed: false, grants: [] }, { status: "declared", root: HERE, grants: [] });
    withNativeDialog(async () => ({ name: "projects" }));
    locations.push({ status: "located", matches: [{ path: HERE }], complete: true });
    renderPicker();

    const dialog = await openChooser();
    await within(dialog).findByText(HERE);

    // Found is not chosen. This is the property the whole confirmation exists to
    // hold, and it is the one that would be lost quietly: the app has resolved a
    // name to a folder, the reader has not been asked, and nothing is written.
    expect(route.declareRoot).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /use this folder/i }));

    // With the path that was on screen, character for character. A path built
    // here instead — out of the name, or out of a Root this component does not
    // know — is the bug the confirmation was added to catch.
    await waitFor(() => expect(route.declareRoot).toHaveBeenCalledWith(HERE));
    expect(await within(dialog).findByText(/now reads/i)).toBeTruthy();
  });

  it("takes the same name from the input, where the browser has no native dialog", async () => {
    withoutNativeDialog();
    locations.push({ status: "located", matches: [{ path: HERE }], complete: true });
    renderPicker();

    const dialog = await openChooser();
    fireEvent.change(folderInput(), { target: { files: filesIn("projects/chat/index.ts") } });

    // The attribute that makes this pick a folder rather than files, and whose
    // presence rather than any value of it is the whole of the difference. React
    // carries no type for it, so it is spread onto the element — and this is the
    // assertion that the spread was not quietly dropped.
    expect(folderInput().hasAttribute("webkitdirectory")).toBe(true);

    // `webkitRelativePath` is a path with its root missing, so its first
    // component is the whole of what Safari and Firefox were able to say. The
    // rest of it is how to reach one file inside the folder that was chosen.
    await waitFor(() => expect(route.locateFolder).toHaveBeenCalledWith("projects"));
    expect(await within(dialog).findByText(HERE)).toBeTruthy();
  });

  it("offers every folder of that name and records the one the reader pressed", async () => {
    answers.push({ status: "none", malformed: false, grants: [] }, { status: "declared", root: THERE, grants: [] });
    withNativeDialog(async () => ({ name: "projects" }));
    locations.push({
      status: "located",
      matches: [{ path: HERE }, { path: THERE }],
      complete: true,
    });
    renderPicker();

    const dialog = await openChooser();
    await within(dialog).findByText(THERE);

    // Both, whole. Two folders inside one person's home folder can easily be
    // called the same thing, and which of them they picked is a fact about their
    // disk that this app has no way of knowing.
    expect(within(dialog).getByText(HERE)).toBeTruthy();

    fireEvent.click(within(dialog).getAllByRole("button", { name: /use this folder/i })[1]);

    // The row that was pressed, and not the shallower one that happened to be
    // found first — breadth-first search finds them in an order, not in an
    // order of importance.
    await waitFor(() => expect(route.declareRoot).toHaveBeenCalledWith(THERE));
  });

  it("says so when nothing inside the home folder carries that name", async () => {
    withNativeDialog(async () => ({ name: "Projects" }));
    locations.push({ status: "located", matches: [], complete: true });
    renderPicker();

    const dialog = await openChooser();

    // The name, the boundary, and why the folder they picked may be perfectly
    // real and still not findable here. Handing over the `Projects` in their home
    // folder instead would be a silent answer to the wrong question.
    expect(await within(dialog).findByText(/nothing called projects is inside your home folder/i)).toBeTruthy();
    expect(route.declareRoot).not.toHaveBeenCalled();
  });

  it("says so when the folder chosen was empty, rather than showing a panel that does nothing", async () => {
    withoutNativeDialog();
    renderPicker();

    const dialog = await openChooser();
    fireEvent.change(folderInput(), { target: { files: filesIn(null) } });

    // Said, with somewhere to go. An empty folder is a folder a reader may well
    // have meant, and this tier can say nothing about it at all — a blank panel
    // would read as a broken control rather than as a limit of the browser.
    expect(await within(dialog).findByText(/nothing in it/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /choose a folder another way/i })).toBeTruthy();
    // And nothing was searched for on the strength of a name that was never
    // given.
    expect(route.locateFolder).not.toHaveBeenCalled();
    expect(route.declareRoot).not.toHaveBeenCalled();
  });

  it("says the search may have stopped short, and shows what it did find", async () => {
    withNativeDialog(async () => ({ name: "projects" }));
    locations.push({ status: "located", matches: [{ path: HERE }], complete: false });
    renderPicker();

    const dialog = await openChooser();

    // Both, and the finding is on screen next to it: a reader told only that the
    // search stopped has nothing to act on, and a folder shown without the
    // caveat reads as the only one there is.
    expect(await within(dialog).findByText(/stopped before it reached the end/i)).toBeTruthy();
    expect(within(dialog).getByText(HERE)).toBeTruthy();
  });

  it("gives up the same caveat when it found nothing at all", async () => {
    // The case where claiming nothing is there would be a certainty the app does
    // not have: it stopped, so it did not look past its own ceiling.
    withNativeDialog(async () => ({ name: "Projects" }));
    locations.push({ status: "located", matches: [], complete: false });
    renderPicker();

    const dialog = await openChooser();

    expect(await within(dialog).findByText(/stopped before it reached the end/i)).toBeTruthy();
  });

  it("treats a closed dialog as the reader's own doing, and not as a failure", async () => {
    withNativeDialog(async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    });
    renderPicker();

    const dialog = await openChooser();

    // No alert and nothing written. Somebody who closed a dialog has not been
    // refused anything, and a panel that told them they had would be inventing a
    // failure to explain a choice they made themselves.
    expect(await within(dialog).findByText(/nothing has been chosen yet/i)).toBeTruthy();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(route.declareRoot).not.toHaveBeenCalled();
  });
});

/**
 * Choosing a folder another way.
 *
 * The walk is the answer for everything a name cannot be: a folder outside the
 * home folder, a folder nothing is called, a folder that was empty. It is
 * offered from the panel rather than only from the empty results, because a
 * reader who has picked the wrong one should not have to close and start again.
 */
describe("when the name is not enough", () => {
  it("walks to the folder instead, and is the only dialog left open", async () => {
    answers.push(
      { status: "none", malformed: false, grants: [] },
      listing(HOME, [{ name: "Documents", kind: "directory" }]),
    );
    withNativeDialog(async () => ({ name: "Projects" }));
    locations.push({ status: "located", matches: [], complete: true });
    renderPicker();

    const chooser = await openChooser();
    await within(chooser).findByText(/nothing called projects/i);

    fireEvent.click(within(chooser).getByRole("button", { name: /choose a folder another way/i }));

    // One dialog, not two. The walk replaces the panel rather than stacking on
    // it, so a reader who has just been told a name is not enough is not left
    // answering questions about something they were told does not exist.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await screen.findByText("Documents")).toBeTruthy();
    // And it is the walk doing the work, from the reader's own home folder.
    expect(route.requestWalk).toHaveBeenCalledWith(undefined);
  });

  it("walks to the folder when the one that was chosen was empty", async () => {
    answers.push(
      { status: "none", malformed: false, grants: [] },
      listing(HOME, [{ name: "Documents", kind: "directory" }]),
    );
    renderPicker();

    const chooser = await openChooser();
    fireEvent.change(folderInput(), { target: { files: filesIn(null) } });
    await within(chooser).findByText(/nothing in it/i);

    fireEvent.click(within(chooser).getByRole("button", { name: /choose a folder another way/i }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await screen.findByText("Documents")).toBeTruthy();
  });
});

/**
 * The paths the reader has allowed beyond the Root.
 *
 * An "always allow" is only worth having if it can be taken back: a Grant is a
 * standing permission for a file the reader was asked about once, and the reason
 * they said yes — a question about one document — has usually gone by the next
 * morning. They are listed rather than summarised, because a permission the
 * reader cannot see is a permission they cannot judge.
 */
describe("paths allowed beyond the Root", () => {
  const NOTES = `${HOME}/notes/todo.md`;
  const CONFIG = `${HOME}/etc/app.conf`;

  beforeEach(() => {
    vi.spyOn(route, "revokeGrant").mockImplementation(async () => (answers.shift() as never) ?? {
      status: "granted",
      grants: [],
    });
  });

  it("lists each one whole, so the reader can tell which decision it was", async () => {
    answers.push({ status: "declared", root: DEEP, grants: [NOTES, CONFIG] });
    renderPicker();

    await screen.findByText("chat");

    // Whole, and not shortened to a basename: two of these can easily be called
    // the same thing in different folders, and it is the folder that was asked
    // about.
    expect(screen.getByText(NOTES)).toBeTruthy();
    expect(screen.getByText(CONFIG)).toBeTruthy();
  });

  it("offers a way to take each one back, and removes only the one pressed", async () => {
    answers.push(
      { status: "declared", root: DEEP, grants: [NOTES, CONFIG] },
      { status: "granted", grants: [CONFIG] },
    );
    renderPicker();

    await screen.findByText("chat");
    const rows = screen.getAllByRole("button", { name: /stop allowing/i });
    expect(rows).toHaveLength(2);

    fireEvent.click(rows[0]);

    // Named exactly as the route listed it, and never re-resolved in the browser:
    // the route compares exactly too, and a normalised string would be asking to
    // remove a Grant under a name the file does not hold.
    await waitFor(() => expect(route.revokeGrant).toHaveBeenCalledWith(NOTES));
    expect(await screen.findByText(CONFIG)).toBeTruthy();
    expect(screen.queryByText(NOTES)).toBeNull();
  });

  it("keeps a Grant on screen when the route refused to take it back", async () => {
    answers.push(
      { status: "declared", root: DEEP, grants: [NOTES] },
      { status: "refused", message: "The app refused that. Nothing was written." },
    );
    renderPicker();

    await screen.findByText("chat");
    fireEvent.click(screen.getByRole("button", { name: /stop allowing/i }));

    // A removal that appears to have worked and has not is the one direction of
    // error here that leaves the reader believing the Model reads less than it
    // does.
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringMatching(/refused/i),
    );
    expect(screen.getByText(NOTES)).toBeTruthy();
  });

  it("shows none of this when nothing has been allowed", async () => {
    answers.push({ status: "declared", root: DEEP, grants: [] });
    renderPicker();

    await screen.findByText("chat");

    // Nothing to list and nothing to remove: a control that removes nothing is a
    // button whose only effect is to do nothing.
    expect(screen.queryByRole("button", { name: /stop allowing/i })).toBeNull();
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
    answers.push({ status: "declared", root: DEEP, grants: [] }, listing(DEEP, [{ name: "src", kind: "directory" }]));
    renderPicker();

    const dialog = await openWalk();

    // Asked for the Root itself rather than for the reader's home folder, and
    // naming the folder it reached: a reader changing a Root is usually standing
    // in it, and starting them at home would make them walk back every time.
    expect(await within(dialog).findByText("src")).toBeTruthy();
    expect(within(dialog).getByText(DEEP)).toBeTruthy();
  });

  it("opens at the reader's home folder when no Root has been chosen", async () => {
    answers.push({ status: "none", malformed: false, grants: [] }, listing(HOME, [{ name: "projects", kind: "directory" }]));
    renderPicker();

    const dialog = await openWalk();

    expect(await within(dialog).findByText("projects")).toBeTruthy();
    // No path at all, so the server starts the walk itself rather than the
    // browser naming somewhere to begin.
    expect(route.requestWalk).toHaveBeenCalledWith(undefined);
  });

  it("walks down into a folder that is clicked, and back up when the way back is offered", async () => {
    answers.push(
      { status: "declared", root: DEEP, grants: [] },
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
    answers.push({ status: "none", malformed: false, grants: [] }, listing(HOME, [{ name: "projects", kind: "directory" }]));
    renderPicker();

    const dialog = await openWalk();
    await within(dialog).findByText("projects");

    // The walk is bounded to the home folder, so going above it is not a place
    // it will go. Offering the row anyway would be offering a dead end.
    expect(within(dialog).queryByRole("button", { name: ".." })).toBeNull();
  });

  it("records the folder the reader is in, and says it is in use", async () => {
    answers.push(
      { status: "declared", root: DEEP, grants: [] },
      listing(DEEP, [{ name: "src", kind: "directory" }]),
      { status: "declared", root: DEEP, grants: [] },
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
      { status: "declared", root: DEEP, grants: [] },
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
      { status: "declared", root: DEEP, grants: [] },
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
    answers.push({ status: "declared", root: DEEP, grants: [] }, { status: "none", malformed: false, grants: [] });
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
      { status: "declared", root: DEEP, grants: [] },
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