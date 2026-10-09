"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { findFiles, type FileAnswer, type Offered } from "@/lib/roots/file-finder";

/**
 * Naming a file from the Root, from inside the composer.
 *
 * The menu is a popup over a textarea that never stops being a textarea, and that
 * sentence is the whole design. Focus stays in the composer for as long as the
 * menu is open, the rows are never focusable, and the one being chosen is named
 * by `aria-activedescendant` on the composer itself rather than by anything
 * holding focus. A menu that took the caret would be a menu that silently stopped
 * taking the words the reader is typing into the very message they are writing,
 * and it would make the caret — the thing they need back the moment they have
 * chosen — the one thing they could not get.
 *
 * So the keys are read where the caret already is: `chat.tsx` owns the textarea
 * and asks this module what a key means, while this module owns the list and the
 * walk behind it. A hook cannot own the caret and a component cannot hear a key
 * that is not aimed at it, so the split is where the seam is rather than where it
 * would be tidier.
 *
 * **Nothing here decides what may be read.** The Root walk answers from the Root,
 * the route admits every path through the same `mayRead` the Tools use, and this
 * renders names it was handed. A second check on this side would be a second
 * answer to keep in step with the first, and the one that drifts is the one
 * nobody remembers to check.
 */

/**
 * How long the words after an `@` are left alone before the Root is asked again.
 *
 * A walk of a large project is tens of milliseconds of disk, and typing at four
 * characters a second asks four times a second for a reader who wants one file.
 * The pause is what lets the walk be the whole answer rather than a cache with an
 * invalidation problem — the ceiling and the pause together are what the spec
 * means by covering the case that motivated an index.
 */
const FIND_DEBOUNCE_MS = 150;

/** What the menu says while it is still being asked, rather than flashing empty. */
const LOOKING = "Looking through the folder you chose…";

/**
 * Where the popup sits, and what it is made of.
 *
 * Above the composer rather than over it: a reader typing a path is looking at
 * the words they have written, and the menu is the thing they are typing *into*.
 * `bottom-[calc(100%+0.5rem)]` rather than `bottom-full` because a popup flush
 * against the row of controls reads as part of the toolbar rather than as
 * something that appeared. Placed against that row and not against the bar it
 * sits in, so it is the width of the field rather than the width of the window.
 */
const POPUP = "absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-[var(--z-dropdown)] hm-panel";

export type FileMenuState = {
  /** True while the popup is on screen, whatever it has to say. */
  open: boolean;
  /** The id of the listbox, for the composer to point `aria-controls` at. */
  listId: string;
  /** The id of the chosen row, for `aria-activedescendant`; `undefined` when there is none. */
  activeId: string | undefined;
  /** What to render above the composer, or `null` while it is closed. */
  popup: ReactNode;
  /** Whether the menu took this key, having done what it wanted with it. */
  handleKey: (key: string) => boolean;
  /** Called by the composer on every keystroke, to put a dismissed menu back. */
  typing: () => void;
};

export type FileMenuOptions = {
  /**
   * The words after the `@`, or `null` when no `@` is being typed.
   *
   * `null` rather than an empty string because the two are different states: one
   * is not mentioning anything, the other is mentioning something whose name has
   * not been finished — and the second is what opens a menu of the whole Root.
   */
  query: string | null;
  /** Called with the path the reader chose, named from the Root. */
  onPick: (path: string) => void;
};

/**
 * The menu, as a hook over the composer's own textarea.
 *
 * Everything stateful about it lives here — the answer, which row is chosen, and
 * the timer that keeps the walk from being asked on every keystroke — and the one
 * thing it is not allowed to touch is the composer's text, which it reaches only
 * through `onPick`.
 */
