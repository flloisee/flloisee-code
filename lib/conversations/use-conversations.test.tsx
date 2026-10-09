// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAwaitingApproval, isToolCall, type ToolCallPart } from "@/lib/chat/tool-part";
import { listConversations, readConversation, writeConversation, type SavedConversation } from "@/lib/conversations/store";
import { backendFor, useConversations } from "@/lib/conversations/use-conversations";
import { rejectionFor } from "@/lib/testing/history";
import type { UIMessage } from "ai";

/**
 * Drives the hook against a real in-memory database, so what is asserted is what
 * would be stored — not a mock's idea of it. Only the timing is controlled, by
 * having the tests await the hook settling rather than by stubbing it out.
 */

let factory: IDBFactory;

/** The hook under test, bound to this test's in-memory database. */
function backendOf() {
  return backendFor(factory);
}

function turn(role: "user" | "assistant", text: string): UIMessage {
  return { id: `${role}-${text}`, role, parts: [{ type: "text", text }] };
}

/** A Response carrying one read and whatever the disk said about it. */
function responseWith(part: ToolCallPart): UIMessage {
  return { id: "a-1", role: "assistant", parts: [part as UIMessage["parts"][number]] };
}

/** A read that ran and came back with a whole file, as the transcript shows it. */
function completedRead(): ToolCallPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "output-available",
    input: { path: "src/notes.md" },
    output: {
      ok: true,
      path: "src/notes.md",
      startLine: 1,
      totalLines: 1,
      lines: ["1: the line the reader wants explained"],
      continuesAtLine: null,
      note: "1 line. This is the whole file.",
    },
  } as ToolCallPart;
}

/** A read of a file outside the folder the reader shared, being asked about. */
function askingRead(): ToolCallPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "approval-requested",
    input: { path: "../secrets/token.txt" },
    approval: {
      id: "aitxt-1",
      isAutomatic: false,
      requestReason: "/project/../secrets/token.txt is outside the folder you shared.",
    },
  } as ToolCallPart;
}

const OPENING = [turn("user", "Why is the build red?")];

beforeEach(() => {
  factory = new IDBFactory();
  vi.useRealTimers();
});

describe("loading the list", () => {
  it("starts not ready, so an empty list is not shown as no Conversations", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));

    // The gap between rendered and known is real, and drawing the empty state in
    // it would tell the reader their Conversations had vanished.
    expect(result.current.ready).toBe(false);
    expect(result.current.conversations).toEqual([]);

    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it("reports no Conversations when there are none", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.conversations).toEqual([]);
  });

  it("lists saved Conversations, newest first", async () => {
    await writeConversation(factory, { id: "old", title: "Old", messages: [], updatedAt: 1 });
    await writeConversation(factory, { id: "new", title: "New", messages: [], updatedAt: 2 });

    const { result } = renderHook(() => useConversations(backendOf()));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.conversations.map((c) => c.id)).toEqual(["new", "old"]);
  });
});

describe("saving Turns", () => {
  it("stores nothing for a Conversation with no Turn", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save([]);
    });

    await waitFor(() => expect(result.current.conversations).toEqual([]));
    expect(await listConversations(factory)).toEqual([]);
  });

  it("names the Conversation after the first message", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });

    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    expect(result.current.conversations[0].title).toBe("Why is the build red?");
  });

  it("keeps the name from the first message as later Turns arrive", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    act(() => {
      result.current.save([...OPENING, turn("assistant", "A lint rule."), turn("user", "And now?")]);
    });

    // Re-deriving on every change would rename the Conversation as it grew.
    await waitFor(() =>
      expect(result.current.conversations[0].title).toBe("Why is the build red?"),
    );
  });

  it("stores every Turn of the Conversation", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save([...OPENING, turn("assistant", "A lint rule.")]);
    });

    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    const [id] = result.current.conversations.map((c) => c.id);
    expect((await readConversation(factory, id))?.messages).toHaveLength(2);
  });
});

/**
 * What a Conversation that read files holds.
 *
 * The debounce saves while a Turn is still arriving, so the Turns handed to
 * `save` carry Tool Calls at every stage — named, running, asked about, and
 * answered. These tests are about which of those reach the database and in what
 * state, because a Tool Call stored without the Tool Result that answered it is
 * a record the Endpoint will refuse to carry into the next Turn.
 *
 * Everything is read back through the store and, where the point is whether the
 * history can be used, put through the same path `/api/chat` uses.
 */
