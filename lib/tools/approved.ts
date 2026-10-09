import type { ModelMessage } from "ai";

/**
 * Whether the reader has already said yes to this exact Tool Call.
 *
 * **Why a Tool has to ask at all.** Containment is the last thing between the
 * Model and a file, and it answers the same for a read the reader approved as for
 * one they did not. So an approval that the interface accepted, signed and
 * replayed would still be refused by the Tool, and the reader would press "allow"
 * and watch a Turn say the file was not read. The approval is what turns a
 * refusal into a read, and something has to connect the two.
 *
 * **Read out of the history rather than remembered.** The SDK verifies every
 * approval in a replayed history — the signature is checked against this call's
 * id, tool name and input — *before* it runs anything, so a Tool that executes is
 * a Tool whose approval the server has already proved it issued. And a Tool that
 * kept its own set of what had been allowed would answer the same call
 * differently on the next Turn, which is the failure `readingApproval`'s
 * determinism rule exists to prevent.
 *
 * **Two ids, and the answer carries only one of them.** The request names both
 * the approval and the call; the response names only the approval. So the call is
 * found through its request, and the approval is then answered by that id — which
 * is also why nothing here matches on the `approvalId` a caller happened to be
 * holding, the way the SDK's own `addToolApprovalResponse` does.
 */
export function readerApproved(messages: ModelMessage[], toolCallId: string): boolean {
  const asked = approvalsAsked(messages);
  if (!asked.has(toolCallId)) return false;

  const approvalIds = asked.get(toolCallId) ?? new Set<string>();

  return messages.some((message) =>
    contentOf(message).some(
      (part) =>
        part.type === "tool-approval-response" &&
        approvalIds.has(part.approvalId) &&
        part.approved,
    ),
  );
}

/** Which approvals each Tool Call in this history was asked under. */
function approvalsAsked(messages: ModelMessage[]): Map<string, Set<string>> {
  const asked = new Map<string, Set<string>>();

  for (const message of messages) {
    for (const part of contentOf(message)) {
      if (part.type !== "tool-approval-request") continue;

      const forCall = asked.get(part.toolCallId) ?? new Set<string>();
      forCall.add(part.approvalId);
      asked.set(part.toolCallId, forCall);
    }
  }

  return asked;
}

/**
 * The parts of a message, which is a string for a user message and a list for
 * every other.
 *
 * A user message's content is its text, so narrowing it the way an assistant
 * message's is would read a sentence as a part — and looking for `type` on it
 * would simply find none, which is the right answer for a sentence.
 */
function contentOf(message: ModelMessage): ContentPart[] {
  return typeof message.content === "string" ? [] : message.content;
}

/** Every part shape any message content can hold. */
type ContentPart = NonNullable<Exclude<ModelMessage["content"], string>>[number];