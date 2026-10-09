"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  ALLOWED_ALWAYS,
  ALLOWED_ONCE,
  READ_REFUSED,
} from "@/lib/chat/approval-answer";
import { decideNamedPath, grantPath } from "@/lib/roots/declare-root";
import { resolvePath } from "@/lib/roots/file-finder";
import { namedPaths } from "@/lib/roots/named-path";

/**
 * The files a message is about, said in the composer before the message is sent.
 *
 * A reader names a file either by picking it from the Root or by pasting where it
 * is, and both are ordinary words in an ordinary textarea. So this watches the
 * message, asks the server what each named path is, and shows the reader: which
 * files the message is about, and — for one beyond the folder they chose — the
 * three answers they can give about it.
 *
 * **This moment is not a Tool Call's approval, and is not dressed up as one.**
 * Nothing has been generated, the Model has asked for nothing, and the reader
 * typed a path. An approval prompt appearing here would claim an agency that is
 * not there, so the sentence above the buttons is the reader's own — *you named a
 * file* — while the three answers are the same three, in the same words, as
 * everywhere else in the app. Only the timing and that one sentence are new, and
 * the answers are not new because they are the same decision about the same
 * boundary.
 *
 * **The caret never leaves the composer.** Same rule as the `@` menu, for the same
 * reason: this row is over the message being written, and taking the caret would
 * silently stop the words going where they are being typed. The buttons are
 * ordinary buttons for the keyboard; the pointer is stopped at `mousedown` so a
 * reader clicking "Allow once" mid-sentence gets their caret back.
 *
 * **Nothing here decides what may be read.** The route admits every path through
 * the same `mayRead` the Tools use, and the server checks again at send, on its
 * own. A reader who closed the tab between answering and sending has lost the
 * answer and is asked again — which is the correct failure, not a permissive one.
 */

/**
 * How long a message is left alone before the paths in it are asked about.
 *
 * The same pause the `@` menu uses, and for the same reason: a resolve is a stat
 * and a realpath, and asking four times a second for a reader who wants one file is
 * a question they did not ask four times.
 */
const CHECK_DEBOUNCE_MS = 150;

/**
 * What the composer knows about one named path.
 *
 * A `state` rather than the route's own `reason`, because what the composer has to
 * *do* with an answer is what matters and the reasons do not line up with it one
 * for one: only one of them becomes a question, one of the rest means the file can
 * be read at all, and the last is a sentence to show. Which is which is decided
 * once, in {@link rowFor}, rather than in every row.
 */
type Row =
  | { state: "checking" }
  | { state: "settled"; under: "root" | "grant" }
  | { state: "ask"; refusal: string | null }
  | { state: "answered"; what: typeof ALLOWED_ONCE | typeof ALLOWED_ALWAYS | typeof READ_REFUSED }
  | { state: "note"; why: string };

export type NamedFiles = {
  /** The rows to draw above the composer, or `null` when the message names nothing. */
  panel: ReactNode;
  /** How many questions are open, which is what holds the Send control down. */
  open: number;
  /** Called by the composer on every keystroke, to stand down a refusal it has read. */
  typing: () => void;
};

/**
 * The ask, in the reader's own words.
 *
 * Not a sentence about the Model, because no Model has done anything. The reader
 * wrote the path, the path is outside the folder they chose, and nothing is sent
 * until they say so — which is a different thing from a Tool the Model reached for
 * and a reader has to interrupt a Response to stop.
 */
const YOU_NAMED =
  "You named this, and it is outside the folder you chose for the Model to read, so nothing is sent until you say so.";

