// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Settings, type SettingsProps } from "@/components/settings";

/**
 * Settings, observed as a reader meets it.
 *
 * The modal shell is exercised here rather than in a suite of its own because
 * every claim this file makes about the shell — focus moving in, focus coming
 * back, Escape closing — is a claim about what the reader can do once Settings
 * is open. Testing it through one real dialog keeps those claims attached to a
 * thing that exists rather than to a shell in isolation.
 *
 * The Endpoint and Model are passed in the way `Workspace` passes them, on the
 * Local Endpoint the page opens on: nothing about the shell depends on what is
 * being configured, and a Cloud Endpoint would mount Key Entry on top of it.
 *
 * The Theme is asserted through `document.documentElement`, because that is
 * where it actually lives: the stylesheet reads that attribute, and nothing in
 * React holds a copy of it.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  // The Theme is written to the document element and outlives unmounting, so a
  // switch made by one test would otherwise still be in force for the next.
  delete document.documentElement.dataset.theme;
});

function renderSettings(overrides: Partial<SettingsProps> = {}) {
  const props: SettingsProps = {
    endpointId: "ollama",
    endpointName: "Ollama",
    modelId: "llama3.2",
    onSelectEndpoint: vi.fn(),
    onSelectModel: vi.fn(),
    savedCount: 0,
    onDeleteAllChats: vi.fn(),
    ...overrides,
  };

  render(<Settings {...props} />);
  return { trigger: screen.getByRole("button", { name: "Settings" }), props };
}

function openSettings(overrides: Partial<SettingsProps> = {}) {
  const { trigger, props } = renderSettings(overrides);

  // Focused before the click, because a browser focuses a button on mousedown
  // and `fireEvent.click` dispatches only the click. Without this the reader's
  // starting point would be `<body>` in every test, which is a fact about the
  // test harness rather than about the interface.
  trigger.focus();
  fireEvent.click(trigger);

  return { trigger, dialog: screen.getByRole("dialog"), props };
}

/**
 * Moves to a tab by pressing it, the way a reader would.
 *
 * Through `getByRole("tab")` rather than by its position in a list, so a test
 * that says "the Theme tab" keeps meaning the Theme tab if the order of the
 * strip is ever argued about again.
 */
function openTab(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole("tab", { name }));
}

