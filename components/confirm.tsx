"use client";

import { useId, type ReactNode } from "react";

import { Modal } from "@/components/modal";

/**
 * Asking whether the reader means it, before doing something that cannot be
 * undone.
 *
 * This is a dialog rather than `window.confirm` because the browser's version
 * cannot say what is about to happen. It offers "OK" and "Cancel" and nothing
 * else, so a reader who has just pressed a button labelled Delete all is asked
 * to decide with the one piece of information that would let them decide — what
 * they are about to lose — missing. It also cannot be styled, and it is not
 * focus-managed, so on a narrow window it arrives as a box the app has no say
 * in. Both matter less for "are you sure" than they do here, where the answer
 * is about work the reader did themselves and cannot get back.
 *
 * It is a component because two things about it are worth writing once. The
 * shell — scrim, panel, focus, Escape — is `Modal`'s, so this cannot drift away
 * from the Settings dialog it opens out of. And the layout below is fixed: the
 * button that goes ahead is never the one focus lands on, and never the first
 * thing Tab reaches. `Modal` focuses the panel rather than a control for
 * exactly the reason this dialog cannot afford to break it — a confirm button
 * is the last thing in the app that should be one Enter away.
 */

export type ConfirmProps = {
  /** What is being confirmed, said as a question and used as the heading. */
  title: string;
  /**
   * What happens if the reader goes ahead, in their terms.
   *
   * A `ReactNode` rather than a string because this is the one place the app
   * has to be specific: how many are lost, and that there is no way back, are
   * both things a reader deciding can act on and a bare "Are you sure?" denies
   * them.
   */
  body: ReactNode;
  /**
   * The button that goes ahead, named for what it does.
   *
   * Not "OK" and not "Yes": the label is read at the moment of the decision, and
   * it should answer the same question the heading asked rather than ask a new
   * one.
   */
  confirmLabel: string;
  /** True while the action is running, so it cannot be set going twice. */
  busy?: boolean;
  onConfirm: () => void;
  /** Escape, the scrim, and Cancel all land here: nothing has happened yet. */
  onCancel: () => void;
};

export function Confirm({
  title,
  body,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  // Generated rather than passed in, because a dialog that is reusable is a
  // dialog whose id can collide — two Confirms sharing one id would leave both
  // announced under whichever heading came last.
  const headingId = useId();

  return (
    <Modal labelledBy={headingId} onClose={onCancel}>
      {/* The display face, as in every other dialog: this is a place the reader
          has chosen to go, not a control that happened to appear. */}
      <h2 id={headingId} className="font-display text-md font-semibold text-ink">
        {title}
      </h2>

      <div className="mt-3 text-sm text-ink-2">{body}</div>

      {/* Cancel first, and focus on neither. The order is the real safeguard:
          a reader who tabs into this dialog has not read the heading yet, and
          should meet the way out before the way through. Escape and the scrim
          cancel too, which is `Modal`'s, so there is always a way back that is
          not the button they did not mean to press. */}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="hm-btn">
          Cancel
        </button>
        {/* Red rather than the accent fill. The accent is the one signal in
            this interface — the primary button, the focus ring, link hover, and
            nothing else — and making a destructive button a second thing that
            shouts is how a dialog stops being the last moment of hesitation.
            The word on the button carries the weight instead. */}
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="hm-btn text-error"
        >
          {busy ? "Deleting..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}