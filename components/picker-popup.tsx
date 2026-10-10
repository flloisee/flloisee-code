"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { STROKE } from "@/components/glyph";

/**
 * The shared half of every searchable picker in this app.
 *
 * Choosing an Endpoint and choosing a Model are two different questions with two
 * different lists, but the thing that *answers* them — a search field over a list,
 * the arrows walking it without taking focus, the panel outgrowing a dialog that
 * would clip it — is one mechanism. It lives here so there is one of it.
 *
 * Written after the Endpoint picker grew the whole thing once and the Model picker
 * was about to grow it again. Every part of it is a decision somebody will be
 * tempted to re-decide in the next picker, so each is written down with its reason:
 * a second copy of the panel is a second answer to keep in step with the first,
 * and the one that drifts is the one nobody remembers to check.
 *
 * **The caret never leaves the search field**, for the reason `file-menu.tsx`
 * gives: focus stays in the one field being typed into and the row being chosen is
 * named by `aria-activedescendant` on it. The arrows walk a long list without
 * anything taking focus, and a keypress cannot reach the dialog behind — which is
 * also why Escape is stopped rather than merely handled.
 *
 * **The panel is a portal.** Settings is a dialog whose panel is `overflow: hidden`
 * over a scrolling tab body, so a popup drawn inside it is clipped by the very
 * dialog it belongs to. The panel is measured against its trigger and rendered at
 * the end of `<body>` instead, which is the only place a box is allowed to outgrow
 * the panel holding the control that opened it.
 */

/** How far the panel sits from its trigger, in pixels. The `@` menu's distance. */
const GAP = 8;

/** The narrowest the panel may be on a window with room for it. */
const DEFAULT_MIN_WIDTH_PX = 352;

/**
 * Where the panel goes, measured from the trigger that opened it.
 *
 * An edge rather than an origin because the panel opens on whichever side has
 * room, and an origin cannot express that in one pair of properties. Only the edge
 * belonging to the side it opened on is set; the other is left `undefined` so the
 * inline style carries one positioning pair rather than a zero that fights the real
 * one.
 */
type Seat = {
  left: number;
  width: number;
  /** The narrowest this window can hold, which the panel is also given. */
  floor: number;
  /** How tall it may be before it would run off the side it opened on. */
  maxHeight: number;
  top?: number;
  bottom?: number;
};

/**
 * What a picker needs back from this, and what its panel is rendered with.
 *
 * **Every value here is safe to read during a render, and that is the whole
 * reason refs are not.** An object holding both a ref and an answer is one where
 * `popup.shown` and `popup.searchRef` cannot be told apart to a reader — or to
 * `react-hooks/refs`, which rightly refuses to let a render read an object that
 * carries a ref, on the grounds that doing so is how a component stops updating
 * when it should. So the refs are returned beside this rather than inside it, and
 * a caller that wants one destructures the other.
 */
export type Popup<T> = {
  open: boolean;
  /** Opens the panel with an empty search — nobody asked for the last one twice. */
  show: () => void;
  /**
   * Focus comes back to the trigger, because the panel took focus when it opened
   * and a reader who has just chosen should be able to carry straight on rather
   * than starting again from the top of the dialog.
   *
   * `takeFocus` is false when the reader is dismissing by tabbing or by pressing
   * outside, where taking it back would yank them off whatever they moved to.
   */
  hide: (takeFocus: boolean) => void;
  toggle: () => void;
  /** What the reader has typed, and how to change it. */
  query: string;
  setQuery: (value: string) => void;
  /** The items left after the search, which is what the panel draws. */
  shown: T[];
  /** The row the arrows have reached, for `aria-activedescendant`. */
  activeId: string | undefined;
  /** The item under the walk, which is what Enter takes. */
  active: T | undefined;
  /** Moves the walk, wrapping at both ends so the list cannot be fallen off. */
  move: (delta: number) => void;
  /** Puts the walk on a given row — what hovering one with a pointer does. */
  goTo: (index: number) => void;
  /** `id` for the listbox, and the prefix every row's own id is built from. */
  listId: string;
  /** Renders `node` into the panel's place, or `null` while it is closed. */
  layer: (node: ReactNode) => ReactNode;
};

/**
 * The elements the panel has to be attached to.
 *
 * Held apart from {@link Popup} for the reason that type gives: these are handed
 * to `ref={}` and to effects, never read during a render.
 */
export type PopupRefs = {
  /** The control that opens the panel, and the one focus comes back to. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  /** The panel itself, for telling a press outside from one inside. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** The row the walk is on, kept in view as it moves. */
  activeRowRef: React.RefObject<HTMLLIElement | null>;
  /** The search field, which takes the caret when the panel opens. */
  searchRef: React.RefObject<HTMLInputElement | null>;
};

