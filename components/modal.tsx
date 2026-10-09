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
 * Width and height, not size. `w-full` against a `max-w-md` means the dialog
 * takes a narrow window rather than being cut off by it — this app is used in a
 * window narrow enough to sit beside a terminal often enough that "it fits
 * whatever width is left" is the layout rather than a refinement of it. The
 * scroll bounds handle the other half: a window shorter than the dialog scrolls
 * it, so the controls at its foot are still reachable instead of sitting below
 * the fold.
 */
export type ModalProps = {
  /** Names the dialog, and is read aloud when it opens. Must be on screen. */
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({ labelledBy, onClose, children }: ModalProps) {
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
        className="hm-panel hm-scroll max-h-full w-full max-w-md overflow-y-auto p-5 text-ink-2"
      >
        {children}
      </div>
    </div>
  );
}