describe("saving a Turn that read files", () => {
  /** Saves `messages` and answers with the Conversation they were stored under. */
  async function saved(messages: UIMessage[]): Promise<SavedConversation> {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(messages);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    const id = result.current.conversations[0].id;
    return (await readConversation(factory, id)) as SavedConversation;
  }

  it("stores the read and what came back, so reopening shows what was read", async () => {
    const stored = await saved([...OPENING, responseWith(completedRead())]);

    // The whole of the result, not the row the transcript draws: a Conversation
    // that kept the path but not the contents would reopen onto a row that
    // claims a file was read and shows nothing in it.
    expect(stored.messages[1].parts[0]).toEqual(completedRead());
  });

  it("stores a history the Endpoint will carry into the next Turn", async () => {
    const stored = await saved([...OPENING, responseWith(completedRead())]);

    expect(await rejectionFor(stored.messages)).toBeNull();
  });

  it("stores a read the disk had not answered yet as one that never came back", async () => {
    // The debounce fires 300ms after the Turns last change, and a read of a file
    // on disk takes longer than that to come back. The save that lands in the
    // gap must not leave a call in the record with nothing answering it.
    const stored = await saved([
      ...OPENING,
      responseWith({
        type: "tool-read_file",
        toolCallId: "call_1",
        state: "input-available",
        input: { path: "src/notes.md" },
      } as ToolCallPart),
    ]);

    expect(await rejectionFor(stored.messages)).toBeNull();
    expect(stored.messages[1].parts[0]).toMatchObject({ toolCallId: "call_1", state: "output-error" });
  });

  it("stores a question the reader has not answered as still a question", async () => {
    const stored = await saved([...OPENING, responseWith(askingRead())]);

    // Answering for them is the one thing the store must not do here. The
    // Conversation reopens asking, and the reader decides when they come back.
    expect(isAwaitingApproval(stored.messages[1].parts[0])).toBe(true);
  });

  it("stores a refusal the reader made as a refusal, not as an unanswered question", async () => {
    const denied = {
      ...askingRead(),
      state: "approval-responded",
      approval: { id: "aitxt-1", approved: false, reason: "not that one" },
    } as ToolCallPart;

    const stored = await saved([...OPENING, responseWith(denied)]);

    // The reader's "no" survives a reload as a no rather than reappearing as a
    // question they are being asked all over again.
    expect(stored.messages[1].parts[0]).toEqual(denied);
    expect(isAwaitingApproval(stored.messages[1].parts[0])).toBe(false);
  });

  it("names the Conversation after the reader's own words, not the file", async () => {
    const stored = await saved([
      turn("user", "what does src/notes.md say?"),
      responseWith(completedRead()),
    ]);

    // The parts of a Turn are more than text now, so the name is taken from the
    // reader's message on purpose: a name derived from a file's contents would
    // change under the reader as the Model read more of it.
    expect(stored.title).toBe("what does src/notes.md say?");
  });

  it("stores a read that was let through as let through, not as a fresh question", async () => {
    const granted = {
      ...completedRead(),
      input: { path: "/notes/todo.md" },
      approval: {
        id: "aitxt-2",
        approved: true,
        isAutomatic: true,
        reason: "/notes/todo.md is outside the folder you shared, and a Grant covers it.",
      },
    } as ToolCallPart;

    const stored = await saved([turn("user", "what is in my notes?"), responseWith(granted)]);

    // The decision travels with the read, so a file outside the folder the
    // reader shared does not come back on a later visit looking like one inside
    // it — and does not come back as an open question about a decision the reader
    // has already made.
    expect(stored.messages[1].parts[0]).toEqual(granted);
    expect(isAwaitingApproval(stored.messages[1].parts[0])).toBe(false);
  });
});

describe("reopening a Conversation that read files", () => {
  it("shows the read again, with the file that was read", async () => {
    await writeConversation(factory, {
      id: "c-read",
      title: "What does this do?",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "What does this do?" }] },
        responseWith(completedRead()),
      ],
      updatedAt: 1,
    });

    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.open("c-read");
    });

    const [part] = result.current.current.messages[1].parts;
    expect(isToolCall(part) && part.state).toBe("output-available");
    expect(part).toMatchObject({ output: { lines: ["1: the line the reader wants explained"] } });
  });

  it("shows the question again rather than answering it for them", async () => {
    await writeConversation(factory, {
      id: "c-asked",
      title: "What is in token.txt?",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "What is in token.txt?" }] },
        responseWith(askingRead()),
      ],
      updatedAt: 1,
    });

    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.open("c-asked");
    });

    expect(isAwaitingApproval(result.current.current.messages[1].parts[0])).toBe(true);
  });
});