export type PopupOptions<T> = {
  /** Everything there is to choose from, unfiltered. */
  items: readonly T[];
  /**
   * What a search means for one item. Taken as a predicate rather than as a
   * pre-filtered list because the list depends on the search, and the search is
   * this module's — a caller cannot compute a filtered list without already
   * having this hook, and calling a hook after its own value is used is not a thing
   * React allows. So the search runs here and `shown` comes back out.
   */
  matches: (item: T, query: string) => boolean;
  /** How narrow the panel may be. One picker has three columns; the other has one. */
  minWidthPx?: number;
};

/**
 * The hook behind a searchable picker.
 *
 * Everything stateful about the panel lives here and nothing about what is in it
 * does: this owns the answer to *how the reader moves through it*, and the caller
 * owns *what there is to move through*.
 */
export function usePickerPopup<T>({
  items,
  matches,
  minWidthPx = DEFAULT_MIN_WIDTH_PX,
}: PopupOptions<T>): [Popup<T>, PopupRefs] {
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * The row the arrows have reached, held against the search it was reached for.
   *
   * **A new search is a new question.** Held as a bare index, the walk would point
   * past the end of a shorter answer — or, worse, at a different row than the one
   * it named a moment ago. So the index is only believed while the search is the
   * one it was set under: the same comparison rather than the reset in an effect
   * that `named-files.tsx` makes, because a reset would be a second render existing
   * only to forget something.
   */
  const [walked, setWalked] = useState({ query: "", index: 0 });
  const [seat, setSeat] = useState<Seat | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLLIElement | null>(null);

  /**
   * What the search left.
   *
   * Trimmed and lower-cased once here rather than in each caller's predicate, so
   * "the same search" means the same thing in the filter and in the walk — the
   * walk keys off the raw `query`, and a reader who typed a trailing space is
   * still asking the same question as one who did not.
   */
  const wanted = query.trim().toLowerCase();
  const shown = useMemo(
    () => (wanted === "" ? [...items] : items.filter((item) => matches(item, wanted))),
    // `matches` is written inline at each call site, so it is a new function every
    // render; joining on the search it reads rather than on its identity keeps the
    // filter from re-running 187 times for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, wanted],
  );

  const index = useMemo(
    () => Math.min(walked.query === query ? walked.index : 0, Math.max(shown.length - 1, 0)),
    [walked, query, shown.length],
  );

  const activeId = open && shown.length > 0 ? `${listId}-option-${index}` : undefined;
  const active = shown[index];

  const show = useCallback(() => {
    setOpen(true);
    setQuery("");
    setWalked({ query: "", index: 0 });
  }, []);

  const hide = useCallback((takeFocus: boolean) => {
    setOpen(false);
    if (takeFocus) triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (open) hide(true);
    else show();
  }, [open, hide, show]);

  const goTo = useCallback((to: number) => setWalked({ query, index: to }), [query]);

  const move = useCallback(
    (delta: number) => {
      if (shown.length === 0) return;
      setWalked((from) => {
        const was = from.query === query ? from.index : 0;
        return { query, index: (was + delta + shown.length) % shown.length };
      });
    },
    [query, shown.length],
  );

  const placed = seat !== null;

  /**
   * The caret in the search field, from the first frame there is a field to put it
   * in — which is not the first frame the panel is asked for, because the seat is
   * measured in an effect and the panel arrives with it.
   */
  useEffect(() => {
    if (open && placed) searchRef.current?.focus();
  }, [open, placed]);

  /**
   * Where the panel goes, and how tall it may be.
   *
   * Measured rather than placed with `bottom-full` because the panel is not in the
   * trigger's box to begin with: a portal has to be told, and the trigger moves
   * with the tab strip, the dialog and the window. Re-measured on scroll as well as
   * on resize — with capture, so a scroll of the tab body the picker sits in counts
   * too, which is the one that actually happens.
   *
   * The side is whichever has more room. A panel that always opened downwards would
   * hang off the bottom of a short window, and a reader who has scrolled the dialog
   * down to the picker is exactly that reader.
   */
  useEffect(() => {
    if (!open) return;

    function place() {
      const box = triggerRef.current?.getBoundingClientRect();
      if (box === null || box === undefined) return;

      // The narrowest this window can hold, which is the floor below on anything
      // with room for it and the window itself on anything narrower. Stated here
      // rather than left to `min-width` alone, because a floor the window cannot
      // meet is a panel hanging off the right-hand edge.
      const floor = Math.min(minWidthPx, window.innerWidth - GAP * 2);
      const downwards = window.innerHeight - box.bottom >= box.top;

      setSeat({
        // The width and the left edge are pinned to the trigger's, so the panel
        // reads as that control having opened rather than as something that arrived
        // from elsewhere. The left is slid rather than the right being clipped: past
        // that point the whole panel moves in instead of losing the column a reader
        // came to read.
        left: Math.max(GAP, Math.min(box.left, window.innerWidth - floor - GAP)),
        width: Math.max(box.width, floor),
        floor,
        // Only the edge belonging to the side it opened on is set — an origin and
        // an offset fight each other, and whichever lost would decide the panel's
        // position on its own.
        ...(downwards
          ? { top: box.bottom + GAP, maxHeight: window.innerHeight - box.bottom - GAP }
          : { bottom: window.innerHeight - box.top + GAP, maxHeight: box.top - GAP }),
      });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, minWidthPx]);

  /**
   * A press outside the panel and outside the trigger sends it away.
   *
   * On `pointerdown` rather than `click`, so the panel has gone by the time the
   * press lands on whatever was behind it. A press that both dismissed the panel
   * and activated the control underneath would be one gesture doing two things, and
   * the reader would have chosen something they did not mean to.
   */
  useEffect(() => {
    if (!open) return;

    function away(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target) === true) return;
      if (triggerRef.current?.contains(target) === true) return;
      hide(false);
    }

    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, hide]);

  /**
   * Kept in view by hand, for the reason `file-menu.tsx` gives: moving
   * `aria-activedescendant` moves the announcement rather than the page, and a
   * reader who has arrowed onto a row they cannot see has been told about a row
   * they cannot see. `block: "nearest"` so it moves as little as the choice does.
   * The optional call is for jsdom, which has no layout and so no scrolling to do.
   */
  useEffect(() => {
    if (!open) return;
    activeRowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeId]);

  const layer = useCallback(
    (node: ReactNode) =>
      open && seat !== null
        ? createPortal(
            <div
              ref={panelRef}
              style={{
                left: seat.left,
                top: seat.top,
                bottom: seat.bottom,
                width: seat.width,
                // The same figure the clamp above worked from, so the panel is
                // exactly as wide as that arithmetic promised on a narrow window
                // rather than snapping back to the floor and running off the edge.
                minWidth: seat.floor,
                maxHeight: seat.maxHeight,
              }}
              className="fixed z-[var(--z-popover)] flex flex-col overflow-hidden hm-panel"
            >
              {node}
            </div>,
            document.body,
          )
        : null,
    [open, seat],
  );

  const refs: PopupRefs = useMemo(
    () => ({ triggerRef, panelRef, activeRowRef, searchRef }),
    [],
  );

  return [
    {
      open,
      show,
      hide,
      toggle,
      query,
      setQuery,
      shown,
      activeId,
      active,
      move,
      goTo,
      listId,
      layer,
    },
    refs,
  ];
}

