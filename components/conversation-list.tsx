"use client";

import { useEffect, useRef, useState } from "react";

import type { ConversationSummary } from "@/lib/conversations/store";
import { UNTITLED } from "@/lib/conversations/title";

/**
 * The saved Conversations, as a column of names.
 *
 * The list is the whole navigation for saved work, so it carries a New control
 * and per-row Rename and Delete rather than expecting the chat below to do it.
 *
 * Renaming is inline and commits on Enter or blur, because a name is a
 * one-line thing and a dialog for it would be more interface than the job
 * needs. Escape abandons it: a rename is only worth keeping if the reader meant
 * it, and the original name is always a better fallback than a blank row.
 */

export type ConversationListProps = {
  conversations: ConversationSummary[];
  /** The Conversation open in the chat, or null when a new one is being started. */
  currentId: string | null;
  /** False until the stored list has been read. */
  ready: boolean;
  /** False where storage is unavailable, so the reason can be shown. */
  available: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

/** When the last row was renamed, the input holding it. Focus returns here on Escape. */
type Editing = { id: string; title: string } | null;

export function ConversationList({
  conversations,
  currentId,
  ready,
  available,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: ConversationListProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  function commit() {
    if (!editing) return;
    const title = editing.title.trim();
    // An empty name would leave a row the reader cannot identify, so the edit is
    // abandoned rather than committed.
    if (title.length > 0) onRename(editing.id, title);
    setEditing(null);
  }

  function cancel() {
    setEditing(null);
  }

  return (
    <nav
      aria-label="Conversations"
      // A column of names rather than a primary control: the reading pane stays
      // the subject and this sits beside it, so it is narrow, quiet, and scrolls
      // independently of the Turns.
      className="hm-scroll flex w-full shrink-0 flex-col gap-1 overflow-y-auto border-rule
                 md:w-56 md:border-r"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Conversations
        </h2>
        <button type="button" onClick={onNew} className="hm-btn hm-btn--quiet">
          New
        </button>
      </div>

      {!available && (
        <p className="px-3 pb-2 text-xs text-muted">
          Conversations are not being saved, because this browser will not store them.
        </p>
      )}

      {ready && available && conversations.length === 0 && (
        <p className="px-3 pb-2 text-xs text-muted">Nothing saved yet.</p>
      )}

      <ul className="flex flex-col gap-0.5 px-1.5 pb-3">
        {conversations.map((conversation) => {
          const open = conversation.id === currentId;

          return (
            <li key={conversation.id}>
              <div
                // `data-conversation` marks the row, and `data-open` says which
                // one the chat below is showing — so the tests can find both
                // without reaching for the colour they are drawn in.
                data-conversation={conversation.id}
                data-open={open || undefined}
                className={
                  open
                    ? "flex items-center gap-1 rounded-panel bg-paper-3 px-2 py-1.5"
                    : "group flex items-center gap-1 rounded-panel px-2 py-1.5 hover:bg-paper-2"
                }
              >
                {editing?.id === conversation.id ? (
                  <input
                    ref={input}
                    value={editing.title}
                    aria-label="Conversation name"
                    onChange={(event) =>
                      setEditing({ id: conversation.id, title: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commit();
                      if (event.key === "Escape") cancel();
                    }}
                    onBlur={commit}
                    className="hm-field min-w-0 flex-1 px-1 py-0.5 text-sm"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen(conversation.id)}
                    // `truncate` plus `title`: a long first message is cut to a
                    // name, and the whole of it is one hover away.
                    title={conversation.title}
                    className={`min-w-0 flex-1 truncate text-left text-sm ${
                      open ? "text-ink" : "text-ink-2"
                    }`}
                  >
                    {conversation.title || UNTITLED}
                  </button>
                )}

                {editing?.id !== conversation.id && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({ id: conversation.id, title: conversation.title })
                      }
                      aria-label={`Rename ${conversation.title}`}
                      className="rounded px-1 text-xs text-muted hover:text-ink"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(conversation.id)}
                      aria-label={`Delete ${conversation.title}`}
                      className="rounded px-1 text-xs text-muted hover:text-error"
                    >
                      Delete
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
