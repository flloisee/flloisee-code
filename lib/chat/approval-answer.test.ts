import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { canAnswer, pendingApproval, type ApprovalAnswer } from "./approval-answer";
import type { MessagePart } from "./tool-part";

/**
 * Matching the reader's answer to the question it answers.
 *
 * The SDK matches an answer on `part.approval.id` and quietly ignores one that
 * matches nothing — while still firing the resume that follows an answer. So the
 * two ids that sit beside each other in a stream chunk (the approval's `aitxt-…`
 * and the call's `call_…`) have to be told apart *here*, before anything is
 * handed over, and an answer with nothing to answer has to be refused rather
 * than passed on.
 */

const CALL_ID = "call_1";
const APPROVAL_ID = "aitxt-1";

/** A read outside the Root the reader is being asked about and has not answered. */
function askedRead(overrides: Partial<MessagePart> = {}): MessagePart {
  return {
    type: "tool-read_file",
    toolCallId: CALL_ID,
    state: "approval-requested",
    input: { path: "../.ssh/id_rsa" },
    approval: { id: APPROVAL_ID, requestReason: "outside the folder you shared" },
    ...overrides,
  } as MessagePart;
}

function conversation(...parts: MessagePart[]): UIMessage[] {
  return [{ id: "m1", role: "assistant", parts }];
}

const YES: ApprovalAnswer = { id: APPROVAL_ID, approved: true, reason: "You allowed this read." };

describe("an answer to a question the reader has been asked", () => {
  it("finds the read it is about, so the answer has something to attach to", () => {
    const found = pendingApproval(conversation(askedRead()), YES.id);

    expect(found).not.toBeNull();
    expect(found?.toolCallId).toBe(CALL_ID);
    expect(canAnswer(conversation(askedRead()), YES.id)).toBe(true);
  });

  it("is refused against the Tool Call's id, which sits beside it and looks alike", () => {
    // The two are adjacent in the chunk and both are strings the reader never
    // sees. Passing the wrong one updates nothing at all — and still fires the
    // resume, so the mistake looks like a duplicate Turn rather than a failure.
    expect(canAnswer(conversation(askedRead()), CALL_ID)).toBe(false);
    expect(pendingApproval(conversation(askedRead()), CALL_ID)).toBeNull();
  });

  it("is refused for an id the server never issued, rather than answering the last read instead", () => {
    // With nothing matched, the SDK resumes from the last message whatever it
    // holds — so an invented id would send a Turn built from a question nobody
    // asked.
    expect(canAnswer(conversation(askedRead()), "aitxt-made-up")).toBe(false);
    expect(canAnswer(conversation(askedRead()), "")).toBe(false);
  });

  it("is refused once the reader has answered, so a second press does not start a second Turn", () => {
    const answered: MessagePart = {
      type: "tool-read_file",
      toolCallId: CALL_ID,
      state: "approval-responded",
      input: { path: "../.ssh/id_rsa" },
      approval: { id: APPROVAL_ID, approved: true, reason: YES.reason },
    } as MessagePart;

    expect(canAnswer(conversation(answered), YES.id)).toBe(false);
  });

  it("is refused for a read a Grant already answered for them", () => {
    // The same `approval-requested` state, so the SDK would match it — but nothing
    // is outstanding, and answering it would ask the reader to decide again
    // something that was decided for them.
    const automatic: MessagePart = askedRead({
      approval: { id: APPROVAL_ID, isAutomatic: true },
    } as Partial<MessagePart>);

    expect(canAnswer(conversation(automatic), APPROVAL_ID)).toBe(false);
  });

  it("is refused when the question is not a read at all", () => {
    expect(canAnswer(conversation({ type: "text", text: "hello" }), APPROVAL_ID)).toBe(false);
  });

  it("finds the question wherever in the Conversation it sits", () => {
    // Two Turns on screen: the answer belongs to the first, and the last message
    // is not where the SDK would look if it had to guess.
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "read my key" }] },
      { id: "a1", role: "assistant", parts: [askedRead()] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "and the config" }] },
    ];

    expect(canAnswer(messages, APPROVAL_ID)).toBe(true);
  });

  it("tells two open questions apart, so answering one does not answer both", () => {
    const second = askedRead({
      toolCallId: "call_2",
      approval: { id: "aitxt-2", requestReason: "outside the folder you shared" },
    } as Partial<MessagePart>);

    const found = pendingApproval(conversation(askedRead(), second), "aitxt-2");

    expect(found?.toolCallId).toBe("call_2");
  });
});