describe("opening Settings", () => {
  it("is a button that has not yet opened anything", () => {
    renderSettings();

    // The dialog is mounted only while it is open, so nothing of it exists in the
    // document until the reader asks for it.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a dialog named for where it is", () => {
    const { dialog } = openSettings();

    // `aria-modal` and the name are what make it a dialog rather than a panel
    // that happened to appear over the page: a screen reader announces both on
    // entry, and the reader knows what they have opened and that the page behind
    // is not available.
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("settings-heading");
    expect(within(dialog).getByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("takes focus, so typing goes into the dialog rather than the page behind", async () => {
    const { dialog } = openSettings();

    // Focus lands on the panel itself rather than on the Close button: the panel
    // is the safe default, because a button focused on open is one keystroke
    // away from a dismissal the reader did not mean to make.
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it("carries a cog beside the word, and says Settings only once", () => {
    const { trigger } = renderSettings();

    // The glyph marks this as the app's own configuration rather than another
    // navigation row, and it is drawn rather than spelled out — a reader with
    // scripting off gets the word on its own, which is why the word stays.
    expect(trigger.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(trigger.textContent).toBe("Settings");
    // And it is named by the button, not by the drawing: the Theme toggle's sun
    // is in the same box and the same weight, and the two must not read alike.
    expect(trigger.querySelectorAll("svg")).toHaveLength(1);
  });
});

describe("the Endpoint and Model in it", () => {
  it("is where they are configured, rather than above the Conversation", () => {
    // Nothing of either exists until the reader opens Settings, which is the
    // point of the move: the reading pane is the Conversation, and what the app
    // is pointed at is a thing to be configured rather than read.
    const { trigger } = renderSettings();

    expect(screen.queryByLabelText("Endpoint")).toBeNull();
    expect(screen.queryByLabelText("Model")).toBeNull();

    fireEvent.click(trigger);

    // Both on the tab that opens, because the Model is a consequence of the
    // Endpoint. Behind separate tabs, choosing one would be followed by hunting
    // elsewhere for what it had produced.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Endpoint")).toBeTruthy();
    expect(within(dialog).getByLabelText("Model")).toBeTruthy();
  });

  it("edits the Endpoint and Model the Conversation is held with", () => {
    const { trigger } = renderSettings();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const endpoint = within(dialog).getByLabelText("Endpoint");

    // The Registry is being read here — it is never answered in the browser —
    // so the control is disabled until it has been. Offering choices the reader
    // cannot make yet would be offering a stale list.
    expect((endpoint as HTMLSelectElement).disabled).toBe(true);

    // The Model in use is what the field is showing, so opening Settings shows
    // the Model a Conversation would be sent to rather than an empty box. The
    // field is the manual one here because nothing answered discovery.
    expect((within(dialog).getByLabelText("Model") as HTMLInputElement).value).toBe("llama3.2");
  });
});

describe("the Reading Root in it", () => {
  it("is configured here, and says so when there is no folder chosen", async () => {
    // In development: outside it the route that names a Root refuses, and the
    // control renders nothing rather than a picker that could only fail.
    vi.stubEnv("NODE_ENV", "development");

    const { trigger } = renderSettings();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    openTab(dialog, "Folder");

    // The absence is stated. A blank row would leave a reader unable to tell a
    // Root of none from a Root that failed to load, and therefore unable to know
    // whether the Model can read their files at all.
    await waitFor(() =>
      expect(within(dialog).getByText(/no folder chosen/i)).toBeTruthy(),
    );
  });
});

describe("the preferences in it", () => {
  it("offers the Theme, named rather than left to the glyph", () => {
    const { dialog } = openSettings();
    openTab(dialog, "Theme");

    // A sun or a moon says nothing about what it changes; the tab it sits under
    // and the sentence beside it say it changes the whole interface.
    expect(within(dialog).getByText(/usual colours, or the opposite/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /switch to dark theme/i })).toBeTruthy();
  });

  it("changes the Theme from inside the dialog", () => {
    const { dialog } = openSettings();
    openTab(dialog, "Theme");

    fireEvent.click(within(dialog).getByRole("button", { name: /switch to dark theme/i }));

    // Read from the document, not from any component state — that attribute is
    // what the stylesheet reads, so it is the only thing that being "in dark
    // theme" actually means here.
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("deleting every Conversation from it", () => {
  /** Opens Settings with Conversations saved and presses Delete all. */
  function askToDeleteAll(savedCount: number) {
    const { dialog, props } = openSettings({ savedCount });
    openTab(dialog, "Saved");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete all" }));

    return { dialog: screen.getByRole("dialog"), props };
  }

  it("offers it once there is something to lose, and says how much", () => {
    const { dialog } = openSettings({ savedCount: 12 });
    openTab(dialog, "Saved");

    // The count is where the decision gets made, not only behind the
    // confirmation: a reader who can see there are twelve of them may decide
    // this is not what they wanted at all, and should not have to open a
    // question to find out what it would cost.
    expect(within(dialog).getByText("12 saved.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Delete all" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("does not offer it when there is nothing to delete", () => {
    const { dialog } = openSettings({ savedCount: 0 });
    openTab(dialog, "Saved");

    // Disabled rather than absent: a control that appeared and vanished with the
    // list would shift the dialog under the reader, and its absence would leave
    // them wondering whether saving works at all.
    expect(within(dialog).getByText("None saved.")).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", { name: "Delete all" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("asks before deleting anything, and says what is lost", () => {
    const { dialog, props } = askToDeleteAll(12);

    // The heading is a question and the body answers it in the reader's terms:
    // how many, that the Turns go too, and that there is no way back. "Are you
    // sure?" would be a formality over a decision they cannot make without these
    // three facts.
    expect(within(dialog).getByRole("heading", { name: /delete every conversation\?/i })).toBeTruthy();
    expect(within(dialog).getByText(/all 12 saved Conversations/i)).toBeTruthy();
    expect(within(dialog).getByText(/no way to get them back/i)).toBeTruthy();

    // And nothing has happened yet. Asking is not agreeing.
    expect(props.onDeleteAllChats).not.toHaveBeenCalled();
  });

  it("replaces the settings rather than stacking a dialog on them", () => {
    const { dialog } = askToDeleteAll(12);

    // One dialog on screen, not two. A question on top of a settings dialog
    // would be a question about a page the reader can no longer see, and two
    // scrims would mean one Escape dismissed both.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // The whole of Settings is gone, strip included — not merely its panels. A
    // strip left behind under a question would still be offering tabs that go
    // nowhere.
    expect(within(dialog).queryByRole("tab")).toBeNull();
  });

  it("deletes nothing when the reader cancels", () => {
    const { dialog, props } = askToDeleteAll(12);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(props.onDeleteAllChats).not.toHaveBeenCalled();

    // Back where they were, still in Settings, rather than in a dialog about
    // deleting something that was not deleted. And on the tab they left from,
    // because the question replaced the dialog and the tab choice survived it.
    const back = within(screen.getByRole("dialog"));
    expect(back.getByRole("tab", { name: "Saved" }).getAttribute("aria-selected")).toBe("true");
    expect(back.getByText("12 saved.")).toBeTruthy();
  });

  it("deletes nothing when the reader presses Escape", () => {
    const { props } = askToDeleteAll(12);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(props.onDeleteAllChats).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /delete every conversation\?/i })).toBeNull();
  });

  it("does not put the button that goes ahead first", () => {
    const { dialog } = askToDeleteAll(12);

    // Read as order rather than as class, because this is what a reader who
    // tabs into the dialog meets before they have read the heading.
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel", "Delete all"]);
  });

  it("asks in the narrow modal, however wide the settings behind it is", () => {
    const { dialog } = askToDeleteAll(12);

    // Settings takes the wide modal for the Model Fit table; a question does not.
    // The same ceiling for both would put a three-line confirmation across half
    // the window, which reads as emphasis on a decision that needs none — and
    // the question is the one dialog in the app where a bigger target is worse.
    expect(dialog.className).toContain("max-w-md");
    expect(dialog.className).not.toContain("max-w-2xl");
  });

  it("takes focus on the panel, so nothing is a keystroke from being deleted", async () => {
    const { dialog } = askToDeleteAll(12);

    // The same reason Settings itself does: focus on a control when a dialog
    // opens is one Enter away from a decision the reader has not read yet, and
    // this is the last decision in the app that should be that easy to make.
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it("deletes when the reader confirms, and only once", () => {
    const { dialog, props } = askToDeleteAll(12);

    const confirm = within(dialog).getByRole("button", { name: "Delete all" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    // Once, not twice: the button is live until the state settles, and a
    // double-fire is the shape of accident this whole dialog exists to prevent.
    expect(props.onDeleteAllChats).toHaveBeenCalledTimes(1);

    // Back in Settings, which is where the count now reads none — the feedback is
    // the dialog the reader is already in, not a second one announcing it. Still
    // on the tab they were on, so the answer to "did that work?" is the thing
    // they were looking at when they asked it.
    //
    // The count itself is not asserted: it is a prop, and a stub that does not
    // change it will say twelve forever. What it does when the list really does
    // empty is `workspace`'s business and covered where the list is.
    expect(screen.queryByRole("heading", { name: /delete every conversation\?/i })).toBeNull();
    const back = within(screen.getByRole("dialog"));
    expect(back.getByRole("tab", { name: "Saved" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("the sections it is divided into", () => {
  it("opens on the Endpoint, and the tab says which one that is", () => {
    const { dialog } = openSettings();

    // Read through the tablist rather than off a tab's appearance: this is what
    // a reader arriving at Settings is told is showing, before they press
    // anything.
    const strip = within(dialog).getByRole("tablist");
    expect(strip.getAttribute("aria-labelledby")).toBe("settings-heading");
    expect(within(strip).getByRole("tab", { name: "Endpoint & Model" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(within(dialog).getByLabelText("Endpoint")).toBeTruthy();
  });

  it("calls its tabs the words GLOSSARY.md settled on", () => {
    const { dialog } = openSettings();

    // The whole strip in one assertion, because the point is the set rather than
    // any one tab. Two of these names were chosen over plainer ones the tab
    // could have worn, so the choice is worth a test rather than a reviewer's
    // memory: `GLOSSARY.md` lists *provider* under Endpoint and *recommendation*
    // under Fit as words not to use, because an Endpoint is not a vendor (Ollama
    // and LM Studio are the reader's own machine) and a Fit is not a judgement
    // about quality — the panel's own note says the ordering is popularity or
    // parameter count and not one.
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual([
      "Endpoint & Model",
      "Folder",
      "Model Fit",
      "Theme",
      "Saved",
    ]);
  });

  it("holds one thing at a time, so what is on screen is what was chosen", () => {
    const { dialog } = openSettings();

    // The Theme is not in the document while the Endpoint tab is showing. Both
    // mounted at once would be the column this replaced, only with tabs drawn
    // over the top of it.
    expect(within(dialog).queryByRole("button", { name: /switch to dark theme/i })).toBeNull();

    openTab(dialog, "Theme");

    expect(within(dialog).getByRole("button", { name: /switch to dark theme/i })).toBeTruthy();
    expect(within(dialog).queryByLabelText("Endpoint")).toBeNull();
  });

  it("has never asked a section the reader did not open", () => {
    const { dialog } = openSettings();

    // The Model Fit tab asks the app's server what this machine is, and its
    // first answer comes from Hugging Face. A reader who came to change the
    // Theme must not have caused that by opening Settings — which is only true
    // because a panel nobody has visited has never mounted.
    expect(within(dialog).queryByText(/reading this machine/i)).toBeNull();
    expect(within(dialog).queryByRole("tablist")).toBeTruthy();
  });

  it("puts the Endpoint and the Model on one tab, because one decides the other", () => {
    const { dialog } = openSettings();

    // Both controls are reachable from the tab that opens. Split across two,
    // choosing an Endpoint would leave the reader hunting a second tab for the
    // Models it had just decided on.
    expect(within(dialog).getByLabelText("Endpoint")).toBeTruthy();
    expect(within(dialog).getByLabelText("Model")).toBeTruthy();
    // And there is no tab named after either of them, so neither is a second
    // thing in this dialog with a name the reader has to keep apart.
    expect(within(dialog).queryByRole("tab", { name: "Model" })).toBeNull();
    expect(within(dialog).queryByRole("tab", { name: "Endpoint" })).toBeNull();
  });

  it("keeps Close out of the strip, on every tab", () => {
    const { dialog } = openSettings();

    // Closing is not a place the reader goes. It sits below the strip whatever
    // is showing, so it is always in the same place and never a tab with
    // nothing behind it.
    expect(within(dialog).queryByRole("tab", { name: /close/i })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /close/i })).toBeTruthy();

    openTab(dialog, "Saved");

    expect(within(dialog).getByRole("button", { name: /close/i })).toBeTruthy();
  });

  it("is walked with the arrows, which move focus without opening anything", () => {
    const { dialog } = openSettings();

    const strip = within(dialog);
    const endpoint = strip.getByRole("tab", { name: "Endpoint & Model" });
    endpoint.focus();

    // Movement, not choice. Opening Hardware mounts it, which asks Hugging
    // Face, and a keypress meant to move along the strip should not send a
    // request to a third party.
    fireEvent.keyDown(endpoint, { key: "ArrowRight" });

    // Focus moved. Nothing did.
    expect(document.activeElement).toBe(strip.getByRole("tab", { name: "Folder" }));
    expect(within(dialog).queryByText(/reading this machine/i)).toBeNull();
    expect(strip.getByRole("tab", { name: "Endpoint & Model" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("wraps at both ends, so the strip cannot be fallen off", () => {
    const { dialog } = openSettings();
    const strip = within(dialog);

    strip.getByRole("tab", { name: "Saved" }).focus();
    fireEvent.keyDown(strip.getByRole("tab", { name: "Saved" }), { key: "ArrowRight" });

    expect(document.activeElement).toBe(strip.getByRole("tab", { name: "Endpoint & Model" }));
  });

  it("puts one tab in the tab order, so tabbing through passes by the strip", () => {
    const { dialog } = openSettings();
    const strip = within(dialog);

    // Five focusable tabs would make the reader tab through four controls they
    // did not ask for on the way to the panel they came for.
    const inOrder = strip
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("tabindex") === "0");

    expect(inOrder.map((tab) => tab.textContent)).toEqual(["Endpoint & Model"]);
  });

  it("says which tab a panel belongs to, so a reader knows what they are in", () => {
    const { dialog } = openSettings();
    openTab(dialog, "Folder");

    // The panel is named for its tab rather than carrying a heading of its own,
    // which is the tab's name spoken aloud on entering it.
    const panel = within(dialog).getByRole("tabpanel");
    const tab = within(dialog).getByRole("tab", { name: "Folder" });

    expect(panel.getAttribute("aria-labelledby")).toBe(tab.getAttribute("id"));
    expect(tab.getAttribute("aria-controls")).toBe(panel.getAttribute("id"));
  });

  it("holds the heading and the strip still, whichever panel is behind them", () => {
    const { dialog } = openSettings();

    // A panel's height is its content's — Saved is two lines, Model Fit is a table
    // of eight — and a dialog as tall as its content puts its top edge wherever
    // the panel in front of it ends. The tab strip is the control the reader has
    // just pressed, so it travelling up and down the screen with the content under
    // it reads as the dialog losing its place.
    //
    // Read off the class rather than measured: jsdom has no layout, so there is no
    // height to compare between two tabs, and what can be dropped is the box that
    // makes the top edge the same on both.
    expect(dialog.className).toContain("h-[min(38rem,100%)]");
    // Centred, which only holds the top edge still because the box does.
    expect(dialog.parentElement?.className).toContain("items-center");

    // The panel behind the strip is what gives way when it is too tall, rather
    // than the whole dialog growing around it — a scroll that took the heading
    // with it would move the top edge and lose the thing this is for.
    const body = within(dialog).getByRole("tabpanel");
    expect(body.className).toContain("overflow-y-auto");
    expect(within(dialog).getByRole("heading", { name: "Settings" }).className).toContain(
      "shrink-0",
    );
  });
});

describe("closing Settings", () => {
  it("takes the wide modal, so the Hardware rows are not truncated", () => {
    const { dialog } = openSettings();
    openTab(dialog, "Model Fit");

    // Read off the class rather than asserted as a width: jsdom has no layout, so
    // there is nothing to measure, and the name of the ceiling is the thing that
    // can be dropped. Wide rather than narrow is not cosmetic here — the
    // repository name is the one column in that table a reader cannot do without,
    // and it is what `truncate` takes first.
    expect(dialog.className).toContain("max-w-2xl");
  });

  it("closes on Close", () => {
    const { dialog } = openSettings();

    fireEvent.click(within(dialog).getByRole("button", { name: /Close/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape, without the reader having to find the button", () => {
    openSettings();

    // Bound to the document rather than the panel, because focus starts on the
    // panel and moves off it as soon as the reader tabs in — a handler on the
    // panel would stop working the moment the dialog was actually being used.
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the scrim is pressed, but not when the dialog itself is", () => {
    const { dialog } = openSettings();

    // Pressing anything inside must not dismiss the dialog the reader is in the
    // middle of using — a tab among them, since moving between them is now
    // something that happens repeatedly while the dialog stays open.
    openTab(dialog, "Theme");
    fireEvent.click(within(dialog).getByRole("button", { name: /switch to dark theme/i }));
    expect(screen.queryByRole("dialog")).toBeTruthy();

    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives focus back to the button, so the reader does not start from the top", async () => {
    const { trigger, dialog } = openSettings();

    fireEvent.keyDown(document, { key: "Escape" });

    // Without this the reader's next Tab starts from the document root, which on
    // a long page means tabbing back through the whole Conversation to reach the
    // list they were just working in.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger).toBeTruthy();
    expect(dialog).toBeTruthy();
  });
});
