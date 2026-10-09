"use client";

import { useId, useState } from "react";
import { getToolName } from "ai";

import { ApprovalControls } from "@/components/approval-answer";
import { isAutomaticApproval, type ToolCallPart } from "@/lib/chat/tool-part";

/**
 * One Tool Call in the transcript: what the Model asked for, and what came back.
 *
 * A Conversation that can read a folder and does not say so is the one failure
 * this feature cannot have. The reader has to be able to tell what an answer was
 * based on, so a row names the Tool that ran and the path it ran on — on one
 * line, collapsed, because a Response that read four files still has to read as
 * prose.
 *
 * ## One frame, three Tools
 *
 * The three Tools answer in different shapes — a listing, a numbered file, a
 * set of matched lines — but a row is not three rows. They are all one thing the
 * reader opens, so the frame is written once: the note the Tools write for the
 * reader first, because it is what orients them, then whatever content came back
 * underneath it. Nothing here branches on which Tool made the call, which is
 * also why a Tool the app has no declaration for still shows its result.
 *
 * ## The row is a disclosure, not a decoration
 *
 * The collapsed line is a `<button>` carrying `aria-expanded` and pointing at the
 * panel with `aria-controls`, so the row is reachable and operable from the
 * keyboard without a key handler of its own, and a screen reader announces
 * whether the answer underneath is already showing. What the panel holds is what
 * makes a cited line checkable rather than something to take on trust.
 */

/**
 * How much of a result is shown when a row is opened.
 *
 * A read is capped at two thousand lines by the Tool itself, and pasting two
 * thousand numbered lines into a chat bubble is not a transcript any reader can
 * use — it pushes the rest of the Conversation off the screen and buries the
 * sentence that explains what was read. What was left out is stated rather than
 * dropped, the way every other ceiling in this feature states itself. The reader
 * who wants the whole of a file has it: it is their machine, and the path is on
 * the line above.
 */
const LINES_SHOWN = 200;

/**
 * What a row says when the Endpoint gave it no sentence to repeat.
 *
 * Both are fallbacks rather than messages we would write in the ordinary case:
 * `requestReason` is the approval policy's own sentence and `reason` is the
 * reader's own decision carried back, and both are written for a person by the
 * code that knows why. A row missing them is a row whose server said nothing,
 * and it still has to say what it is doing rather than render as an empty box.
 */
const APPROVAL_ASKED = "The Model is asking before it reads this, and the answer has not come yet.";
const DENIED = "This read was not made.";

export function ToolCall({ part }: { part: ToolCallPart }) {
  const name = getToolName(part);
  const panelId = useId();
  const status = statusOf(part);
  const asked = askedFor(part);

  // `null` rather than `false`, so a row that opens itself can still be closed.
  // The reader's own press is remembered either way; what is remembered is
  // whether they have had an opinion yet.
  const [opened, setOpened] = useState<boolean | null>(null);
  const open = opened ?? hasNothingToInspect(part);

  return (
    <div
      // `data-tool` names the Tool that made this row and `data-tool-state` names
      // which of the seven states it is in, in the SDK's own words. Structural
      // hooks, not styling ones, for the reason `data-turn` is: a test that
      // selects on a class or a radius has pinned the styling to an assertion.
      data-tool={name}
      data-tool-state={part.state}
      className="my-3"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpened(!open)}
        className="hm-btn hm-btn--quiet flex w-full justify-start gap-1.5 px-1.5 py-1 text-left"
      >
        {/* The caret is the only thing marking this as something that opens, so
            it is hidden from a screen reader — `aria-expanded` on the button
            already says whether the panel is showing, and saying it twice would
            be noise. */}
        <span aria-hidden="true" className="text-muted">
          {open ? "▾" : "▸"}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted">{name}</span>
        {/* `truncate` and `title`, the pair used for the Model identifier beside
            the composer: the row is one line whatever the path is, and a path
            too long to fit is still readable on hover rather than only being
            half there. */}
        <span className="min-w-0 truncate font-mono text-xs" title={asked}>
          {asked}
        </span>
        {status !== null && (
          <span className="ml-auto shrink-0 pl-2 text-xs text-muted">{status}</span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          // Named by the Tool and by whatever the row is currently saying, which
          // is true in every state — a panel called "what it returned" would be
          // lying on the four states where nothing has been returned yet.
          role="group"
          aria-label={`${name}: ${status ?? "result"}`}
          data-tool-body
          className="mt-1 pl-3"
        >
          <Body part={part} name={name} />
        </div>
      )}
    </div>
  );
}

/**
 * What the row says about how the call turned out, when there is anything to say.
 *
 * **A read that finished says nothing.** Silence is the quietest way to say
 * "done", and it is what keeps a Turn that read four files from carrying the
 * same word four times. Everything that is not an ordinary success is spoken,
 * because each of those is a fact about the reader's own files that the prose
 * above it has no reason to mention — and one of them, a refusal, arrives
 * looking exactly like a success to anything that only checks the state.
 */
