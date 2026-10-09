"use client";

import { useState, type ReactNode } from "react";

import { Confirm } from "@/components/confirm";
import { EndpointPicker } from "@/components/endpoint-picker";
import { STROKE } from "@/components/glyph";
import { HardwareSection } from "@/components/hardware-section";
import { Modal } from "@/components/modal";
import { ModelPicker } from "@/components/model-picker";
import { RootPicker } from "@/components/root-picker";
import { Tabs, type TabSpec } from "@/components/tabs";
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
 * **What it holds is behind tabs**, which is a change from the column it was.
 * The reasoning that put each control at a particular height in that column is
 * real — the Reading Root is per-machine, the Theme is a preference set once,
 * deleting everything belongs last — but it is reasoning about *order*, and order
 * was never the thing a reader came for. Six controls in a column means
 * scrolling past five to reach the sixth, and it turns their relative heights
 * into a promise: that something below matters less than something above it.
 * Tabs drop that promise. Each of those things is offered in one line at the
 * same weight, and the one the reader came for is one press away.
 *
 * What the tabs are NOT is a way of separating the Endpoint from the Model.
 * Those two stay on one tab because one is a consequence of the other: choosing
 * an Endpoint is what decides which Models are on offer, so splitting them would
 * mean making a choice and then hunting elsewhere to see what it had produced.
 * They are a single decision wearing two controls.
 *
 * Tabs also mean a tab nobody opens has never mounted, and so has never asked
 * the app's server — or, on the Model Fit tab, Hugging Face — anything. That is
 * what lets the Theme be a tab rather than something scrolled to: choosing it
 * costs no request at all.
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
 * with should not have to press Delete once per row to say so. It sits behind the
 * tab named for it rather than at the foot of a column, because a control that
 * destroys everything should not be one keystroke from the control that creates
 * things — and because a reader who opens that tab is one whose question it
 * already answers.
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

/**
 * A cog, for the button below.
 *
 * Six teeth at 60° pitch, each tip 13° half-angle against a 19° root, which
 * leaves a 3.13-unit tip and a 3.56-unit gap at the root — near enough even that
 * neither closes up when the glyph is 14px on screen. That is the whole
 * constraint: eight teeth is the usual count and is unreadable at this size, the
 * gaps fill in and the drawing comes out a blob; six is the count at which the
 * teeth are still separate marks. The hole is small — 2.2 units — deliberately,
 * because a large one would make this the same picture as the Theme toggle's sun,
 * which is a circle and rays in the same 16-unit box.
 */
