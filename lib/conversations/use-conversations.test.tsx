// @vitest-environment jsdom

import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listConversations, readConversation, writeConversation } from "@/lib/conversations/store";
import { backendFor, useConversations } from "@/lib/conversations/use-conversations";
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

describe("where storage is unavailable", () => {
  const failing = {
    list: () => Promise.reject(new Error("denied")),
    read: () => Promise.reject(new Error("denied")),
    write: () => Promise.reject(new Error("denied")),
    remove: () => Promise.reject(new Error("denied")),
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
