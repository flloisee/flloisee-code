import { describe, expect, it } from "vitest";

import {
  isAutomaticApproval,
  isAwaitingApproval,
  isToolCall,
  type MessagePart,
  type ToolPart,
} from "./tool-part";

/**
 * The two questions a caller asks about an approval, told apart.
 *
 * They are exported because the transcript and the controls are different
 * questions about the same part, and re-deciding which one applies per caller is
 * how the two drift apart. The distinction that matters most is the one a Grant
 * makes: a read covered by one is *asked about* by the same machinery as a read
 * the reader is being asked about, and was never theirs to answer. A caller that
 * treated "asked" as "not yet answered" would show the reader a question about a
 * decision that has already been made.
 */

/** A read the policy has asked about, with whatever the approval carries. */
function asked(approval: Record<string, unknown>): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "approval-requested",
    input: { path: "../.ssh/id_rsa" },
    approval: { id: "aitxt-1", ...approval },
  } as ToolPart;
}

/** A read that has run, with whatever the approval carries. */
function settled(approval?: Record<string, unknown>): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "output-available",
    input: { path: "app/api/chat/route.ts" },
    output: { ok: true, note: "2 lines." },
    ...(approval ? { approval } : {}),
  } as ToolPart;
}

describe("narrowing a part to a Tool Call", () => {
  it("takes both shapes, because the SDK normalises one into the other", () => {
    // A static Tool part comes back dynamic when its schema is unavailable across
    // a persistence boundary, so a saved Conversation can hand back a read in a
    // shape the app did not write. A guard that only knew the first would drop
    // it, and a dropped read is a silent one.
    const dynamic: MessagePart = {
      type: "dynamic-tool",
      toolName: "read_file",
      toolCallId: "call_1",
      state: "output-available",
      input: { path: "app/api/chat/route.ts" },
      output: { ok: true, note: "2 lines." },
    };

    expect(isToolCall(settled())).toBe(true);
    expect(isToolCall(dynamic)).toBe(true);
    expect(isToolCall({ type: "text", text: "hello" })).toBe(false);
  });

  it("tells a dynamic read a decision had already been made about", () => {
    const dynamic: MessagePart = {
      type: "dynamic-tool",
      toolName: "read_file",
      toolCallId: "call_1",
      state: "output-available",
      input: { path: "/Users/reader/notes/todo.md" },
      output: { ok: true, note: "1 line." },
      approval: { id: "aitxt-1", approved: true, isAutomatic: true },
    };

    expect(isAutomaticApproval(dynamic)).toBe(true);
    expect(isAwaitingApproval(dynamic)).toBe(false);
  });
});

describe("a Tool part waiting on the reader", () => {
  it("is one the reader has to answer", () => {
    expect(isAwaitingApproval(asked({}))).toBe(true);
  });

  it("is not one a Grant already answered for them", () => {
    // The read outside the Root that a Grant covers is asked about and answered
    // inside one generation, so it lands here with `isAutomatic` set. Nothing is
    // outstanding, and showing it as outstanding would ask about a decision that
    // has been made.
    expect(isAwaitingApproval(asked({ isAutomatic: true }))).toBe(false);
  });

  it("is not one that has already been answered", () => {
    const answered: ToolPart = {
      type: "tool-read_file",
      toolCallId: "call_1",
      state: "approval-responded",
      input: { path: "../.ssh/id_rsa" },
      approval: { id: "aitxt-1", approved: false },
    } as ToolPart;

    expect(isAwaitingApproval(answered)).toBe(false);
  });

  it("is not a part that is not a Tool Call at all", () => {
    expect(isAwaitingApproval({ type: "text", text: "hello" })).toBe(false);
  });
});

describe("a read a decision had already been made about", () => {
  it("is one the flag says so, whatever state it has settled into", () => {
    // The flag travels and the state does not: by the time the transcript holds
    // the finished read, the state is `output-available` and `isAutomatic` is the
    // only thing left recording that the boundary was crossed.
    expect(
      isAutomaticApproval(
        settled({ id: "aitxt-1", approved: true, isAutomatic: true }),
      ),
    ).toBe(true);
  });

  it("is not a read inside the Root, which was never asked about", () => {
    expect(isAutomaticApproval(settled())).toBe(false);
  });

  it("is not a read the reader answered themselves", () => {
    expect(isAutomaticApproval(asked({}))).toBe(false);
    expect(
      isAutomaticApproval({
        type: "tool-read_file",
        toolCallId: "call_1",
        state: "output-denied",
        input: { path: "../.ssh/id_rsa" },
        approval: { id: "aitxt-1", approved: false },
      } as ToolPart),
    ).toBe(false);
  });
});