export function useFileMenu({ query, onPick }: FileMenuOptions): FileMenuState {
  const listId = useId();
  const [answer, setAnswer] = useState<FileAnswer | null>(null);
  const [active, setActive] = useState(0);
  /** The words the answer on screen was actually asked with. */
  const [asked, setAsked] = useState<string | null>(null);
  /**
   * Whether the reader has sent this menu away with Escape.
   *
   * A flag rather than a note of what it was dismissed for, because the composer's
   * keystrokes are what put it back and there is nothing else to key it to: a
   * mention sent away and a mention typed again are the same words, and keying on
   * the words would refuse to offer the second one. Held here and cleared by the
   * composer rather than worked out from the query, because the query is the same
   * string before and after a dismissal and only the composer knows they typed.
   */
  const [sentAway, setSentAway] = useState(false);

  const open = query !== null && !sentAway;
  const matches: Offered[] = answer?.status === "found" ? answer.matches : [];

  useEffect(() => {
    // Nothing to ask: a closed menu renders nothing, and reopening it on the same
    // words is answered from what it already knows while the walk is asked again
    // behind it.
    if (query === null) return;

    let current = true;
    const timer = setTimeout(() => {
      void findFiles(query).then((found) => {
        // An answer for words the reader has already typed past is dropped rather
        // than shown: a menu offering what was searched for forty keystrokes ago
        // is worse than no menu at all.
        if (!current) return;
        setAnswer(found);
        setAsked(query);
        // Back to the first row on every answer, because the rows themselves have
        // changed and a choice that pointed past the end of the new list is not a
        // choice.
        setActive(0);
      });
    }, FIND_DEBOUNCE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  // `undefined` whenever there is nothing to point at, rather than an id that is
  // not on the page: `aria-activedescendant` naming a row that is not rendered is
  // an announcement of a row that is not there, and a closed menu has none.
  const activeId = open && matches.length > 0 ? optionId(listId, active) : undefined;

  function move(delta: number): void {
    if (matches.length === 0) return;
    setActive((from) => (from + delta + matches.length) % matches.length);
  }

  /**
   * What a key means while the menu is open.
   *
   * Returns whether it took the key, so that a key it has no use for — Enter with
   * nothing to choose, which is a message the reader wants to send, and every key
   * once the menu is closed — reaches the composer untouched.
   */
  function handleKey(key: string): boolean {
    if (!open) return false;

    if (key === "Escape") {
      // Dismissed rather than undone. The menu never edited the composer, so there
      // is nothing to take back, and deleting what a reader typed because they
      // pressed Escape would be the menu deciding what their message says.
      setSentAway(true);
      return true;
    }

    if (key === "ArrowDown" || key === "ArrowUp") {
      move(key === "ArrowDown" ? 1 : -1);
      return true;
    }

    const chosen = matches[active];
    if (key === "Enter" && chosen !== undefined) {
      onPick(chosen.path);
      return true;
    }

    return false;
  }

  return {
    open,
    listId,
    activeId,
    handleKey,
    // Dismissal lasts until the next keystroke, the way an editor's completion is
    // dismissed until the next thing typed. Not sooner and not later: sooner would
    // make Escape useless, and later would let a menu the reader has walked away
    // from come back over the words they are still writing.
    typing: () => setSentAway(false),
    popup: open ? (
      <FileMenu
        listId={listId}
        activeId={activeId}
        answer={answer}
        asking={answer === null || asked !== query}
        matches={matches}
        onHighlight={setActive}
        onPick={onPick}
      />
    ) : null,
  };
}

/**
 * The rows, or the sentence there is instead of them.
 *
 * A menu with nothing in it is a menu that failed silently, which is the one
 * thing a reader cannot tell apart from a folder that really is empty. So every
 * state that is not a list says so in as many words — no Root chosen, nothing
 * matching, the walk cut short — and none of them is an empty box.
 */
function FileMenu({
  listId,
  activeId,
  answer,
  asking,
  matches,
  onHighlight,
  onPick,
}: {
  listId: string;
  activeId: string | undefined;
  answer: FileAnswer | null;
  /** Whether the answer on screen is for the words being typed now. */
  asking: boolean;
  matches: Offered[];
  onHighlight: (index: number) => void;
  onPick: (path: string) => void;
}) {
  const chosenRow = useRef<HTMLLIElement | null>(null);

  // Kept in view by hand, because `aria-activedescendant` moves the announcement
  // rather than the page, and a reader who has arrowed onto a row they cannot
  // see has been told about a row they cannot see. `block: "nearest"` so it
  // moves as little as the choice does. The optional call is for jsdom, which has
  // no layout and so no scrolling to do.
  useEffect(() => {
    chosenRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  if (asking) {
    return (
      <div className={POPUP}>
        <p id={listId} role="status" className="px-3 py-2 text-sm text-muted">
          {LOOKING}
        </p>
      </div>
    );
  }

  if (answer === null) return null;

  // The note is the route's own sentence in the two shapes that carry one — no
  // Root to look through, or a Root and nothing in it that matches — and the
  // client's own sentence in the third, a route that could not be reached or
  // answered in a form this file understands. None of them is an empty list.
  if (answer.status !== "found" || matches.length === 0) {
    const said = answer.status === "refused" ? answer.message : answer.note;

    return (
      <div className={POPUP}>
        <p id={listId} role="status" className="px-3 py-2 text-sm text-ink-2">
          {said}
        </p>
      </div>
    );
  }

  return (
    <div className={POPUP}>
      <ul
        id={listId}
        role="listbox"
        aria-label="Files and folders in the folder you chose"
        className="hm-scroll max-h-64 overflow-y-auto py-1"
      >
        {matches.map((offered, index) => {
          const id = optionId(listId, index);
          const chosen = id === activeId;

          return (
            <li
              key={offered.path}
              id={id}
              role="option"
              aria-selected={chosen}
              // Structural hooks rather than styling ones, on the reasoning
              // `data-turn` records: a test that reads a row's text is pinned to
              // the words it happens to be drawn with, and a test that reads a
              // class is pinned to the styling. `data-offered` is the path — the
              // thing a row is *for* — and `data-kind` is whether picking it names
              // a folder or a file.
              data-offered={offered.path}
              data-kind={offered.kind}
              ref={chosen ? chosenRow : undefined}
              // The pointer is a way in, never the only one, and choosing with it
              // still needs the composer to hold the caret — a mousedown that was
              // allowed through would blur the field, and the composer would
              // decide the menu had closed before the click ever arrived.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHighlight(index)}
              onClick={() => onPick(offered.path)}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 ${
                chosen ? "bg-paper-3 text-ink" : "text-ink-2 hover:bg-paper-2"
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{offered.path}</span>
              {/* A folder is a name the reader would otherwise have to type out in
                  full, so it belongs in the same list — and it has to be told
                  apart from a file, because picking one and picking the other
                  mean different things. */}
              {offered.kind === "directory" && (
                <span className="shrink-0 text-xs text-muted">folder</span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Said only when the list on screen is not everything there was: a note
          under a complete list has nothing to say, and a ceiling applied silently
          is a ceiling that reads as "there is nothing else". */}
      {!answer.complete && (
        <p role="status" className="border-t border-rule px-3 py-2 text-xs text-muted">
          {answer.note}
        </p>
      )}
    </div>
  );
}

/**
 * One row's id, from one place.
 *
 * The composer's `aria-activedescendant` and the row's `id` are the same string
 * written down twice, and deriving both from this is the only way they are
 * guaranteed to be the same row rather than two that have drifted.
 */
function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}