/** One row's id, from one place — the field's `aria-activedescendant` and the row's own. */
export function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/**
 * The key handling every search field in this app shares.
 *
 * **Escape stops the event as well as handling it**, and that is the whole reason
 * it lives here rather than in each picker. Settings binds Escape on the document,
 * so a reader dismissing a list of names would otherwise lose the whole dialog to
 * their first Escape — and the one picker that got this right would have been the
 * one to look wrong beside it.
 *
 * **Tab is not prevented and not stopped.** The panel holds nothing focusable after
 * the field, so this is the Tab out of it, and leaving it open behind the reader
 * would be a list sitting on top of whatever they moved to.
 *
 * `choose` is called only when there is a row under the walk. An Enter with nothing
 * there stays the Enter of whatever the reader was doing.
 */
export function searchKeys<T>(popup: Popup<T>, choose: () => void) {
  return (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      popup.move(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      popup.move(-1);
      return;
    }

    if (event.key === "Enter") {
      if (popup.active === undefined) return;
      event.preventDefault();
      choose();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      popup.hide(true);
      return;
    }

    if (event.key === "Tab") popup.hide(false);
  };
}

/**
 * A caret pointing the way a closed box does, beside what a control is holding.
 *
 * Drawn from `STROKE` rather than spelled out here, so it is the same size and
 * weight as the sun in the Theme toggle and the cog in the Settings button rather
 * than one hand per file.
 */
export function Chevron() {
  return (
    <svg {...STROKE} className="shrink-0 text-muted">
      <path d="M4 6.25 8 10.25 12 6.25" />
    </svg>
  );
}

/** The mark beside the row that is in use. Drawn, not spelled out: the row beside it says which. */
export function Tick() {
  return (
    <svg {...STROKE}>
      <path d="M2.75 8.5 6 11.75 13.25 4.25" />
    </svg>
  );
}