describe("deleting a Conversation that read files", () => {
  it("takes the file's contents with it", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save([...OPENING, responseWith(completedRead())]);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    const [id] = result.current.conversations.map((c) => c.id);

    await act(async () => {
      await result.current.remove(id);
    });

    // One record holds the whole Conversation, so there is nowhere else for the
    // contents to be left — a second copy would be a file the reader deleted a
    // Conversation in order to get rid of, and could not see to delete.
    expect(await readConversation(factory, id)).toBeNull();
    expect(JSON.stringify(await listConversations(factory))).not.toContain("the line the reader");
  });
});

describe("opening a saved Conversation", () => {
  it("loads its Turns", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    let id = "";
    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    await waitFor(() => {
      id = result.current.conversations[0]?.id ?? "";
      expect(id).not.toBe("");
    });

    act(() => result.current.startNew());
    // A fresh unsaved shell rather than nothing: an empty id-stable
    // Conversation with no Turns, stored nowhere until it has one.
    expect(result.current.current.messages).toEqual([]);
    expect(result.current.current.title).toBe("");
    expect(result.current.current.id).not.toBe(id);
    expect(result.current.conversations).toHaveLength(1);

    await act(async () => {
      await result.current.open(id);
    });

    expect(result.current.current?.messages).toHaveLength(1);
  });

  it("leaves the open Conversation alone when it has since been deleted", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    // Opening something that is gone must not throw away the Turns in front of
    // the reader; the chat stays where it is.
    await act(async () => {
      await result.current.open("never-existed");
    });

    expect(result.current.current?.messages).toHaveLength(1);
  });

  it("keeps two Conversations separate", async () => {
    // Two Conversations saved back to back must keep their own Turns, or opening
    // the older one would show the newer one's.
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    let first = "";
    act(() => {
      result.current.startNew();
      result.current.save([turn("user", "First question")]);
    });
    await waitFor(() => {
      first = result.current.conversations[0]?.id ?? "";
      expect(first).not.toBe("");
    });

    act(() => result.current.startNew());
    act(() => {
      result.current.save([turn("user", "Second question"), turn("assistant", "An answer.")]);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));

    await act(async () => {
      await result.current.open(first);
    });

    expect(result.current.current?.messages).toHaveLength(1);
    expect(result.current.current?.title).toBe("First question");
  });
});

describe("renaming", () => {
  it("renames the open Conversation", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    const [id] = result.current.conversations.map((c) => c.id);
    await act(async () => {
      await result.current.rename(id, "Build triage");
    });

    expect(result.current.conversations[0].title).toBe("Build triage");
  });

  it("renames a Conversation that is not the open one", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    let first = "";
    act(() => {
      result.current.startNew();
      result.current.save([turn("user", "First question")]);
    });
    await waitFor(() => {
      first = result.current.conversations[0]?.id ?? "";
      expect(first).not.toBe("");
    });

    act(() => result.current.startNew());
    act(() => {
      result.current.save([turn("user", "Second question")]);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));

    // The list offers Rename on every row, so a rename that quietly hit
    // whichever Conversation happened to be open would be a nasty surprise.
    await act(async () => {
      await result.current.rename(first, "Renamed while closed");
    });

    expect(result.current.conversations.find((c) => c.id === first)?.title).toBe(
      "Renamed while closed",
    );
    expect(result.current.current?.title).toBe("Second question");
  });

  it("keeps the Turns of a Conversation renamed while it was closed", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    let first = "";
    act(() => {
      result.current.startNew();
      result.current.save([turn("user", "First question"), turn("assistant", "An answer.")]);
    });
    await waitFor(() => {
      first = result.current.conversations[0]?.id ?? "";
      expect(first).not.toBe("");
    });

    act(() => result.current.startNew());
    await act(async () => {
      await result.current.rename(first, "Renamed while closed");
    });

    // Writing back a record rebuilt without its Turns would empty the
    // Conversation of everything the reader had in it.
    expect((await readConversation(factory, first))?.messages).toHaveLength(2);
  });

  it("keeps the renamed name when further Turns arrive", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    const [id] = result.current.conversations.map((c) => c.id);
    await act(async () => {
      await result.current.rename(id, "Build triage");
    });

    act(() => {
      result.current.save([...OPENING, turn("assistant", "A lint rule.")]);
    });

    // A rename that the next save undoes would be worse than no rename at all.
    // Waited on the *stored* name rather than the listed one: the list is only
    // re-read once the write lands, so asserting on it can pass while the write
    // that would undo the rename is still in flight.
    await waitFor(async () =>
      expect((await readConversation(factory, id))?.title).toBe("Build triage"),
    );
    expect(result.current.conversations[0].title).toBe("Build triage");
  });

  it("refuses a blank name rather than storing an unreadable row", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));

    const [id] = result.current.conversations.map((c) => c.id);
    await act(async () => {
      await result.current.rename(id, "   ");
    });

    expect(result.current.conversations[0].title).toBe("Why is the build red?");
  });
});