function Gear() {
  return (
    <svg {...STROKE}>
      <path d="M6.45 1.28H9.55L9.6 3.37L11.21 4.3L13.05 3.29L14.6 5.98L12.81 7.07V8.93L14.6 10.02L13.05 12.71L11.21 11.7L9.6 12.63L9.55 14.72H6.45L6.4 12.63L4.79 11.7L2.95 12.71L1.4 10.02L3.19 8.93V7.07L1.4 5.98L2.95 3.29L4.79 4.3L6.4 3.37Z" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  );
}

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
        {/* The glyph earns its place beside a word rather than replacing one.
            Everything above this button in the column is navigation — a
            Conversation, or a way to make one — and this is the one control that
            configures the app rather than moving through it. A cog says that
            before the sentence does, and it is the same drawing at the same
            weight as the ones two rows up, so the column reads as one interface
            rather than as two that happen to touch. */}
        <Gear />
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
 * chose to go. It is also what names the tab strip below it, so a screen reader
 * announces "Settings" and then the tabs of it rather than a strip that arrived
 * nameless.
 *
 * Endpoint opens first because it is the tab a reader is here for: it decides
 * what a Conversation is even held with, and the other four are preferences, or
 * are about the machine, or are about work already done.
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
  const [showing, setShowing] = useState(0);

  // The tab is chosen above rather than after the question below, because the
  // question replaces this dialog's body and a hook declared under that `if`
  // would be mounted on one render and not the next. Here it is also useful: a
  // reader who opens the Saved tab, presses Delete all, and then backs out of
  // the question comes back to the tab they left rather than to the first one.
  //
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
    // Wide, and the only dialog here that asks to be. The Model Fit tab is a
    // table — a figure, a repository name, a size and a quantisation across —
    // and at the narrow default the names are what gets truncated, which is the
    // one column a reader cannot do without. The narrower panels here look roomy
    // at this width, which is the cost of one ceiling for five panels and a far
    // smaller one than four separate dialogs.
    //
    // Steady in height, and centred like any other dialog because of it. The five
    // panels are not the same length — Saved is two lines, Model Fit is a table of
    // eight — and a dialog as tall as its content puts its top edge wherever the
    // panel in front of it happens to end, so every tab change slides the heading
    // and the tab strip up or down the screen. The strip is the control the reader
    // has just pressed; watching it jump reads as the dialog losing its place. A
    // fixed box has one top edge whichever tab is behind it, and the panel too
    // tall for that box scrolls under the strip rather than taking the top edge
    // out of place with it.
    <Modal labelledBy="settings-heading" onClose={onClose} width="wide" height="steady">
      <h2
        id="settings-heading"
        // `shrink-0` so the heading holds its place against the top of a box of
        // fixed height, which is the one thing in here that must not move.
        className="shrink-0 font-display text-md font-semibold text-ink"
      >
        Settings
      </h2>

      <Tabs
        className="mt-4"
        // The one part of the box that gives way, and so the one part allowed to
        // be a different length from one tab to the next.
        grows
        tabs={sections()}
        selected={showing}
        onSelect={setShowing}
        // The dialog's own heading, so the strip is announced as part of
        // Settings rather than as a nameless row of buttons inside it.
        labelledBy="settings-heading"
      />

      {/* Below the strip and behind a rule, on every tab. Closing is not a
          section — there is nothing behind it — so it stays put whatever is
          showing, rather than becoming a sixth tab a reader could move to and
          find empty. It also holds still against the foot of the box, which is
          what a button that is always in the same place should do. */}
      <div className="mt-5 flex shrink-0 justify-end border-t border-rule pt-4">
        <button type="button" onClick={onClose} className="hm-btn">
          Close
        </button>
      </div>
    </Modal>
  );

  /**
   * What the dialog holds, as one tab each.
   *
   * Built by a function rather than written as a constant because three of the
   * five carry props and one carries a count: a module-level table would be
   * either frozen at the wrong values or hold a mutable module singleton, and
   * both are worse than re-creating five objects on a render that only happens
   * while the dialog is open.
   *
   * Order is the order a reader meets the dialog in, which is not the order they
   * are used in: Endpoint first because it decides what everything else is
   * about, then the machine's own answers, then the preference, then the work
   * already done.
   */
  function sections(): readonly TabSpec[] {
    return [
      {
        // One tab rather than two, because the Model is a consequence of the
        // Endpoint: choosing one is what decides which of the other is on offer,
        // and a reader who changed Endpoint and had to go looking for the answer
        // would be reading a stale Model against a new choice.
        //
        // Named for both rather than for the first alone, which keeps the tab
        // from being a second thing called "Endpoint" in a dialog that already
        // has a control by that name inside this very panel. It is also the more
        // honest name: this is where the pair is chosen, not the first half of it.
        label: "Endpoint & Model",
        panel: (
          <div className="flex flex-col gap-4">
            <EndpointPicker endpointId={endpointId} onSelect={onSelectEndpoint} />
            <ModelPicker
              endpointId={endpointId}
              endpointName={endpointName}
              modelId={modelId}
              onSelect={onSelectModel}
            />
          </div>
        ),
      },
      {
        // What the Model is allowed to read. A tab of its own rather than a
        // field under the Endpoint because it is the one control here that is
        // about this machine rather than about the app's configuration — it
        // names a folder on this developer's disk, and it is what decides
        // whether the Model can read anything at all.
        label: "Folder",
        panel: <RootPicker />,
      },
      {
        // "Fit" rather than "Hardware", which was the name here until this tab
        // existed and labelled the machine rather than what the panel does. Fit is
        // the glossary's word for this — which Models would run well here — and it
        // is deliberately not "recommendation": a recommendation is a judgement
        // about quality, and the note under the list exists to say the ordering is
        // popularity or parameter count and not one. What this offers is a fit.
        label: "Model Fit",
        // Takes no Endpoint, deliberately: a reader asking what they could run
        // offline is not yet running anything, and the answer must not shift
        // with whichever Endpoint the composer is pointed at.
        panel: <HardwareSection />,
      },
      {
        // The one preference here that is not configuration. Labelled in words
        // rather than left to the glyph, because a sun or a moon beside the word
        // Theme says nothing about what it changes.
        label: "Theme",
        panel: (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-2">
              Whether this machine is in its usual colours, or the opposite.
            </span>
            <ThemeToggle />
          </div>
        ),
      },
      {
        label: "Saved",
        // Last, and behind its own tab. Every other thing here changes what the
        // app does next; this one throws away what has already been done, so it
        // should not be a keystroke from anything that creates.
        panel: (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm text-ink-2">Saved Conversations</span>
              {/* What is at stake, said where the decision is made rather than
                  only in the confirmation: a reader who can see there are forty
                  of them may not want this at all, and a reader who can see
                  there are none should not be offered the button at all. */}
              <p className="mt-0.5 text-xs text-muted">{whatIsSaved(savedCount)}</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              // Disabled rather than hidden when there is nothing stored. A
              // control that appeared and vanished with the list would move the
              // panel around underneath the reader; a button that is simply not
              // available says there is nothing here to delete, which is the
              // fact.
              disabled={savedCount === 0}
              className="hm-btn shrink-0 text-error"
            >
              Delete all
            </button>
          </div>
        ),
      },
    ];
  }
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