function statusOf(part: ToolCallPart): string | null {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return "Running…";
    case "approval-requested":
      return isAutomaticApproval(part) ? "Approved automatically" : "Needs your answer";
    case "approval-responded":
      // A denial in flight is only on screen until the SDK settles the part into
      // `output-denied`, and the policy in `lib/tools/approval.ts` has no way to
      // produce one — so the reader did say no. A policy-level denial would need
      // its own word here rather than borrowing this one.
      return part.approval.approved ? "Running…" : "Denied by you";
    case "output-available":
      // The Grant first, and a refusal second. Both are true when a granted read
      // turns out to be a file the Tools will not show, and the Grant wins the
      // row because it is the fact about the boundary — the one that must never
      // be invisible. The refusal is a press away, with the Tools' own sentence
      // saying what it was.
      return isAutomaticApproval(part)
        ? "Approved automatically"
        : wasRefused(part.output)
          ? "Not read"
          : null;
    case "output-error":
      return "Failed";
    case "output-denied":
      return "Denied by you";
  }
}

/**
 * Whether a row's whole content is a sentence rather than something to inspect.
 *
 * A failure, a denial and a question open themselves. None of them holds lines
 * to check — one sentence each and no file — so leaving them collapsed would
 * hide the only thing the row has to say, and a reader would see a row that looks
 * exactly like a successful read with nothing behind it. A read that worked does
 * not open itself: it holds a file, which is a thing to go and choose to look at.
 */
function hasNothingToInspect(part: ToolCallPart): boolean {
  switch (part.state) {
    case "output-error":
    case "output-denied":
      return true;
    case "approval-requested":
      // An automatic approval is on its way to being a result, so it stays shut
      // like one. A question the reader has not answered is not.
      return !isAutomaticApproval(part);
    case "input-streaming":
    case "input-available":
    case "approval-responded":
      return false;
    case "output-available":
      // A refusal carries one sentence and no content, exactly as a failure
      // does — and it arrives as a *finished* call, so nothing else in the row
      // distinguishes it from a read that worked.
      return wasRefused(part.output);
  }
}

/**
 * What came back, which is a different thing in each of the seven states.
 *
 * The one rule here is that a state is never read as its own meaning:
 * `output-available` in particular carries a refusal as readily as a file, and a
 * transcript that showed a refusal as a successful read would be the exact
 * failure this feature exists to rule out.
 */
function Body({ part, name }: { part: ToolCallPart; name: string }) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
    case "approval-responded":
      return <Sentence>{`${name} is still running.`}</Sentence>;
    case "approval-requested":
      return (
        <>
          <Sentence>{part.approval.requestReason ?? APPROVAL_ASKED}</Sentence>
          {/* The three answers, under the sentence that says which file is being
              asked about — a reader deciding whether to allow a read needs to read
              what it is first. They live with the rest of answering rather than
              here: they are about a Conversation, not about how a call turned
              out, and a row rendered on its own has nothing to answer with. */}
          <ApprovalControls part={part} />
        </>
      );
    case "output-error":
      return <Sentence>{part.errorText}</Sentence>;
    case "output-denied":
      return <Sentence>{part.approval.reason ?? DENIED}</Sentence>;
    case "output-available":
      return (
        <>
          {/* A granted read carries the reason the Grant applies, written by the
              approval policy for a person. Shown as well as the Tool's own note,
              because the note is about the file and this is about the boundary —
              and the row above is one word long. */}
          {isAutomaticApproval(part) && part.approval?.reason && (
            <Sentence>{part.approval.reason}</Sentence>
          )}
          <Result output={part.output} />
        </>
      );
  }
}

/** One line of prose in the panel, for the states that have a sentence. */
function Sentence({ children }: { children: string }) {
  return <p className="text-xs text-muted">{children}</p>;
}

/**
 * What a Tool came back with, or the reason it came back with nothing.
 *
 * Everything is narrowed before it is shown. `output` is `unknown` because it is
 * whatever an Endpoint chose to send, and a transcript that renders a field on
 * faith is a transcript that will one day render an object as `[object Object]`
 * in the middle of an answer the reader is about to believe.
 */
function Result({ output }: { output: unknown }) {
  const note = readNote(output);

  return (
    <>
      {/* The Tools write `note` for the person reading, so it leads: it is what
          says whether the answer is the whole file or the first part of it. */}
      {note !== null && <Sentence>{note}</Sentence>}
      <Returned output={output} />
    </>
  );
}

