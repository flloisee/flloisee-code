// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Settings } from "@/components/settings";

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
  // The Theme is written to the document element and outlives unmounting, so a
  // switch made by one test would otherwise still be in force for the next.
  delete document.documentElement.dataset.theme;
});

function renderSettings() {
  render(
    <Settings
      endpointId="ollama"
      endpointName="Ollama"
      modelId="llama3.2"
      onSelectEndpoint={vi.fn()}
      onSelectModel={vi.fn()}
    />,
  );
  return screen.getByRole("button", { name: "Settings" });
}

function openSettings() {
  const trigger = renderSettings();

  // Focused before the click, because a browser focuses a button on mousedown
  // and `fireEvent.click` dispatches only the click. Without this the reader's
  // starting point would be `<body>` in every test, which is a fact about the
  // test harness rather than about the interface.
  trigger.focus();
  fireEvent.click(trigger);

  return { trigger, dialog: screen.getByRole("dialog") };
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
});

describe("the Endpoint and Model in it", () => {
  it("is where they are configured, rather than above the Conversation", () => {
    // Nothing of either exists until the reader opens Settings, which is the
    // point of the move: the reading pane is the Conversation, and what the app
    // is pointed at is a thing to be configured rather than read.
    const trigger = renderSettings();

    expect(screen.queryByLabelText("Endpoint")).toBeNull();
    expect(screen.queryByLabelText("Model")).toBeNull();

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Endpoint")).toBeTruthy();
    expect(within(dialog).getByLabelText("Model")).toBeTruthy();
  });

  it("edits the Endpoint and Model the Conversation is held with", () => {
    const trigger = renderSettings();
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

describe("the preferences in it", () => {
  it("offers the Theme, named rather than left to the glyph", () => {
    const { dialog } = openSettings();

    // A sun or a moon beside the word "Theme" says nothing about what it
    // changes; the label beside the control says it changes the whole interface.
    expect(within(dialog).getByText("Theme")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /switch to dark theme/i })).toBeTruthy();
  });

  it("changes the Theme from inside the dialog", () => {
    const { dialog } = openSettings();

    fireEvent.click(within(dialog).getByRole("button", { name: /switch to dark theme/i }));

    // Read from the document, not from any component state — that attribute is
    // what the stylesheet reads, so it is the only thing that being "in dark
    // theme" actually means here.
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("closing Settings", () => {
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

    // Pressing anything inside — the Theme control included — must not dismiss
    // the dialog the reader is in the middle of using.
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
