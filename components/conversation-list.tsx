"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
 *
 * Settings live at the foot of this column rather than in the header above it,
 * because everything they change is app chrome rather than any part of a
 * Conversation, and a sidebar that ends in the control for the app's own
 * preferences keeps them out of the way of the reading pane. The list scrolls,
 * this footer does not: a Settings control that scrolled away with a long list
 * of Conversations would be a control the reader had to go looking for.
 *
 * What the footer holds is passed in rather than rendered here, because it needs
 * state this component does not have: the Settings dialog edits the Endpoint and
 * Model the Conversation is using, and those are held above the chat. This
 * component still owns where the footer sits — inside the column, below the
 * scrolling list, inside the border that closes the nav.
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
  /** Pinned below the list, outside its scroll: usually the Settings control. */
  footer?: ReactNode;
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
  footer,
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
      // The list scrolls, the footer does not — so it is `overflow-hidden` here
      // and the scrolling moves to the middle section below, which is the only
      // part that grows with the number of Conversations.
      className="flex w-full shrink-0 flex-col border-rule md:w-56 md:border-r"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Conversations
        </h2>
        <button type="button" onClick={onNew} className="hm-btn hm-btn--quiet">
          New
        </button>
      </div>

      <div className="hm-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
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
      </div>

      {/* Pinned to the foot of the column: Settings is not one of the
          Conversations, so it stays put while the list above it scrolls. */}
      {footer && <div className="border-t border-rule px-1.5 py-2">{footer}</div>}
    </nav>
  );
}