/** The content a result carried, in whichever shape its Tool answered in. */
function Returned({ output }: { output: unknown }) {
  const lines = readLines(output);
  if (lines !== null) return <Quoted>{capped(lines, "lines")}</Quoted>;

  const entries = readEntries(output);
  if (entries !== null) return <Quoted>{capped(entries, "entries")}</Quoted>;

  const matches = readMatches(output);
  if (matches !== null) return <Quoted>{capped(matches, "matches")}</Quoted>;

  return null;
}

/**
 * The block returned content sits in.
 *
 * Mono, and scrolling sideways rather than widening the Turn — the same
 * treatment a code block gets in `markdown.tsx`, and for the same reason: this
 * is quoted material, and a long path or a wide line must not push the Response
 * past the window it is being read in.
 */
function Quoted({ children }: { children: string }) {
  return (
    <pre className="mt-1 overflow-x-auto rounded-control border border-rule bg-paper-3 p-2 font-mono text-[0.75rem] leading-relaxed text-ink-2">
      {children}
    </pre>
  );
}

/** Keeps a long result readable, and says plainly what it did not show. */
function capped(rows: string[], noun: string): string {
  if (rows.length <= LINES_SHOWN) return rows.join("\n");
  return [
    ...rows.slice(0, LINES_SHOWN),
    `… ${rows.length - LINES_SHOWN} more ${noun} are not shown here.`,
  ].join("\n");
}

/* -----------------------------------------------------------------------
 * Reading what came back.
 *
 * Four readers, not one. Each answers a question the row actually has to ask —
 * was there an answer, what did the Tools say about it, and which of the three
 * shapes was it — rather than a general-purpose parse that would have to guess.
 * --------------------------------------------------------------------- */

/** An object whose fields can be read. Arrays are not one. */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, or nothing. */
function words(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The sentence the Tools write for whoever reads the transcript. */
function readNote(output: unknown): string | null {
  return words(record(output)?.note);
}

/**
 * Whether an answer is the Tools saying no rather than the Tools answering.
 *
 * **The distinction this whole transcript turns on.** A refusal is a result, not
 * an error: `lib/tools/file-tools.ts` returns `ok: false` with a sentence rather
 * than throwing, precisely so a Turn survives a path the Model was not allowed.
 * But it arrives over the same `output-available` state as a file that was read,
 * so anything that reads the state alone renders a refusal as a successful read —
 * and a file that was never opened, shown as though it had been.
 */
function wasRefused(output: unknown): boolean {
  return record(output)?.ok === false;
}

/** What `read_file` answers with: the file, one numbered line per row. */
function readLines(output: unknown): string[] | null {
  return strings(record(output)?.lines);
}

/** What `list_files` answers with: one row per entry, name and what it is. */
function readEntries(output: unknown): string[] | null {
  const entries = record(output)?.entries;
  if (!Array.isArray(entries)) return null;

  const rows = entries
    .map((entry) => record(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((entry) =>
      [words(entry.name), words(entry.kind), size(entry.size)].filter(Boolean).join("  "),
    )
    .filter((row) => row !== "");

  return rows.length > 0 ? rows : null;
}

/** What `search_files` answers with: which file, which line, and the line. */
function readMatches(output: unknown): string[] | null {
  const matches = record(output)?.matches;
  if (!Array.isArray(matches)) return null;

  const rows = matches
    .map((match) => record(match))
    .filter((match): match is Record<string, unknown> => match !== null)
    .map((match) => {
      const where = [words(match.path), position(match.line)].filter(Boolean).join(":");
      return [where, words(match.text)].filter(Boolean).join("  ");
    })
    .filter((row) => row !== "");

  return rows.length > 0 ? rows : null;
}

/** The strings of a list, when it is one. */
function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value.filter((line): line is string => typeof line === "string");
  return lines.length > 0 ? lines : null;
}

/** A byte count, or nothing for a folder and for a link. */
function size(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${value} bytes` : null;
}

/** A line number, as a reader counts them. */
function position(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

/**
 * What the row names: the path the Tool was given, and the words it was given
 * to look for.
 *
 * A search with no path is a search of the whole project, so the path alone
 * would make the row read `search_files .` — a Tool name and the Root, which is
 * what every search says and none of what this one was. The query goes on the
 * line with it because the query is the thing an answer can be checked against.
 *
 * Read off the input rather than chosen per Tool, so a Tool this app has no
 * declaration for still gets its arguments on the row. Restated rather than
 * imported from `lib/tools/file-tools.ts`, and deliberately: that module opens
 * files, and a client component reaching into it would be reaching across the
 * boundary those Tools exist to hold. The same helper there is called
 * `askedPath` and answers about the path alone.
 */
function askedFor(part: ToolCallPart): string {
  const asked = record(part.input);
  const path = words(asked?.path) ?? ".";
  const query = words(asked?.query);
  return query === null ? path : `${path} · "${query}"`;
}