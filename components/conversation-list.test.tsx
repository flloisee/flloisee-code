// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationList } from "@/components/conversation-list";
import type { ConversationSummary } from "@/lib/conversations/store";

afterEach(cleanup);

const SAVED: ConversationSummary[] = [
  { id: "c1", title: "Why is the build red?", updatedAt: 2 },
  { id: "c2", title: "How do I configure the…", updatedAt: 1 },
];

function renderList(over: Partial<React.ComponentProps<typeof ConversationList>> = {}) {
  const props = {
    conversations: SAVED,
    currentId: null as string | null,
    ready: true,
    available: true,
    onOpen: vi.fn(),
    onNew: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };

  render(<ConversationList {...props} />);
  return props;
}

describe("listing saved Conversations", () => {
  it("names each one", () => {
    renderList();

    expect(screen.getByText("Why is the build red?")).toBeTruthy();
    expect(screen.getByText("How do I configure the…")).toBeTruthy();
  });

  it("says so when nothing is saved yet", () => {
    renderList({ conversations: [] });

    expect(screen.getByText("Nothing saved yet.")).toBeTruthy();
  });

  it("does not claim nothing is saved before the list has loaded", () => {
    // An empty list and a list not yet read are different facts, and telling
    // the reader their Conversations are gone before reading them would be
    // both alarming and wrong.
    renderList({ conversations: [], ready: false });

    expect(screen.queryByText("Nothing saved yet.")).toBeNull();
  });

  it("says why Conversations are not being saved", () => {
    renderList({ available: false });

    expect(screen.getByText(/will not store them/)).toBeTruthy();
  });

  it("marks which Conversation the chat is showing", () => {
    renderList({ currentId: "c1" });

    const open = document.querySelector('[data-conversation="c1"]');
    const other = document.querySelector('[data-conversation="c2"]');

    expect(open?.getAttribute("data-open")).toBe("true");
    expect(other?.hasAttribute("data-open")).toBe(false);
  });
});

describe("opening", () => {
  it("opens a Conversation by name", () => {
    const props = renderList();

    fireEvent.click(screen.getByText("Why is the build red?"));

    expect(props.onOpen).toHaveBeenCalledWith("c1");
  });

  it("starts a new one", () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: "New" }));

    expect(props.onNew).toHaveBeenCalled();
  });
});

describe("renaming", () => {
  it("edits the name in place and commits it", () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: /Rename Why is the build red/ }));
    const field = screen.getByLabelText("Conversation name");
    fireEvent.change(field, { target: { value: "Build triage" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(props.onRename).toHaveBeenCalledWith("c1", "Build triage");
  });

  it("commits when the field loses focus", () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: /Rename Why is the build red/ }));
    const field = screen.getByLabelText("Conversation name");
    fireEvent.change(field, { target: { value: "Build triage" } });
    fireEvent.blur(field);

    expect(props.onRename).toHaveBeenCalledWith("c1", "Build triage");
  });

  it("trims the name it commits", () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: /Rename Why is the build red/ }));
    const field = screen.getByLabelText("Conversation name");
    fireEvent.change(field, { target: { value: "  Build triage  " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(props.onRename).toHaveBeenCalledWith("c1", "Build triage");
  });

  it("abandons the edit on Escape", async () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: /Rename Why is the build red/ }));
    const field = screen.getByLabelText("Conversation name");
    fireEvent.change(field, { target: { value: "Build triage" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(props.onRename).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByLabelText("Conversation name")).toBeNull(),
    );
  });

  it("refuses to commit an empty name", async () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: /Rename Why is the build red/ }));
    const field = screen.getByLabelText("Conversation name");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    // A blank row is a Conversation the reader can no longer identify.
    expect(props.onRename).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByLabelText("Conversation name")).toBeNull(),
    );
  });

  it("shows the field focused, so typing goes into the rename", async () => {
    renderList();

    fireEvent.click(screen.getByRole("button", { name: /Rename Why is the build red/ }));

    await waitFor(() =>
      expect(screen.getByLabelText("Conversation name")).toBe(
        document.activeElement,
      ),
    );
  });

  it("offers the whole name on hover, though it is cut to fit", () => {
    renderList();

    // A name is cut from the opening message, so the row shows a fragment;
    // the whole of it is one hover away.
    expect(screen.getByText("How do I configure the…").getAttribute("title")).toBe(
      "How do I configure the…",
    );
  });

  it("leaves the other rows alone while one is being renamed", () => {
    renderList();

    fireEvent.click(screen.getByRole("button", { name: /Rename Why is the build red/ }));

    expect(screen.getAllByLabelText("Conversation name")).toHaveLength(1);
  });
});

describe("deleting", () => {
  it("deletes a Conversation by name", () => {
    const props = renderList();

    fireEvent.click(screen.getByRole("button", { name: /Delete Why is the build red/ }));

    expect(props.onDelete).toHaveBeenCalledWith("c1");
  });

  it("offers delete on every row, not only the open one", () => {
    renderList({ currentId: "c1" });

    // A Conversation can only be opened one at a time, so a delete that only
    // appeared on the open row would make the others undeletable.
    expect(screen.getByRole("button", { name: /Delete How do I configure/ })).toBeTruthy();
  });
});

describe("how the row actions are drawn", () => {
  it("draws each one, and does not spell it out beside the name", () => {
    renderList();

    // Two actions on each of two rows. The words would cost the Name more room
    // than the drawing does, and a Saved Conversation is recognised by its Name.
    expect(document.querySelectorAll("li svg")).toHaveLength(4);
    expect(screen.queryByText("Rename")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("hides the drawing from a screen reader and names the button instead", () => {
    renderList();

    const rename = screen.getByRole("button", { name: /Rename Why is the build red/ });

    // The name says what the press does; the glyph repeating it would only make
    // a reader hear everything twice.
    expect(rename.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // And it takes its colour from the button, so it follows the Theme — and the
    // red a hovered delete turns — without a second set of values to keep in step.
    expect(document.querySelector("li svg")?.getAttribute("stroke")).toBe("currentColor");
  });

  it("offers the same words on hover, since a glyph cannot say what it is for", () => {
    renderList();

    expect(
      screen.getByRole("button", { name: /Delete Why is the build red/ }).getAttribute("title"),
    ).toBe("Delete Why is the build red?");
  });
});
