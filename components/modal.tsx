"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The shell every dialog in the app sits in: a scrim, a panel, and the three
 * things a modal owes the reader who opens one.
 *
 * It is a component rather than a class because the behaviour is not
 * decorative. A dialog that does not take focus on open leaves the reader
 * typing into the page behind it; one that does not give focus back leaves it
 * starting again from the top of the document; one that ignores Escape cannot
 * be closed without hunting for the button. Those are properties of the shell,
 * so they are written once here rather than in each dialog that needs them.
 *
 * Width and height, not size. `w-full` against a `max-w-*` means the dialog
 * takes a narrow window rather than being cut off by it — this app is used in a
 * window narrow enough to sit beside a terminal often enough that "it fits
 * whatever width is left" is the layout rather than a refinement of it. The
 * scroll bounds handle the other half: a window shorter than the dialog scrolls
 * it, so the controls at its foot are still reachable instead of sitting below
 * the fold.
 *
 * The ceiling is the caller's, because a question and a table of Models want
 * different amounts of it. What this owns is that both are `w-full` first, so
 * the wider one is still only ever as wide as the window allows.
 */
export type ModalProps = {
  /** Names the dialog, and is read aloud when it opens. Must be on screen. */
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * How much room the panel takes, for the dialogs whose content needs it.
   *
   * Narrow is the default and the right width for a question or a single form:
   * a confirmation stretched across half a window is a bigger target than the
   * decision it is asking about, and the space around it reads as emphasis.
   * Wide is for a dialog holding a table of things — rows of figures beside
   * names, where the name is the thing being truncated.
   *
   * Never a fixed pixel width: the window is what it is, and `w-full` below
   * still means the dialog takes a narrow window rather than being cut off.
   */
  width?: "narrow" | "wide";
  /**
   * Whether the panel is as tall as what is in it, or the same height whatever is.
   *
   * Fit is right for a dialog holding one thing — a question, a short form. Its
   * height is its content's, and the space around it is part of the answer.
   *
   * Steady is for a dialog holding panels of different heights behind tabs, where
   * fit means the panel's top edge sits wherever the content in front of it ends.
   * The heading and the tab strip then travel up and down the screen as the reader
   * moves between a two-field panel and a table of Models, and the strip is the
   * control they have just pressed — watching it jump reads as the dialog losing
   * its place. A steady panel is a fixed box instead: the same top edge whatever
   * is behind the tabs, and whatever is too tall for it scrolls inside rather than
   * pushing the top edge back out of place.
   *
   * Steady means the panel is a flex column, so a caller using it says which of
   * its children hold still and which one takes the rest. A child left to size
   * itself in a box of a fixed height will simply overflow it.
   */
  height?: "fit" | "steady";
};

/** The ceiling for each width, kept in one place so the two cannot be confused. */
const WIDTHS = { narrow: "max-w-md", wide: "max-w-2xl" } as const;

/**
 * How each height behaves.
 *
 * The steady figure is measured, not chosen for roundness: at 1440×900 the
 * tallest of Settings' five panels is Model Fit at 595px, which is its ceiling
 * rather than today's answer — `RECOMMENDATION_LIMIT` is 8 and the list never
 * grows past it. Thirty-eight rems is that figure with a little room for a
 * machine description or a status line wrapping. A panel that still outgrows it —
 * Key Entry under a Cloud Endpoint, or the same dialog on a short window — scrolls
 * inside, which is why the `min()`: the box shrinks to the window rather than
 * pushing its own top edge off the top of the screen.
 */
const HEIGHTS = {
  fit: "hm-scroll max-h-full overflow-y-auto",
  steady: "flex h-[min(38rem,100%)] flex-col overflow-hidden",
} as const;

export function Modal({
  labelledBy,
  onClose,
  children,
  width = "narrow",
  height = "fit",
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  // Focus in on open, and out on close. Both are captured from the live element
  // rather than tracked in state, because the thing to return to is whatever the
  // reader was on when the dialog opened — which is not always the button that
  // opened it, and never needs to be remembered separately to be correct.
  useEffect(() => {
    const openedFrom = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    return () => openedFrom?.focus();
  }, []);

  useEffect(() => {
    // Escape, on the document rather than the panel: focus is on the panel
    // itself until the reader tabs into it, so a handler bound to the panel
    // would fire for some of the dialog's life and not the rest of it.
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  return (
    <div
      // The scrim is a click target for dismissal and nothing else, so it is a
      // div with a handler rather than a button: a keyboard reader tabbing
      // through the page must not meet a full-screen "dismiss" control in front
      // of the dialog's own.
      onClick={onClose}
      // Centred at every width, which a steady panel can afford and a fitted one
      // cannot: a box of a fixed height centred has one top edge whatever is in
      // it, while a box that grows with its content has a different one per tab.
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-scrim p-4 sm:items-center"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        // `tabIndex` so the panel can hold focus at all — a div is not focusable
        // by default, and without this the focus call above is a no-op.
        tabIndex={-1}
        // A click inside the dialog is not a click on the scrim, and letting it
        // through would close the dialog the moment the reader pressed anything.
        onClick={(event) => event.stopPropagation()}
        className={`hm-panel w-full ${WIDTHS[width]} ${HEIGHTS[height]} p-5 text-ink-2`}
      >
        {children}
      </div>
    </div>
  );
}
