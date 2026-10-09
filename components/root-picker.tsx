"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/modal";
import {
  declareRoot,
  forgetRoot,
  readRoot,
  requestWalk,
  revokeGrant,
  rootNamingIsAvailable,
  type RootAnswer,
  type RootListing,
  type WalkEntry,
} from "@/lib/roots/declare-root";

/**
 * The Reading Root: the folder the Model may read, chosen by walking to it.
 *
 * The reader never types a path here, or anywhere else. They walk down through
 * the folders this app offers and press a button on the one they meant, so the
 * browser only ever names a path the server has already said is there — which is
 * the same rule that keeps the Key Entry route from accepting a base URL.
 *
 * The whole control is absent outside development, and the reason is not that
 * there would be nothing to show: the route that names a Root refuses there, so
 * a button that can only fail is not worth rendering. What a Root is does still
 * apply in a deployed build — the chat route reads the same file — and that is
 * deliberately a different question from changing it.
 */

/** The rows of a listing, split so a folder and a file are not offered alike. */
function asListing(current: RootListing | null) {
  return current?.status === "listed" ? current : null;
}

export function RootPicker() {
  const [answer, setAnswer] = useState<RootAnswer | null>(null);
  const [removing, setRemoving] = useState(false);
  const [walkOpen, setWalkOpen] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  /**
   * The Root in use, held separately from the last answer.
   *
   * A refusal is not a change. A removal the route refused leaves the folder on
   * disk exactly where it was, and replacing what is shown on the strength of
   * the refusal would tell the reader their folder had been given up when it had
   * not — the one direction of error here that leaves them believing the Model
   * reads less than it does, or, after a removal that did work, more.
   *
   * The Grants are held the same way and for the same reason: one that was not
   * taken back is still in force, and a list that had dropped it would be the app
   * claiming the Model reads less than it can.
   */
  const [root, setRoot] = useState<string | null>(null);
  const [grants, setGrants] = useState<string[]>([]);

  // Read on mount rather than held by the page, so the folder shown is the one
  // on disk now. A Root declared a moment ago in another tab is picked up here
  // without a reload, which is what makes declaring one feel like it took.
  useEffect(() => {
    let current = true;
    void readRoot().then((read) => {
      if (!current) return;
      setAnswer(read);
      if (read.status === "declared") setRoot(read.root);
      // A refusal says nothing about the Grants and does not empty the list: the
      // folder on disk is whatever it was, and a reader who cannot be told what
      // it is keeps the last thing they were told.
      if (read.status !== "refused") setGrants(read.grants);
    });
    return () => {
      current = false;
    };
  }, []);

  // Nothing to change and nowhere to walk to. Rendering the control would offer
  // a folder picker in a build whose route refuses every request to it.
  if (!rootNamingIsAvailable()) return null;

  async function removeRoot() {
    setRemoving(true);

    const outcome = await forgetRoot();

    // The Root is cleared only when the route says it was cleared. A refusal
    // leaves it, because that is the state the machine is in.
    if (outcome.status !== "refused") {
      setRoot(null);
      setGrants([]);
    }

    setAnswer(outcome);
    setRemoving(false);
  }

  async function removeGrant(recorded: string) {
    setRevoking(recorded);

    const outcome = await revokeGrant(recorded);

    if (outcome.status === "refused") {
      // A refusal is shown as a refusal, and the list is left as it was: one that
      // was not taken back is still in force, and a list that had dropped it
      // would be the app claiming the Model reads less than it can.
      setAnswer(outcome);
      setRevoking(null);
      return;
    }

    setGrants(outcome.grants);
    setAnswer(
      root === null ? { status: "none", malformed: false, grants: outcome.grants } : { status: "declared", root, grants: outcome.grants },
    );
    setRevoking(null);
  }

  const declared = root;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* A path is a machine string and is set in the mono register, the same
            as a Model identifier: it has to be read character by character to be
            checked against the folder the reader meant. */}
        <span className="hm-label w-16 shrink-0">Folder</span>

        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {declared === null ? (
            <span className="text-sm text-muted">No folder chosen</span>
          ) : (
            <>
              <span className="truncate text-sm text-ink">{basename(declared)}</span>
              <span className="truncate font-mono text-xs text-muted">{declared}</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setWalkOpen(true)}
          className="hm-btn hm-btn--quiet shrink-0"
          aria-haspopup="dialog"
        >
          {declared === null ? "Choose a folder" : "Change folder"}
        </button>

        {/* Only when there is something to remove: a control that forgets nothing
            is a button whose only effect is to do nothing. */}
        {declared !== null && (
          <button
            type="button"
            onClick={() => void removeRoot()}
            disabled={removing}
            className="hm-btn hm-btn--quiet shrink-0"
          >
            {removing ? "Removing..." : "Remove"}
          </button>
        )}
      </div>

      {/* The two states that are not a folder and not an empty one. Both are
          errors rather than absence, and both would look like "no Root" if they
          were reported as nothing. */}
      <p role={answer?.status === "refused" ? "alert" : "status"} className="hm-status">
        {describe(answer, declared)}
      </p>

      {grants.length > 0 && (
        <ul className="flex flex-col gap-1">
          {grants.map((granted) => (
            <li key={granted} className="flex items-center gap-2">
              {/* The path whole, and in the mono register, because this is a
                  decision the reader has to be able to recognise rather than a
                  caption: two of them can easily be called the same thing in
                  different folders, and it is the folder that was asked about. */}
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={granted}>
                {granted}
              </span>
              <button
                type="button"
                onClick={() => void removeGrant(granted)}
                disabled={revoking === granted}
                className="hm-btn hm-btn--quiet hm-btn--sm shrink-0"
              >
                {revoking === granted ? "Stopping..." : "Stop allowing"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {walkOpen && (
        <RootWalk
          // Handed down rather than read again: the Root in use is already known
          // here, and asking the route for it a second time would be a request
          // whose only purpose is to learn something this component holds.
          startAt={declared}
          onClose={() => setWalkOpen(false)}
          onDeclared={(chosen) => {
            setRoot(chosen);
            setAnswer({ status: "declared", root: chosen, grants: [] });
          }}
        />
      )}
    </div>
  );
}

function basename(folder: string): string {
  const trimmed = folder.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

function describe(answer: RootAnswer | null, declared: string | null): string {
  if (answer === null) return "Reading which folder the Model may read...";

  if (answer.status === "refused") return answer.message;

  if (answer.status === "none" && answer.malformed) {
    return "The file recording the folder could not be read, so nothing is being read. Remove it and choose the folder again.";
  }

  if (declared === null) {
    return "The Model cannot read files on this machine until you choose a folder.";
  }

  return `The Model reads ${declared}, and anything you point at outside it stops and asks first.`;
}

/**
 * Walking to a folder, and choosing it.
 *
 * The listing is the server's, refreshed from the folder just clicked rather than
 * worked out in the browser, so "what is in here" is answered in one place in the
 * app. Folders are ways in and are the only thing a Root can be; files are listed
 * because a reader looking at a folder needs to see that it is not empty, and are
 * not clickable, because both clicking one and declaring one are refused.
 */
function RootWalk({
  startAt,
  onClose,
  onDeclared,
}: {
  /** The Root in use, so the walk opens where the reader last left off. */
  startAt: string | null;
  onClose: () => void;
  onDeclared: (root: string) => void;
}) {
  const [listing, setListing] = useState<RootListing | null>(null);
  const [saving, setSaving] = useState(false);
  const [declared, setDeclared] = useState<string | null>(null);

  // Opens at the Root when there is one, since a reader changing it is usually
  // standing where they last left off; at their home folder when there is not.
  useEffect(() => {
    let current = true;
    void requestWalk(startAt ?? undefined).then((next) => {
      if (current) setListing(next);
    });
    return () => {
      current = false;
    };
  }, [startAt]);

  async function choose() {
    if (shown === null || saving) return;

    setSaving(true);
    const answer = await declareRoot(shown.path);

    if (answer.status === "declared") {
      setDeclared(answer.root);
      onDeclared(answer.root);
    } else {
      // The refusal is shown rather than swallowed: the reader pressed the button
      // on a folder they meant, and being told nothing would leave them thinking
      // they had widened what the Model can read when they had not.
      setListing({
        status: "refused",
        message: answer.status === "refused" ? answer.message : "The folder could not be recorded.",
      });
    }

    setSaving(false);
  }

  async function walkTo(target: string) {
    setListing(await requestWalk(target));
  }

  const shown = asListing(listing);

  // The folder above the one being shown, or `null` when the walk has reached the
  // edge of what it may show and there is nowhere up to go.
  const up = shown?.parent ?? null;

  return (
    <Modal labelledBy="root-walk-heading" onClose={onClose}>
      <h2 id="root-walk-heading" className="font-display text-md font-semibold text-ink">
        Choose a folder
      </h2>

      <p className="mt-2 text-sm text-ink-2">
        The Model will read this folder and what is inside it. Nothing outside it is read without
        asking you first.
      </p>

      {/* Where the walk has reached, named in full: a reader confirming they are
          about to hand over a folder needs the whole path, not the last step of
          it. */}
      <p className="mt-3 font-mono text-xs text-muted">{shown?.path ?? ""}</p>

      {/* Always rendered while there is a listing, even when it is empty, so the
          dialog does not change size as the reader walks. */}
      <ul className="mt-3 flex max-h-64 flex-col overflow-y-auto">
        {/* A way back up, offered only while there is one. `..` is the
            conventional name for it and needs no explanation, and it goes to the
            folder the server reported rather than to one worked out by trimming a
            string in the browser. `up` is that folder, and never `null`: the row
            is not rendered at all when there is nothing above. */}
        {up !== null && (
          <li>
            <button
              type="button"
              onClick={() => void walkTo(up)}
              className="hm-btn hm-btn--quiet w-full justify-start"
            >
              ..
            </button>
          </li>
        )}

        {shown?.entries.map((entry: WalkEntry) => (
          <li key={entry.path}>
            {entry.kind === "directory" ? (
              <button
                type="button"
                onClick={() => void walkTo(entry.path)}
                className="hm-btn hm-btn--quiet w-full justify-start font-mono"
              >
                {entry.name}
              </button>
            ) : (
              <span className="px-3 py-2 font-mono text-sm text-muted">{entry.name}</span>
            )}
          </li>
        ))}
      </ul>

      <p role="status" className="hm-status">
        {walkStatus(listing, declared, saving)}
      </p>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="hm-btn">
          Close
        </button>
        <button
          type="button"
          onClick={() => void choose()}
          disabled={shown === null || saving}
          className="hm-btn hm-btn--primary"
        >
          {saving ? "Saving..." : "Use this folder"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * What the walk has to say, so it is never an empty box.
 *
 * A refusal is shown in the route's own words: it names the cause and what to do
 * instead, which is more use here than any wording written on this side of the
 * request.
 */
function walkStatus(
  listing: RootListing | null,
  declared: string | null,
  saving: boolean,
): string {
  if (listing === null) return "Looking at your folders...";
  if (listing.status === "refused") return listing.message;
  if (declared !== null) return `The Model now reads ${declared}.`;
  if (saving) return "Recording your choice...";

  // An empty folder with no way back up is somewhere the reader cannot choose
  // their way out of, which is worth saying rather than showing as a blank box.
  if (listing.entries.length === 0 && listing.parent === null) {
    return "Nothing here to choose. Close this and check your home folder.";
  }

  // The button acts on the folder being shown, so the instruction names that
  // folder rather than speaking about folders in general.
  return listing.parent === null
    ? "Use the folder above, or go into one of them first."
    : "Use the folder above, or go into one of them or back up first.";
}