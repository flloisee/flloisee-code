"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import type { ApprovalAnswer } from "@/lib/chat/approval-answer";
import type { ToolCallPart } from "@/lib/chat/tool-part";
import { grantPath } from "@/lib/roots/declare-root";

/**
 * Answering a question the Model asked about a file outside the Root.
 *
 * The answer belongs to the Conversation rather than to a row: it is
 * `useChat`'s own method, it resumes the whole Turn, and every unanswered read on
 * screen needs the same one. `ToolCall` renders a row and knows nothing about
 * `useChat`, and `Turn` renders a message and knows nothing about either — so the
 * one function is carried in context instead of being threaded through both of
 * them for a value neither of them uses. A row rendered with no Conversation
 * around it — which is what a test of the transcript does — therefore offers no
 * answers at all, which is the honest reading: there is nothing here that could
 * carry one.
 */

/** Carries one answer to the reader's own chat. */
export type AnswerApproval = (answer: ApprovalAnswer) => void;

const Answering = createContext<AnswerApproval | null>(null);

/** Puts the Conversation's answer within reach of every row in it. */
export function ApprovalAnswering({
  answer,
  children,
}: {
  answer: AnswerApproval;
  children: ReactNode;
}) {
  return <Answering.Provider value={answer}>{children}</Answering.Provider>;
}

/**
 * What the reader's answer said, in words.
 *
 * These three sentences are what the settled row shows next to the read, so they
 * are the app's account of the reader's decision to whoever reads the transcript
 * later. They are written here rather than at the call site so that "allow once"
 * and "always allow" cannot drift into saying the same thing: they are not the
 * same decision, and a reader who allows a path once is not saying anything about
 * the next Turn.
 */
const ALLOWED_ONCE = "You allowed this read.";
const ALLOWED_ALWAYS = "You allowed this read, and any after it at this path.";
const REFUSED = "You chose not to let this read happen.";

/**
 * The three answers, drawn on the row that is asking.
 *
 * Returned by a component rather than rendered by `ToolCall` so that `ToolCall`
 * keeps to the one thing it knows how to do — how a call turned out — and the
 * controls, which are about a Conversation rather than a call, live with the rest
 * of what answering involves. Nothing is drawn at all for a part that is not a
 * question the reader has to answer: a read a Grant covered was decided for them,
 * and a read that has already been answered cannot be answered again.
 */
export function ApprovalControls({ part }: { part: ToolCallPart }) {
  const answer = useContext(Answering);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);

  // The hooks are above every early return, so a row that changes shape does not
  // change the order they are called in.
  if (answer === null) return null;
  if (part.state !== "approval-requested" || part.approval.isAutomatic) return null;

  // The approval's own id. Never `toolCallId`, which sits beside it in the same
  // chunk and looks like the same string: the SDK matches the answer on the
  // approval, and the call id would change nothing at all while still firing the
  // resume that follows an answer.
  const id = part.approval.id;

  // Whatever the Model wrote, and only if it wrote a path. A Grant is a path, so
  // there is nothing to record without one — and offering "always" for a call
  // that named none would answer once while claiming more.
  const asked = pathOf(part);

  /**
   * The Grant is recorded **first**, and the approval answered only once the route
   * has said it was. The two are one decision: a reader who pressed "from now on"
   * and got an approval without a Grant has been told the read will not be asked
   * about again, and it will be — on the next Turn, by a question they have
   * already answered. Recording first makes that impossible, at the cost of one
   * round trip the reader was going to wait for anyway.
   */
  const alwaysAllow = async () => {
    if (asked === null) return;

    setAnswering(true);
    setRefusal(null);

    const outcome = await grantPath(asked);

    if (outcome.status !== "granted") {
      // The question is put back up rather than answered: the reader can allow it
      // once, or deny it, and neither of those is a decision they did not make.
      setAnswering(false);
      setRefusal(outcome.message);
      return;
    }

    answer({ id, approved: true, reason: ALLOWED_ALWAYS });
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={answering}
          onClick={() => {
            setAnswering(true);
            answer({ id, approved: true, reason: ALLOWED_ONCE });
          }}
          className="hm-btn hm-btn--primary hm-btn--sm"
        >
          Allow once
        </button>

        {asked !== null && (
          <button
            type="button"
            disabled={answering}
            onClick={() => void alwaysAllow()}
            className="hm-btn hm-btn--sm"
          >
            Always allow
          </button>
        )}

        <button
          type="button"
          disabled={answering}
          onClick={() => {
            setAnswering(true);
            answer({ id, approved: false, reason: REFUSED });
          }}
          className="hm-btn hm-btn--quiet hm-btn--sm"
        >
          Deny
        </button>
      </div>

      {/* The route's own words, because a refusal here is the server refusing and
          not the reader being told the app said no. And it stands the question
          back up rather than answering it: a Grant that was refused leaves the
          reader with the other two answers still open, which is the only honest
          thing to do with a "from now on" they did not get. */}
      {refusal !== null && (
        <p role="alert" className="hm-status hm-status--error mt-2">
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * The path a call named, or nothing when it named none.
 *
 * Read rather than assumed, because `input` is `unknown` here — it is whatever an
 * Endpoint chose to send — and a Grant recorded for a path this did not read would
 * be a Grant on something the reader never saw.
 */
function pathOf(part: ToolCallPart): string | null {
  const input = part.input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;

  const { path } = input as { path?: unknown };
  return typeof path === "string" && path !== "" ? path : null;
}