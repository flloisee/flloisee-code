import type { UIMessage } from "ai";

import { isAutomaticApproval, isToolCall, type ToolCallPart } from "@/lib/chat/tool-part";

/**
 * The Turns of a Conversation that may be Saved.
 *
 * A Tool Call and its Tool Result belong together in a saved Conversation. If a
 * call goes in without the answer that came back, the record cannot be carried
 * into the next Turn: the SDK converts a Conversation in the browser's own words
 * and one layer further in the provider rejects a call that never came back,
 * with `MissingToolResultsError` — inside a stream that answered 200, so the
 * reader is told a Model could not complete the request rather than that their
 * Conversation is broken. One unfinished read costs the whole Conversation.
 *
 * So a Saved Conversation holds a Tool Call exactly when it holds something that
 * answers it, and the one exception is a question the reader is being asked:
 * that is not unfinished, it is waiting on them, and dropping it would answer
 * for them.
 *
 * **Not `ignoreIncompleteToolCalls`.** The SDK's own filter deletes the part
 * rather than settling it, which leaves the Model continuing with no memory of
 * having asked. Settling keeps the call in the history as a call that did not
 * come back — which is what happened, and is something the Model can be told.
 */

/**
 * What a call is given when the answer to it never arrived.
 *
 * Said rather than shown as an empty row: the transcript renders this as the
 * reason a read failed, and the Model is handed the same sentence as a tool
 * error. A read that was cut short is not a read that found nothing, and the
 * reader who closes the tab mid-read comes back to a Conversation that says so
 * rather than one that quietly forgets what it was doing.
 */
const CUT_SHORT = "This read was cut short and never came back.";

/**
 * The Turns of `messages`, with every call that nothing has answered yet settled.
 *
 * Pure and total: the Turns before an unfinished call are kept whole, and the
 * one carrying it is kept with that call replaced. Nothing is dropped and no Turn
 * is reordered, so a Conversation this returns differs from the one on screen
 * only in the state of a call that never came to anything.
 */
export function settledTurns(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => (owed(part) ? settled(part) : part)),
  }));
}

/**
 * Whether nobody has answered this part yet, and so nothing carries it forward.
 *
 * **What each state means here.** A Tool Call is on its way to a Tool Result for
 * as long as the machine owes one: the Model is still naming arguments
 * (`input-streaming`), the disk has not answered (`input-available`), or the
 * reader has already said yes and the read has not run (`approval-responded`).
 *
 * Two states are not the machine's debt and are left alone. `output-available`,
 * `output-error` and `output-denied` are the Tool Result itself — a refusal and a
 * failure are answers, and a Conversation containing only those is well-formed by
 * the SDK's own reckoning. And a *denial* the reader made is an answer too: the
 * SDK turns `approval-responded` with `approved: false` into a result of its own,
 * so the reader's "no" survives a reload as a no rather than as a call nobody
 * answered.
 *
 * What is left is the question the reader has been asked and has not yet
 * answered, and a question the Model asked itself for a read a Grant already
 * covers — the reader is not being asked about that one, so nothing else owes it
 * an answer. Both arrive as `approval-requested`, and the flag is what tells
 * them apart.
 */
function owed(part: UIMessage["parts"][number]): part is ToolCallPart {
  if (!isToolCall(part)) return false;

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return true;
    case "approval-requested":
      return isAutomaticApproval(part);
    case "approval-responded":
      return part.approval.approved;
    case "output-available":
    case "output-error":
    case "output-denied":
      return false;
  }
}

/**
 * The same call, recorded as one whose answer never arrived.
 *
 * `input` is named rather than left to the spread because it is the one field a
 * Tool Call may be typed as optional in, and a call with no input is not a call
 * the Model ever made. Everything else is carried over untouched: the id, the
 * path it named, and the question it was going to answer.
 *
 * **The approval is kept, and marked granted.** The SDK will not carry an
 * unanswered approval on a settled part, and the two shapes here agree about
 * what happened: a Grant, or a reader who already said yes, had both decided to
 * let the read happen before the tab closed — it is the read that never came
 * back. Saying so is what keeps the transcript from showing a cut-short read of a
 * file outside the folder the reader shared as though nothing had been decided
 * about it.
 *
 * The one cast in this file, and it says which shape is meant: spreading a part
 * spreads a *union* of the SDK's seven states, so the result is checked against
 * every one of them — including the ones a settled part can never be, which is
 * what makes the plain object fail. What is built here is exactly one member of
 * that union, the one whose state is `output-error`.
 */
function settled(part: ToolCallPart): ToolCallPart {
  return {
    ...part,
    state: "output-error",
    errorText: CUT_SHORT,
    input: part.input,
    ...(part.approval ? { approval: { ...part.approval, approved: true } } : {}),
  } as ToolCallPart;
}