export function useNamedFiles(text: string): NamedFiles {
  const paths = useMemo(() => namedPaths(text), [text]);

  /**
   * The rows, held against the message they were worked out for.
   *
   * **A new message is a new question**, and the answers belonged to the one
   * before it: a row still reading "you allowed this read" beside words the reader
   * has since rewritten would be claiming a decision they have not made again. So
   * the answer is held with the text it was about and simply does not apply to any
   * other — a comparison when it is read rather than a reset in an effect, because
   * a reset would be a second render that exists only to forget something.
   */
  const [held, setHeld] = useState<{ text: string; rows: Record<string, Row> }>({
    text: "",
    rows: {},
  });
  const rows = held.text === text ? held.rows : {};

  /**
   * The paths asked about while this message has stood as written.
   *
   * A ref rather than part of the state, because it is not something the reader
   * sees, and keyed on the path rather than read off the answer: the answer is
   * "checking" while the route is being reached, and "checking" must not read as
   * "already asked" — or a question would never be asked a second time, which it
   * must be when the reader goes back and changes their mind.
   */
  const asked = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Keyed to `text`, and `paths` is `text` alone, so this runs once per message.
    // Cleared here rather than left over, so a path spelled the same way in two
    // messages is asked about both times.
    asked.current = new Set();
    if (paths.length === 0) return;

    let current = true;
    const timer = setTimeout(() => {
      for (const path of paths) asked.current.add(path);

      void Promise.all(paths.map((path) => resolvePath(path))).then((answers) => {
        // Dropped rather than shown if the reader has typed on: a row about a file
        // they have stopped mentioning is a question they did not ask.
        if (!current) return;

        setHeld((from) => {
          const next = { ...(from.text === text ? from.rows : {}) };
          for (const [at, answer] of answers.entries()) next[paths[at]!] = rowFor(answer);
          return { text, rows: next };
        });
      });
    }, CHECK_DEBOUNCE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `paths` is derived from `text` and `text` is the only thing that changes it;
    // joining the list keeps the effect from re-running on an array the recogniser
    // rebuilt for the same words.
  }, [text, paths.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A change to the rows of the message as it stands now. */
  function write(change: (from: Record<string, Row>) => Record<string, Row>): void {
    setHeld((from) => ({ text, rows: change(from.text === text ? from.rows : {}) }));
  }

  /**
   * What the reader's answer did, decided by the server rather than around it.
   *
   * Every answer is a request this app makes on the reader's behalf: "allow once"
   * and "deny" record a decision held until the next send, and "always allow"
   * writes a Grant that outlives it. **Nothing is marked answered until the route
   * has said so**, which is what leaves the question standing after a refused
   * Grant rather than telling the reader a decision was recorded that was not.
   */
  async function answer(path: string, what: "allow" | "always" | "deny"): Promise<void> {
    write((from) => ({ ...from, [path]: { state: "ask", refusal: null } }));

    const outcome =
      what === "always"
        ? await grantPath(path)
        : await decideNamedPath(path, what === "allow" ? "allow" : "deny");

    if (outcome.status !== "granted") {
      // The question is put back up rather than answered: the reader can allow it
      // once, or refuse it, and neither of those is a decision they did not make.
      write((from) => ({ ...from, [path]: { state: "ask", refusal: outcome.message } }));
      return;
    }

    write((from) => ({
      ...from,
      [path]: {
        state: "answered",
        what: what === "always" ? ALLOWED_ALWAYS : what === "allow" ? ALLOWED_ONCE : READ_REFUSED,
      },
    }));
  }

  const shown = paths.map((path) => ({ path, row: rows[path] ?? { state: "checking" } }));

  return {
    panel: shown.length === 0 ? null : <NamedFilePanel shown={shown} onAnswer={answer} />,
    open: shown.filter((one) => one.row.state === "ask").length,
    // A refusal the reader has read and typed past has been read. A row that was
    // not a refusal is not taken down by this.
    typing: () =>
      write((from) =>
        Object.fromEntries(
          Object.entries(from).map(([path, row]) => [
            path,
            row.state === "ask" && row.refusal !== null ? { state: "ask", refusal: null } : row,
          ]),
        ),
      ),
  };
}

/** One route answer, as one row. This is the only place the two are mapped. */
function rowFor(answer: Awaited<ReturnType<typeof resolvePath>>): Row {
  if (answer.status === "resolved") return { state: "settled", under: answer.under };

  // Only one refusal is a question. The rest are sentences about something the app
  // did not do, and offering three answers to a mistyped path would be offering
  // three answers to a typo.
  if (answer.reason === "outside") return { state: "ask", refusal: null };
  return { state: "note", why: answer.message };
}

/**
 * One row per file the message is about, or nothing at all.
 *
 * Drawn above the composer rather than inside it, for the reason the `@` menu is:
 * a reader naming a file is looking at the words they have written, and the row
 * that answers for them is the thing they are writing about.
 *
 * `data-named` is the path — what a row is *for* — and `data-state` is what
 * happened to it, on the reasoning `data-turn` and `data-offered` record: a test
 * reading a row's text is pinned to the words it happens to be drawn with, and a
 * test reading a class is pinned to the styling.
 */
function NamedFilePanel({
  shown,
  onAnswer,
}: {
  shown: { path: string; row: Row }[];
  onAnswer: (path: string, what: "allow" | "always" | "deny") => Promise<void>;
}) {
  return (
    <ul
      aria-label="Files this message is about"
      className="hm-panel hm-scroll absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-[var(--z-dropdown)] max-h-56 overflow-y-auto py-1"
    >
      {shown.map(({ path, row }) => (
        <li key={path} data-named={path} data-state={row.state} className="px-3 py-2">
          <p className="flex items-baseline gap-2 text-sm text-ink-2">
            <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
            <span className="shrink-0 text-xs text-muted">{verdictOf(row)}</span>
          </p>

          {row.state === "ask" && (
            <>
              <p className="mt-1 text-xs text-muted">{YOU_NAMED}</p>
              <Answers path={path} onAnswer={onAnswer} />
              {/* The route's own words, because this is the server refusing and not
                  the app saying no — and it stands the question back up rather than
                  answering it. */}
              {row.refusal !== null && (
                <p role="alert" className="hm-status hm-status--error mt-2">
                  {row.refusal}
                </p>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The one line of prose a row carries, beside the path it is about. */
function verdictOf(row: Row): string {
  if (row.state === "checking") return "checking…";
  if (row.state === "note") return row.why;
  if (row.state === "ask") return "outside the folder you chose";
  if (row.state === "answered") return row.what;
  return row.under === "grant" ? "covered by a Grant you made" : "inside the folder you chose";
}

/**
 * The three answers, drawn on the row that is asking.
 *
 * The same three, with the same words, in the same order and with the same shapes
 * as a Tool Call's approval: one vocabulary of answers for one decision about one
 * boundary. What differs is the sentence above them, and that sentence is the whole
 * of what makes this a different moment from the other one.
 */
function Answers({
  path,
  onAnswer,
}: {
  path: string;
  onAnswer: (path: string, what: "allow" | "always" | "deny") => Promise<void>;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Answer label="Allow once" primary onPress={() => onAnswer(path, "allow")} />
      <Answer label="Always allow" onPress={() => onAnswer(path, "always")} />
      <Answer label="Deny" quiet onPress={() => onAnswer(path, "deny")} />
    </div>
  );
}

function Answer({
  label,
  primary,
  quiet,
  onPress,
}: {
  label: string;
  primary?: boolean;
  quiet?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      // Stopped at `mousedown` rather than `click`, so a pointer press that lands on
      // a button cannot blur the composer first: a reader clicking "Allow once"
      // mid-sentence gets their caret back rather than losing their place.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
      className={`hm-btn hm-btn--sm ${primary ? "hm-btn--primary" : quiet ? "hm-btn--quiet" : ""}`}
    >
      {label}
    </button>
  );
}