describe("deleting", () => {
  it("forgets a Conversation and leaves the rest", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    const [id] = result.current.conversations.map((c) => c.id);

    await act(async () => {
      await result.current.remove(id);
    });

    expect(result.current.conversations).toEqual([]);
  });

  it("closes the open Conversation when it is the one deleted", async () => {
    const { result } = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    const [id] = result.current.conversations.map((c) => c.id);

    await act(async () => {
      await result.current.remove(id);
    });

    // Showing Turns that are stored nowhere would leave the reader sending into
    // a Conversation that vanishes on the next save. A fresh shell rather than
    // nothing, so the next Turns start a new Conversation instead.
    expect(result.current.current.messages).toEqual([]);
    expect(result.current.current.id).not.toBe(id);
    expect(result.current.conversations).toEqual([]);
  });
});

describe("deleting everything", () => {
  /** Two saved Conversations, so "all of them" is a claim worth making. */
  async function twoSaved() {
    const hook = renderHook(() => useConversations(backendOf()));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    act(() => {
      hook.result.current.startNew();
      hook.result.current.save([turn("user", "Why is the build red?")]);
    });
    await waitFor(() => expect(hook.result.current.conversations).toHaveLength(1));

    act(() => {
      hook.result.current.startNew();
      hook.result.current.save([turn("user", "What does the reader do?")]);
    });
    await waitFor(() => expect(hook.result.current.conversations).toHaveLength(2));

    return hook;
  }

  it("forgets every Conversation at once", async () => {
    const { result } = await twoSaved();

    await act(async () => {
      await result.current.removeAll();
    });

    // Read back through the store rather than off the hook's own state, because
    // the list being empty is only half the claim — the other half is that
    // nothing is left behind to come back on the next read.
    expect(await listConversations(factory)).toEqual([]);
    expect(result.current.conversations).toEqual([]);
  });

  it("closes the open Conversation, which was one of them", async () => {
    const { result } = await twoSaved();
    const open = result.current.current.id;

    await act(async () => {
      await result.current.removeAll();
    });

    // Same reason deleting one does this: the chat is keyed on this id, so a
    // fresh one is what remounts the transcript off Turns that no longer exist
    // anywhere.
    expect(result.current.current.messages).toEqual([]);
    expect(result.current.current.id).not.toBe(open);
  });

  it("does nothing at all where there is no store", async () => {
    const { result } = renderHook(() => useConversations(null));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });

    // Nothing to throw over and nothing to change: the Turns in front of the
    // reader are the only copy there has ever been, and the bargain in this
    // module is that losing persistence never costs them.
    await act(async () => {
      await result.current.removeAll();
    });

    expect(result.current.conversations).toEqual([]);
  });
});

describe("where storage is unavailable", () => {
  const failing = {
    list: () => Promise.reject(new Error("denied")),
    read: () => Promise.reject(new Error("denied")),
    write: () => Promise.reject(new Error("denied")),
    remove: () => Promise.reject(new Error("denied")),
    removeAll: () => Promise.reject(new Error("denied")),
  };

  it("still reads as ready, so the app is usable", async () => {
    const { result } = renderHook(() => useConversations(failing));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.available).toBe(false);
  });

  it("does not throw into a render when saving fails", async () => {
    const { result } = renderHook(() => useConversations(failing));
    await waitFor(() => expect(result.current.ready).toBe(true));

    // A reader who has blocked storage should get a working Conversation that
    // is simply not saved — the same bargain writeTheme makes.
    expect(() => {
      act(() => {
        result.current.startNew();
        result.current.save(OPENING);
      });
    }).not.toThrow();
  });

  it("does not throw into a render when clearing fails", async () => {
    const { result } = renderHook(() => useConversations(failing));
    await waitFor(() => expect(result.current.ready).toBe(true));

    // The same bargain as every other write here. A store that refuses to be
    // emptied leaves the list as it was and says it is unavailable; it must not
    // take the Conversation in front of the reader down with it.
    await act(async () => {
      await result.current.removeAll();
    });

    expect(result.current.available).toBe(false);
  });

  it("carries on when there is no store at all", async () => {
    const { result } = renderHook(() => useConversations(null));

    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => {
      result.current.startNew();
      result.current.save(OPENING);
    });
    expect(result.current.available).toBe(false);
  });
});
