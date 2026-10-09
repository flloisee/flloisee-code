import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { readerApproved } from "./approved";

/**
 * The reader's answer, as a Tool sees it.
 *
 * A Tool is the last thing between the Model and a file, and it has to be able to
 * tell a read the reader allowed from one they did not — otherwise the approval
 * the interface collected is refused at the moment it is used, and the reader
 * presses "allow" and watches the Turn say the file was not read.
 *
 * This is the join between two ids that do not match each other: the request names
 * the approval *and* the call, and the response names only the approval.
 */

const CALL = "call_1";
const APPROVAL = "aitxt-1";

/** A history holding a question about one call and, optionally, the answer to it. */
function history(answer?: "approved" | "denied" | null): ModelMessage[] {
  return [
    { role: "user", content: [{ type: "text", text: "what is in my notes?" }] },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: CALL, toolName: "read_file", input: { path: "../x" } },
        {
          type: "tool-approval-request",
          approvalId: APPROVAL,
          toolCallId: CALL,
          reason: "outside the folder you shared",
          signature: "-abc",
        },
      ],
    },
    ...(answer === undefined
      ? []
      : [
          {
            role: "tool" as const,
            content: [
              {
                type: "tool-approval-response" as const,
                approvalId: APPROVAL,
                approved: answer === "approved",
                reason: answer === "approved" ? "You allowed this read." : undefined,
              },
            ],
          },
        ]),
  ];
}

describe("a read the reader has answered", () => {
  it("is read when they said yes", () => {
    expect(readerApproved(history("approved"), CALL)).toBe(true);
  });

  it("is not read when they said no", () => {
    // The Tool never runs on a denial — the SDK blocks it — but a history that
    // says no must not be read as a yes by anything that looks at one.
    expect(readerApproved(history("denied"), CALL)).toBe(false);
  });

  it("is not read while the question is still open", () => {
    // What the Tools see on the very request that issued the question. If an
    // unasked read counted as approved, the approval flow would not gate anything.
    expect(readerApproved(history(), CALL)).toBe(false);
  });

  it("is not read for a call the reader was never asked about", () => {
    expect(readerApproved(history("approved"), "call_2")).toBe(false);
  });

  it("is not read on the strength of an approval for a different question", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: "aitxt-other",
            approved: true,
            reason: "something else entirely",
          },
        ],
      },
    ];

    expect(readerApproved(messages, CALL)).toBe(false);
  });

  it("is not read on the strength of an answer to another question about the same call", () => {
    // The join is two ids, and this is the case where they disagree: a history
    // holding this call's question and an answer to somebody else's. A Tool that
    // read any `approved` it could find would open a file on a yes given for a
    // different one.
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-approval-request",
            approvalId: APPROVAL,
            toolCallId: CALL,
            reason: "outside the folder you shared",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: "aitxt-elsewhere",
            approved: true,
            reason: "a decision about something else",
          },
        ],
      },
    ];

    expect(readerApproved(messages, CALL)).toBe(false);
  });

  it("is not read when the history is empty", () => {
    expect(readerApproved([], CALL)).toBe(false);
  });

  it("reads a history whose user messages are plain text, without mistaking them for parts", () => {
    // A user message's content is the sentence itself rather than a list of
    // parts, and the walk over it has to notice that.
    const messages: ModelMessage[] = [
      { role: "user", content: "a string, not a list" },
      ...history("approved"),
    ];

    expect(readerApproved(messages, CALL)).toBe(true);
  });

  it("answers the same way every time it is asked about one call", () => {
    // The Tools run again on the next Turn over a history that still holds this
    // approval. A Tool that answered differently the second time would make
    // "allow once" mean "allow until the page reloads".
    const messages = history("approved");

    expect(readerApproved(messages, CALL)).toBe(readerApproved(messages, CALL));
  });
});