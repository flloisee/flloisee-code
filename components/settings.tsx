"use client";

import { useState } from "react";

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
};

/** The button, and the dialog it opens. */
export function Settings({
  endpointId,
  endpointName,
  modelId,
  onSelectEndpoint,
  onSelectModel,
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
  onClose,
}: SettingsProps & { onClose: () => void }) {
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

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="hm-btn">
          Close
        </button>
      </div>
    </Modal>
  );
}