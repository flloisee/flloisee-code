"use client";

import { useState, type ReactNode } from "react";

import { Confirm } from "@/components/confirm";
import { EndpointPicker } from "@/components/endpoint-picker";
import { Modal } from "@/components/modal";
import { ModelPicker } from "@/components/model-picker";
import { RootPicker } from "@/components/root-picker";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Settings: the app's own configuration, behind one button at the foot of the
 * Conversations column.
 *
 * A dialog rather than an inline disclosure because what it holds is not
 * navigation and not part of any Conversation — it is how the app is set up, and
 * it reads as a separate thing from the list it was opened beside. The scrim says
 * "you are looking at something else now" in a way an expanded row cannot, which
 * matters as soon as there is more than one thing in here to step past.
 *
 * The Endpoint and Model live here rather than above the Conversation because
 * they are set-up rather than content: they are chosen rarely, and the reader
 * wants a reading pane rather than a control panel. What they are is said in the
 * empty state and in every Request the app makes, so nothing about which
 * Endpoint is in use is hidden by where the control for it lives.
 *
 * It is mounted only while open, so nothing it holds survives being closed — the
 * Registry and Discovery are read again each time it is opened, which is the
 * point: a Model loaded a moment ago, and a Credential stored a moment ago, are
 * both things this way show without a reload.
 *
 * The Reading Root is here too, and nowhere else. It is a property of the
 * machine rather than of the app's configuration — it names a folder on this
 * developer's disk — so it does not belong beside the Conversation, and putting
 * it above the reader's messages would make a capability that reads their files
 * look like part of the chat.
 *
 * Deleting every Conversation is here for the same reason the list's per-row
 * Delete is not enough: the rows carry their own control, but there is no
 * "forget the lot" among them, and a reader clearing out work they have finished
 * with should not have to press Delete once per row to say so. It is at the foot
 * rather than beside the New, because a control that destroys everything is not
 * a navigation, and one keystroke from the control that creates things it is
 * exactly the wrong place for it.
 */

/** What the dialog edits, passed in from the one place that holds it. */
export type SettingsProps = {
  /** The Endpoint in use, which is the one the list shows selected. */
  endpointId: string;
  /** How the Endpoint is named in messages, so discovery reads as this Endpoint. */
  endpointName: string;
  /** The Model in use, whether picked, typed, or declared by default. */
  modelId: string;
  /** Called with the id of the Endpoint chosen. */
  onSelectEndpoint: (endpointId: string) => void;
  /** Called with the Model chosen in the current Endpoint. */
  onSelectModel: (modelId: string) => void;
  /** How many Conversations are saved, so the row below can say what it would cost. */
  savedCount: number;
  /** Called once the reader has confirmed, and not before. */
  onDeleteAllChats: () => void;
};

