"use client";

import { useEffect, useState } from "react";

import { readRootPath, type RootPath } from "@/lib/roots/file-finder";

/**
 * Which folder is the Root, said in the composer.
 *
 * The composer names the Endpoint and the Model a message will reach, and nothing
 * on screen named the folder the Model may read in. That left the one thing a
 * reader most wants to know about a Turn — where its answer can come from — with
 * nowhere to be read, and a reader who had declared a Root had no way to tell
 * whether the answer was coming from inside it. So it is said here, once, beside
 * the controls, in the same register as the Endpoint readout beside it.
 *
 * **It is a readout and not a control**, which is what every choice below follows
 * from: it is quiet, truncated rather than wrapped, and the whole of it one hover
 * away — the same bargain the Endpoint and Model line makes for the same reason,
 * that a cut is only acceptable when nothing is lost.
 */

/**
 * How much of a path the composer will draw.
 *
 * Measured in characters rather than in a width, because a path is a machine
 * string read left to right and the line it sits on already gives up its width to
 * the field and the buttons: what is wanted is "how long before this stops being a
 * glance and starts being a wall", and that is a count.
 *
 * Forty-eight is where a developer's own path stops fitting — a checkout under a
 * volume, a Projects folder and a GitHub account is usually past it — while the
 * shortest path anybody declares still fits whole. A longer budget would push the
 * Send button along on the row it lives on; a shorter one would cut a path a reader
 * recognises at a glance.
 */
export const MAX_ROOT_CHARS = 48;

/** What the cut leaves behind, and the sentence a hover carries. */
export type RootReadout = {
  /** The words drawn in the composer, possibly cut. */
  text: string;
  /** The whole of it, for a hover, because a cut path is not the path. */
  title: string;
  /**
   * Whether this is a machine string rather than a sentence.
   *
   * The mono register is for values read character by character, and a path is one
   * while "No folder chosen" is prose — so the register is decided here, beside the
   * words, rather than in the composer by a rule that would have to guess which of
   * them it is looking at.
   */
  machine: boolean;
};

/**
 * The Root as the composer says it, or `null` while it has not been asked yet.
 *
 * `null` rather than a placeholder: nothing is drawn at all until the route has
 * answered, so the row does not jump when the answer arrives, and a reader is
 * never shown a folder this app has not confirmed it is reading.
 *
 * A refused answer draws nothing either, and says nothing about it. The readout is
 * not where a broken route is reported — the `@` menu says so in its own words at
 * the moment the reader is actually asking about files, and a line here would be a
 * second place to report one from, and the one nobody would read.
 */
export function rootReadout(reading: RootPath | null): RootReadout | null {
  if (reading === null) return null;
  if (reading.status === "declared") {
    return {
      text: cutMiddle(reading.root, MAX_ROOT_CHARS),
      title: reading.root,
      machine: true,
    };
  }

  if (reading.status === "no-root") {
    return reading.malformed
      ? {
          text: "The folder cannot be read",
          title:
            "The file recording the folder cannot be read, so nothing is being read and there is " +
            "no Root to show. Remove it and choose the folder again, in Settings.",
          machine: false,
        }
      : {
          text: "No folder chosen",
          title: "No folder has been chosen for the Model to read yet.",
          machine: false,
        };
  }

  return null;
}

/**
 * A path too long for its budget, cut in the middle.
 *
 * The middle rather than the end, because the end of a path is its whole identity
 * and the middle is the run of parent folders in between — `~/Dev/Github/Repos` says
 * less about which project this is than the last two segments do, and cutting there
 * would have thrown away the name of the folder the reader chose. The head is kept
 * as well because the leading `/` and the volume name are what make a cut path
 * recognisable as the one it came from.
 *
 * An ellipsis of three dots rather than the typographic one: this is a machine
 * string in the mono register, and the ASCII mark is the one that appears in the
 * paths this app shows everywhere else.
 */
function cutMiddle(path: string, max: number): string {
  const ELLS = "...";
  // A budget too small to hold the mark itself is a caller's mistake, and the whole
  // of the string is the honest thing to hand back rather than a cut that has
  // thrown away more than it kept.
  if (path.length <= max) return path;
  if (max <= ELLS.length) return path;

  const kept = max - ELLS.length;
  const head = Math.ceil(kept / 2);
  const tail = kept - head;

  return `${path.slice(0, head)}${ELLS}${path.slice(path.length - tail)}`;
}

/**
 * The slot announcing that the Root has changed.
 *
 * A slot rather than a bespoke event for the reason `REGISTRY_CHANGED_KEY` is one:
 * `StorageEvent` is the signal this app already broadcasts inside its own window,
 * and reusing it means a change reaches every listener the same way. Nothing reads
 * it back — it exists so the picker that records a Root and the composer that
 * names it are not two places holding one answer.
 *
 * The alternative was the composer taking the folder from Settings as a prop, which
 * means threading a second layout dependency through the dialog and the Workspace
 * to carry a value one request already produces.
 */
export const ROOT_CHANGED_KEY = "multi-endpoint-chat.reading-root";

/**
 * Announces that the Root has changed, to this window as well as others.
 *
 * Dispatches rather than sets, because a `storage` event fired by this window does
 * not reach this window: a reader who chooses a folder in Settings would otherwise
 * watch the picker take it and the composer go on naming the last one.
 */
export function announceRootChanged(): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new StorageEvent("storage", { key: ROOT_CHANGED_KEY, newValue: "" }));
}

/**
 * Which folder is the Root, kept current while the interface is open.
 *
 * Asked once on mount and again whenever the Root is declared or forgotten — the
 * broadcast matters more than it looks, because a composer left naming the last
 * folder is a claim about where the next answer comes from, and the reader who
 * changed the boundary would be told nothing.
 */
export function useRootReadout(): RootReadout | null {
  const [reading, setReading] = useState<RootPath | null>(null);

  useEffect(() => {
    let current = true;

    async function read() {
      const next = await readRootPath();
      // Guarded rather than awaited in the effect body, as `use-registry` guards
      // its own read: an answer that arrives after this component has unmounted is
      // not one to set state with.
      if (current) setReading(next);
    }

    void read();

    function changed(event: StorageEvent) {
      if (event.key === null || event.key === ROOT_CHANGED_KEY) void read();
    }

    window.addEventListener("storage", changed);
    return () => {
      current = false;
      window.removeEventListener("storage", changed);
    };
  }, []);

  return rootReadout(reading);
}