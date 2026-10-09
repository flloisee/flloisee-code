import { isToolUIPart, type DynamicToolUIPart, type ToolUIPart, type UIMessage } from "ai";

/**
 * The shapes the transcript reads a Tool Call by.
 *
 * Named here rather than written out at each use because two client components
 * have to agree on them — the one that renders the parts of a Turn and the one
 * that renders a row — and a name shared by two is worth having once.
 *
 * Taken from the SDK rather than restated: `UIMessage`'s own generics are what
 * `useChat` hands the chat, so these are the exact parts the browser will meet.
 * That means the input and output are `unknown`, which is honest — the app's
 * Tool types live in `lib/tools/file-tools.ts`, that module opens files, and a
 * client component importing it would be reaching across the boundary those Tools
 * exist to hold. So the result is **read, not trusted**, and every field the
 * transcript shows is checked before it is shown.
 */

/** One part of one Turn: text, a Tool Call, or a part kind we do not draw. */
export type MessagePart = UIMessage["parts"][number];

/**
 * A part that is a Tool Call.
 *
 * `input` and `output` are `unknown` here, and that is the rule rather than an
 * inconvenience: what comes back is whatever the Endpoint chose to send, so a
 * reader of the transcript narrows before it renders. `state` is the SDK's own
 * discriminant, and the seven values below are all of it:
 *
 *   `input-streaming` · `input-available` — the Model is still naming arguments
 *   `approval-requested` · `approval-responded` — a decision was asked for, or made
 *   `output-available` — the Tool ran and answered; `ok` on the answer says whether it said yes
 *   `output-error` — the Tool threw
 *   `output-denied` — the read was refused before the Tool ran
 */
export type ToolPart = Extract<MessagePart, { type: `tool-${string}` }>;

/**
 * A Tool Call in either of the SDK's two shapes.
 *
 * The dynamic one is not hypothetical: the SDK normalises a static Tool part to
 * a dynamic one when the Tool's schema is unavailable across a persistence
 * boundary, so a saved Conversation can hand back a read in a shape the app did
 * not write. Both carry the same seven states, so one row renders either.
 */
export type ToolCallPart = ToolPart | DynamicToolUIPart;

/**
 * Whether a part is a Tool Call at all, in either shape.
 *
 * The narrowing the transcript makes every other decision on top of — `state`,
 * `input`, `output` and `approval` exist on no other part, so nothing about a
 * part can be read until this has said yes.
 */
export function isToolCall(part: MessagePart): part is ToolCallPart {
  return isToolUIPart(part);
}

/**
 * Whether a part is a Tool Call the reader is being asked to answer.
 *
 * A read covered by a Grant is answered for them and arrives here too, with
 * `isAutomatic` set — so "asked" is not the same as "not yet answered", and a
 * caller that only wants the second has to say so. Exporting the distinction is
 * the point: what the transcript says about a row and what a control lets the
 * reader do about it are different questions, and the answer to the second must
 * not be re-derived per caller.
 *
 * A `boolean` rather than a narrowing guard on purpose: narrowing to `ToolPart`
 * would leave the *false* branch typed as `never` wherever the input is already
 * a Tool Call, which is where it is called from.
 */
export function isAwaitingApproval(part: MessagePart): boolean {
  return isToolCall(part) && part.state === "approval-requested" && !part.approval.isAutomatic;
}

/**
 * Whether a read was allowed without asking, because a decision had already been
 * made about this path.
 *
 * Read off the flag rather than off the state, because the flag is what travels:
 * a read covered by a Grant is emitted as `approval-requested` and answered
 * inside the same generation, so by the time the transcript holds the finished
 * read the state is `output-available` and `isAutomatic` on `approval` is the
 * only thing left saying that anything was ever decided.
 *
 * Reported rather than passed over: a file outside the Root arriving in the
 * transcript looking exactly like one inside it is the failure this whole
 * feature exists to rule out.
 */
export function isAutomaticApproval(part: MessagePart): boolean {
  return isToolCall(part) && part.approval?.isAutomatic === true;
}

/** Re-exported so a caller narrowing a Tool Call need not import two modules. */
export type { DynamicToolUIPart, ToolUIPart };