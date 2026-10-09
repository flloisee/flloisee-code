"use client";

import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  browserFactory,
  deleteConversation as deleteFromStore,
  listConversations,
  readConversation,
  writeConversation,
  type ConversationSummary,
  type SavedConversation,
} from "@/lib/conversations/store";
import { titleFrom } from "@/lib/conversations/title";
import { settledTurns } from "@/lib/conversations/turns";

/**
 * Which saved Conversations exist, and which one is open.
 *
 * The reading half of the store is asynchronous because IndexedDB is, so there
 * is a real window between "the app has rendered" and "the list is known". That
 * window is why `ready` is separate from the list being empty: an empty list and
 * a list that has not loaded yet are different facts, and drawing an empty state
 * in the first would tell the reader their Conversations are gone.
 *
 * Every failure here is swallowed on purpose. A reader who has blocked storage,
 * or who is on a browser that will not open the database, should get a working
 * Conversation that simply is not saved — the same bargain `writeTheme` makes.
 * Losing persistence must not cost the reader the Turns in front of them, so
 * nothing in this module is allowed to throw into a render.
 */

/** How a Turn's text is recovered for the purpose of naming a Conversation. */
function textOf(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

/**
 * The name for a Conversation holding `messages`, keeping `existing` if it has one.
 *
 * The existing name wins on purpose. The name is derived once, when the
 * Conversation gets its first Turn, and stored with it; deriving it again from
 * the Turns on every change would silently undo a rename the reader just made.
 */
function nameFor(existing: string | undefined, messages: UIMessage[]): string {
  if (existing) return existing;
  const first = messages.find((message) => message.role === "user");
  return titleFrom(first ? textOf(first) : "");
}

/**
 * The store operations this hook needs, so a test can supply its own.
 *
 * The factory is bound rather than passed in, because the hook has no business
 * knowing which database it is talking to: threading a factory through every
 * call site would let it be omitted, and an omitted one silently reaches the
 * real browser database rather than failing.
 */
export type ConversationBackend = {
  list: () => Promise<ConversationSummary[]>;
  read: (id: string) => Promise<SavedConversation | null>;
  write: (conversation: SavedConversation) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

/** Binds the store to a database, giving the hook a backend with no factory in it. */
export function backendFor(factory: IDBFactory): ConversationBackend {
  return {
    list: () => listConversations(factory),
    read: (id) => readConversation(factory, id),
    write: (conversation) => writeConversation(factory, conversation),
    remove: (id) => deleteFromStore(factory, id),
  };
}

function browserBackend(): ConversationBackend | null {
  const factory = browserFactory();
  return factory ? backendFor(factory) : null;
}

export type UseConversations = {
  /** Saved Conversations, newest first. Empty until `ready`. */
  conversations: ConversationSummary[];
  /**
   * The Conversation open in the chat.
   *
   * A saved one once it has been opened or written; while starting new, an
   * unsaved shell with a stable id and no Turns. The shell is what keeps the
   * first save from remounting the chat: the id is assigned when the
   * Conversation is started rather than when it is first written, so writing
   * it — including a write that lands while a Response is still streaming in —
   * changes nothing the chat is keyed on.
   */
  current: SavedConversation;
  /** False until the stored list has been read; an empty list is not the same thing. */
  ready: boolean;
  /** False where storage is unavailable, so the interface can say so. */
  available: boolean;
  /** Starts an empty Conversation, saving nothing until it has a Turn. */
  startNew: () => void;
  /** Opens a saved Conversation, loading its Turns. */
  open: (id: string) => Promise<void>;
  /** Saves the Turns currently open, naming the Conversation if it is new. */
  save: (messages: UIMessage[]) => void;
  /**
   * Renames a saved Conversation by id.
   *
   * Takes an id rather than renaming whatever is open, because the list offers
   * the control on every row.
   */
  rename: (id: string, title: string) => Promise<void>;
  /** Forgets one Conversation. */
  remove: (id: string) => Promise<void>;
};

/**
 * Holds the saved Conversations and the Turns of the open one.
 *
 * `backend` is taken as an argument rather than reached for, so the hook can be
 * exercised against an in-memory database — the same reason the store takes the
 * factory it uses instead of reading the global one itself.
 */
export function useConversations(backend?: ConversationBackend | null): UseConversations {
  const store = useBackend(backend);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // The open Conversation starts as an unsaved shell rather than nothing: its
  // id is assigned here, when the Conversation is started, so the first write
  // keeps it instead of minting one. Minting one on write is what used to
  // remount the chat underneath a Response that was still streaming in — the
  // chat is keyed on this id, so changing it mid-stream aborts the stream and
  // the reader is left with their message and no answer, and no error either.
  //
  // The shell carries an empty name on purpose: `nameFor` derives the name
  // from the opening message when the existing name is empty, so a placeholder
  // here would stick and the Conversation would keep it instead.
  const [current, setCurrent] = useState<SavedConversation>(freshShell);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(true);

  // A callback that reads the open Conversation without the reading being part
  // of the render: `save` is called from an effect on the caller's side, and a
  // ref written during render is how that stays true without the save effect
  // re-running on every rename.
  const currentRef = useRef<SavedConversation>(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const refresh = useCallback(async () => {
    // Without a store there is no list to read, but the interface is still
    // past the point of waiting on one — reporting `ready` here is what stops
    // the reader staring at a permanent loading state.
    if (!store) {
      setAvailable(false);
      setReady(true);
      return;
    }

    try {
      setConversations(await store.list());
      setAvailable(true);
    } catch {
      setAvailable(false);
    } finally {
      setReady(true);
    }
  }, [store]);

  // Reading the stored list on mount. The state updates land when the read
  // resolves rather than during the effect, which is what keeps this from
  // cascading a render on every mount.
  useEffect(() => {
    let live = true;

    void (async () => {
      if (!store) {
        if (live) {
          setAvailable(false);
          setReady(true);
        }
        return;
      }

      try {
        const found = await store.list();
        if (live) {
          setConversations(found);
          setAvailable(true);
        }
      } catch {
        if (live) setAvailable(false);
      } finally {
        if (live) setReady(true);
      }
    })();

    // A read that resolves after the reader has moved on must not set state on
    // an unmounted hook.
    return () => {
      live = false;
    };
  }, [store]);

  const startNew = useCallback(() => {
    // A fresh shell, not nothing: the chat is keyed on this id, so reusing the
    // old one would leave the previous Turns on screen, and null would mint a
    // new id on the next write — the remount that used to abort slow streams.
    currentRef.current = freshShell();
    setCurrent(currentRef.current);
  }, []);

  const open = useCallback(
    async (id: string) => {
      if (!store) return;
      try {
        const found = await store.read(id);
        // Opening a Conversation that has since been deleted leaves the chat
        // where it is rather than throwing away the Turns in front of the reader.
        if (found) setCurrent(found);
      } catch {
        setAvailable(false);
      }
    },
    [store],
  );

  const save = useCallback(
    (messages: UIMessage[]) => {
      if (!store || messages.length === 0) return;

      // An empty Conversation is not stored: it would fill the list with rows
      // that say nothing, and the reader would have to delete them by hand.
      // The id is the open Conversation's own, assigned when it was started —
      // so this write keeps it rather than minting one, and the chat stays
      // mounted even when this lands mid-stream.
      const existing = currentRef.current;
      const next: SavedConversation = {
        id: existing.id,
        title: nameFor(existing.title, messages),
        // Settled rather than verbatim, because this save is as likely to land
        // mid-read as at the end of a Turn and the Conversation has to be one the
        // next Turn can carry. See `settledTurns`.
        messages: settledTurns(messages),
        updatedAt: Date.now(),
      };

      currentRef.current = next;
      setCurrent(next);

      void (async () => {
        try {
          await store.write(next);
          await refresh();
        } catch {
          setAvailable(false);
        }
      })();
    },
    [store, refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim();
      // An empty name would leave an unreadable row, so a blank rename is
      // refused rather than stored.
      if (trimmed.length === 0) return;

      // The row being renamed is named by id rather than assumed to be the open
      // one: the list offers Rename on every row, and a rename that quietly hit
      // whichever Conversation happened to be open would be a nasty surprise.
      if (currentRef.current.id === id) {
        const next = { ...currentRef.current, title: trimmed };
        currentRef.current = next;
        setCurrent(next);
      }

      if (!store) return;

      try {
        // A row that is not open has no Turns in hand, so the stored record is
        // read to get them rather than written back as a Conversation emptied of
        // everything the reader had in it.
        const existing =
          currentRef.current.id === id ? currentRef.current : await store.read(id);
        if (!existing) return;

        await store.write({ ...existing, title: trimmed });
        await refresh();
      } catch {
        setAvailable(false);
      }
    },
    [store, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!store) return;
      try {
        await store.remove(id);
        // Closing the Conversation that was just deleted keeps the chat from
        // showing Turns that are no longer stored anywhere. A fresh shell
        // rather than nothing, for the same reason starting new is one: the
        // chat is keyed on this id.
        if (currentRef.current.id === id) {
          currentRef.current = freshShell();
          setCurrent(currentRef.current);
        }
        await refresh();
      } catch {
        setAvailable(false);
      }
    },
    [store, refresh],
  );

  return { conversations, current, ready, available, startNew, open, save, rename, remove };
}

/**
 * Resolves the backend once per mount, defaulting to the browser's own.
 *
 * The initializer form is what makes it once: a backend reached for on every
 * render would be a new object each time, and the effects that depend on it
 * would re-read the whole store on every render.
 */
function useBackend(backend?: ConversationBackend | null): ConversationBackend | null {
  const [resolved] = useState(() => (backend === undefined ? browserBackend() : backend));
  return resolved;
}

/**
 * An id for a Conversation that has never been saved.
 *
 * `crypto.randomUUID` where the browser has it. The fallback matters because
 * `useChat` derives its own id the same way and an id that threw here would take
 * the chat down over something that only has to be unique.
 */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A Conversation that has been started but not yet written.
 *
 * This is what `current` holds while starting new: a stable id with no Turns
 * and an empty name. Nothing is stored until it has a Turn to keep, and the
 * empty name is what lets the first write derive the name from the opening
 * message rather than keeping a placeholder.
 */
function freshShell(): SavedConversation {
  return { id: newId(), title: "", messages: [], updatedAt: Date.now() };
}
