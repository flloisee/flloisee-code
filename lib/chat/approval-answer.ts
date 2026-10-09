import type { UIMessage } from "ai";

import { isAwaitingApproval, isToolCall, type ToolCallPart } from "./tool-part";

/**
 * One answer to one question the Model asked about a file outside the Root.
 *
 * `id` is the **approval's** id — `part.approval.id`, the `aitxt-…` — and never
 * the Tool Call's `toolCallId`, the `call_…` beside it. They sit next to each
 * other in the stream chunk and look alike, and the SDK matches the answer on the
 * approval: passing the other one changes nothing at all and still triggers the
 * automatic resume, so the mistake presents as a second, duplicate Turn rather
 * than as a failure. One field, one name, and the whole module is about not
 * having two ids to choose between at the call site.
 */
/**
 * What the reader's answer said, in words.
 *
 * These three sentences are what the settled row shows next to the read, so they
 * are the app's account of the reader's decision to whoever reads the transcript
 * later. They are written here rather than at the call site so that "allow once"
 * and "always allow" cannot drift into saying the same thing: they are not the
 * same decision, and a reader who allows a path once is not saying anything about
 * the next Turn.
 *
 * **Held here rather than in the component, because there are two places that draw
 * the same three answers.** A reader gives them about a Tool Call the Model reached
 * for, and about a file they named themselves; the answers are the same decision
 * about the same boundary and are worded the same way, and the composer reuses
 * these strings rather than writing its own. A second set of words for the same
 * three buttons would be a second vocabulary for one decision, which is exactly
 * what a reader would have to learn twice.
 */
export const ALLOWED_ONCE = "You allowed this read.";
export const ALLOWED_ALWAYS = "You allowed this read, and any after it at this path.";
export const READ_REFUSED = "You chose not to let this read happen.";

/** One answer to one question about a read outside the Root. */
export type ApprovalAnswer = {
  /** `part.approval.id` of the request being answered. */
  id: string;
  /** Whether the read may happen. */
  approved: boolean;
  /** Carried back to the transcript: what the reader chose, in their words. */
  reason: string;
};

/**
 * The Tool Call an answer is for, or `null` when there is nothing to answer.
 *
 * **A refusal rather than a half-applied answer.** Two cases land here and both
 * would otherwise be silent:
 *
 * - Answering twice. The SDK matches on `state === 'approval-requested'`, so a
 *   second press finds nothing and updates nothing — but the automatic resume
 *   does still fire, and a reader who pressed twice because the first press
 *   looked like it had not worked would get two Turns.
 * - Answering an id the server never issued. Nothing matches, so the SDK falls
 *   back to the last message and sends *that*, which is a Turn built from a
 *   question nobody asked.
 *
 * Both are checked here, before the SDK is handed anything, because the SDK
 * answers them correctly on the parts and wrongly on the resume. The reader is
 * told nothing either way: there is no question left on screen to attach a
 * message to, and one would be a message about a control that has gone.
 */
export function pendingApproval(messages: UIMessage[], id: string): ToolCallPart | null {
  for (const message of messages) {
    for (const part of message.parts) {
      // The state is named as well as asked about, and the repetition is not
      // redundant: `isAwaitingApproval` is a `boolean` and so cannot narrow, and
      // the SDK's union only carries `approval` on the states that have one. The
      // call is what rules out a read a Grant had already answered for the reader.
      if (!isToolCall(part) || part.state !== "approval-requested") continue;
      if (!isAwaitingApproval(part) || part.approval.id !== id) continue;

      return part;
    }
  }

  return null;
}

/**
 * Whether an answer may be sent, which is the whole of what the caller wants.
 *
 * A separate name from `pendingApproval` because the two answer different
 * questions and only one of them is about the part: a caller that has the part
 * already — the row offering the three answers — wants to know whether to draw
 * them, while a caller holding only an id wants to know whether to send.
 */
export function canAnswer(messages: UIMessage[], id: string): boolean {
  return pendingApproval(messages, id) !== null;
}