/** The button, and the dialog it opens. */
export function Settings({
  endpointId,
  endpointName,
  modelId,
  onSelectEndpoint,
  onSelectModel,
  savedCount,
  onDeleteAllChats,
}: SettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // The same quiet button as the New above it, sized to its own label rather
        // than stretched: a word centred across the whole column would read as
        // the column's title rather than as one control in it.
        className="hm-btn hm-btn--quiet"
      >
        Settings
      </button>

      {open && (
        <SettingsDialog
          endpointId={endpointId}
          endpointName={endpointName}
          modelId={modelId}
          onSelectEndpoint={onSelectEndpoint}
          onSelectModel={onSelectModel}
          savedCount={savedCount}
          onDeleteAllChats={onDeleteAllChats}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The dialog itself, split out so that closing it unmounts it.
 *
 * The heading is in the display face, the same as the Credential dialog's and for
 * the same reason: a dialog that opens with no heading of its own reads as a
 * panel of controls that happened to appear, rather than as a place the reader
 * chose to go.
 *
 * Endpoint and Model come before the Theme because they are the part of this
 * dialog a reader is here for: the Theme is a preference they set once, while
 * these decide what a Conversation is even held with.
 */
function SettingsDialog({
  endpointId,
  endpointName,
  modelId,
  onSelectEndpoint,
  onSelectModel,
  savedCount,
  onDeleteAllChats,
  onClose,
}: SettingsProps & { onClose: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The confirmation *replaces* this dialog rather than opening on top of it.
  // Two `Modal`s at once would stack two scrims and bind Escape twice — so one
  // Escape would dismiss both, taking the confirmation away at the moment it was
  // the only thing standing between the reader and the delete. Swapping keeps
  // exactly one dialog on screen at a time, which is also what a reader expects:
  // a question on top of the settings would be a question about a page that is
  // no longer there.
  if (confirming) {
    return (
      <Confirm
        title="Delete every Conversation?"
        body={whatDeletingCosts(savedCount)}
        confirmLabel="Delete all"
        busy={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          if (deleting) return;
          setDeleting(true);
          // Not awaited into an error the reader would have to read: `removeAll`
          // already swallows a failure and says so through the list, and a throw
          // here would leave the button stuck on "Deleting..." forever.
          onDeleteAllChats();
          setDeleting(false);
          setConfirming(false);
        }}
      />
    );
  }

  return (
    <Modal labelledBy="settings-heading" onClose={onClose}>
      <h2 id="settings-heading" className="font-display text-md font-semibold text-ink">
        Settings
      </h2>

      <div className="mt-4 flex flex-col gap-4">
        <EndpointPicker endpointId={endpointId} onSelect={onSelectEndpoint} />

        <ModelPicker
          endpointId={endpointId}
          endpointName={endpointName}
          modelId={modelId}
          onSelect={onSelectModel}
        />

        {/* The Reading Root, below the Model rather than beside the Endpoint:
            it is not which backend the app talks to but what that backend is
            allowed to see, and it is per-machine rather than per-Endpoint. Its
            absence is stated rather than shown as an empty control, since a
            reader who cannot tell a Root of none from a Root that failed to load
            has no way to know whether the Model can read anything. */}
        <div className="mt-5 border-t border-rule pt-4">
          <RootPicker />
        </div>
      </div>

      {/* The Theme, and the one preference here that is not configuration. Labelled
          rather than left to the glyph, because a sun or a moon beside the word
          Theme says nothing about what it changes. */}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-rule pt-4">
        <span className="text-sm text-ink-2">Theme</span>
        <ThemeToggle />
      </div>

      {/* Below the Theme and last in the dialog, behind a rule of its own. Every
          control above it changes what the app does next; this one throws away
          what has already been done, and the reader should have to scroll past
          four things that are not that to reach it. */}
      <div className="mt-5 flex items-start justify-between gap-3 border-t border-rule pt-4">
        <div className="min-w-0">
          <span className="text-sm text-ink-2">Saved Conversations</span>
          {/* What is at stake, said where the decision is made rather than only in
              the confirmation: a reader who can see there are forty of them may
              not want this at all, and a reader who can see there are none
              should not be offered the button at all. */}
          <p className="mt-0.5 text-xs text-muted">{whatIsSaved(savedCount)}</p>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          // Disabled rather than hidden when there is nothing stored. A control
          // that appeared and vanished with the list would move the dialog's
          // layout around underneath the reader; a button that is simply not
          // available says there is nothing here to delete, which is the fact.
          disabled={savedCount === 0}
          className="hm-btn shrink-0 text-error"
        >
          Delete all
        </button>
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="hm-btn">
          Close
        </button>
      </div>
    </Modal>
  );
}

/**
 * How many Conversations are saved, said the way a reader counts them.
 *
 * "None saved" rather than "0 Conversations": a row in the interface that reads
 * as a number where a number is not what the reader is thinking about is a row
 * they have to translate before they can decide anything.
 */
function whatIsSaved(count: number): string {
  if (count === 0) return "None saved.";
  return count === 1 ? "1 saved." : `${count} saved.`;
}

/**
 * What confirming actually costs, in the order a reader needs to hear it.
 *
 * The count is repeated from the row behind rather than dropped, because the
 * reader has been looking at a question, not at the settings, and the number
 * they are agreeing to lose is the thing that decides it. Then the two facts
 * that make it a decision rather than a formality: the Turns go too, and there
 * is no way back.
 */
function whatDeletingCosts(count: number): ReactNode {
  return (
    <>
      <p>
        {count === 1
          ? "This deletes the one saved Conversation"
          : `This deletes all ${count} saved Conversations`}{" "}
        and every Turn in them. Nothing is kept anywhere else, and there is no way
        to get them back.
      </p>
      <p className="mt-2">
        The Conversation you are reading now will be closed to an empty one. Your
        Endpoint, Model, and Reading Root are not touched.
      </p>
    </>
  );
}