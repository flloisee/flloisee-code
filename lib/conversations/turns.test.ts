import { MissingToolResultsError, type UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { isAwaitingApproval, isToolCall, type ToolCallPart } from "@/lib/chat/tool-part";
import { settledTurns } from "@/lib/conversations/turns";
import { rejectionFor } from "@/lib/testing/history";

/**
 * What a Saved Conversation may hold.
 *
 * A Conversation that read files is only worth keeping if it can be carried into
 * the next Turn, and that is a claim about what the Endpoint will do with it
 * rather than about what the browser can store. These tests sit at the rule's own
 * seam — Turns in, Turns out — and check the two things a reader would notice if
 * it were wrong: what the transcript still shows, and whether the Endpoint will
 * take the result.
 *
 * The second of those is not asserted by reading the record. `MissingToolResultsError`
 * is raised inside `streamText`, after the SDK's conversion has already returned,
 * and arrives inside a stream that answered 200, so a history that looks
 * well-formed to everything above it can still be rejected outright.
 * `rejectionFor` runs the shipping path for that reason.
 */

function user(text: string): UIMessage {
  return { id: `u-${text}`, role: "user", parts: [{ type: "text", text }] };
}

function response(...parts: UIMessage["parts"]): UIMessage {
  return { id: "a-1", role: "assistant", parts };
}

function text(what: string): UIMessage["parts"][number] {
  return { type: "text", text: what };
}

/** A read that ran and came back with a whole file, as the transcript shows it. */
function completedRead(over: Record<string, unknown> = {}): ToolCallPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "output-available",
    input: { path: "src/notes.md" },
    output: {
      ok: true,
      path: "src/notes.md",
      startLine: 1,
      totalLines: 1,
      lines: ["1: the line the reader wants explained"],
      continuesAtLine: null,
      note: "1 line. This is the whole file.",
    },
    ...over,
  } as ToolCallPart;
}

/** A read the Model has named and the disk has not answered yet. */
function runningRead(over: Record<string, unknown> = {}): ToolCallPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "input-available",
    input: { path: "src/notes.md" },
    ...over,
  } as ToolCallPart;
}

/** A read of a file outside the folder the reader shared, being asked about. */
function askingRead(over: Record<string, unknown> = {}): ToolCallPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "approval-requested",
    input: { path: "../secrets/token.txt" },
    approval: {
      id: "aitxt-1",
      isAutomatic: false,
      requestReason: "/project/../secrets/token.txt is outside the folder you shared.",
    },
    ...over,
  } as ToolCallPart;
}

/** A read of a file a Grant the reader had already given covers. */
function grantedRead(over: Record<string, unknown> = {}): ToolCallPart {
  return {
    ...askingRead({
      input: { path: "/notes/todo.md" },
      approval: {
        id: "aitxt-2",
        isAutomatic: true,
        reason: "/notes/todo.md is outside the folder you shared, and a Grant covers it.",
      },
    }),
    ...over,
  } as ToolCallPart;
}

/** The parts of the first assistant message of a settled Conversation. */
function partsOf(messages: UIMessage[]): UIMessage["parts"] {
  return messages[messages.length - 1].parts;
}

describe("a read that came back", () => {
  it("is kept whole, contents and all", () => {
    const read = completedRead();
    const messages = [user("what does this do?"), response(read)];

    expect(settledTurns(messages)).toEqual(messages);
  });

  it("leaves the history one the Endpoint will take", async () => {
    // The ordinary case, asserted so that everything below is a change from it
    // rather than a rule stated on its own.
    expect(await rejectionFor(settledTurns([user("what does this do?"), response(completedRead())]))).toBeNull();
  });
});

describe("a read the machine still owes", () => {
  it("is settled rather than saved as a call with no result", async () => {
    // The debounce saves while a read is running, so a Conversation that reached
    // the browser mid-read really does hold a call the disk has not answered.
    // Sending that back is not a malformed request the reader can fix: the SDK
    // rejects the whole history, whatever comes after it.
    const settled = settledTurns([user("what does this do?"), response(runningRead())]);

    expect(await rejectionFor(settled)).toBeNull();
  });

  it("is settled with what happened said, rather than vanishing from the transcript", () => {
    const [part] = partsOf(settledTurns([user("what does this do?"), response(runningRead())]));

    expect(part).toMatchObject({
      type: "tool-read_file",
      toolCallId: "call_1",
      state: "output-error",
      input: { path: "src/notes.md" },
    });
    // Said, because a row that shows only "Failed" tells the reader nothing they
    // can act on — and because the Model is handed the same sentence.
    expect((part as ToolCallPart & { errorText: string }).errorText).toBe(
      "This read was cut short and never came back.",
    );
  });

  it("keeps the Model's memory of having asked", () => {
    // The reason this is settled rather than filtered. Dropping the part would
    // leave the Model continuing with no memory of having asked for the file at
    // all, which is the failure `ignoreIncompleteToolCalls` invites.
    const [part] = partsOf(settledTurns([user("what does this do?"), response(runningRead())]));

    expect(isToolCall(part) && part.toolCallId).toBe("call_1");
  });

  it("settles a read the reader had already said yes to", async () => {
    const answered = {
      ...runningRead(),
      state: "approval-responded",
      approval: { id: "aitxt-1", approved: true },
    } as ToolCallPart;

    expect(await rejectionFor(settledTurns([user("what is this?"), response(answered)]))).toBeNull();
  });

  it("settles a read a Grant covers, before the read ran", async () => {
    // A Grant is answered inside the same generation, so a save landing in that
    // window holds a question nobody was asked — which the SDK reads as an
    // unanswered call and rejects, exactly like one the reader ignored.
    const settled = settledTurns([user("what is in my notes?"), response(grantedRead())]);

    expect(await rejectionFor(settled)).toBeNull();
    // The decision it travels with is kept, so a read of a file outside the
    // folder the reader shared cannot come back looking like one inside it.
    expect(partsOf(settled)[0]).toMatchObject({
      state: "output-error",
      approval: { id: "aitxt-2", isAutomatic: true },
    });
  });

  it("leaves the words either side of it exactly as the Model wrote them", () => {
    const settled = settledTurns([
      user("what does this do?"),
      response(text("Let me look."), runningRead(), text("It reads a file.")),
    ]);

    expect(partsOf(settled).map((part) => part.type)).toEqual(["text", "tool-read_file", "text"]);
    expect(partsOf(settled)[0]).toEqual(text("Let me look."));
    expect(partsOf(settled)[2]).toEqual(text("It reads a file."));
  });
});

describe("a question the reader has not answered", () => {
  it("is kept, so the Conversation reopens still asking", () => {
    // The reader has not decided, and dropping the question would decide for
    // them. This is the one Tool Call that is saved without a Tool Result.
    const settled = settledTurns([user("what is in token.txt?"), response(askingRead())]);

    expect(partsOf(settled)[0]).toEqual(askingRead());
    expect(isAwaitingApproval(partsOf(settled)[0])).toBe(true);
  });

  it("survives as well-formed history once the reader has answered", async () => {
    const answered = [
      user("what is in token.txt?"),
      response(askingRead()),
      { id: "a-2", role: "assistant", parts: [completedRead()] } as UIMessage,
    ];

    expect(await rejectionFor(settledTurns(answered))).toBeNull();
  });

  it("survives as well-formed history once the reader has said no", async () => {
    // A denial is an answer: the SDK turns it into a result of its own, so a
    // Conversation holding nothing but refusals has never been malformed.
    const denied = {
      ...askingRead(),
      state: "approval-responded",
      approval: { id: "aitxt-1", approved: false, reason: "not that one" },
    } as ToolCallPart;

    const messages = settledTurns([user("what is in token.txt?"), response(denied)]);

    expect(partsOf(messages)[0]).toEqual(denied);
    expect(await rejectionFor(messages)).toBeNull();
  });
});

describe("the rule the SDK applies to a dangling call", () => {
  // Two shapes, one unfinished Turn. The SDK decides what to do with a question
  // nobody answered by where the last user message falls in the Conversation, so
  // the same Turn is silently forgotten on one save and rejected on the next.
  // Pinned here because a defect that only shows on some saves reads as a flaky
  // test rather than as a defect — and because it is the reason a question is
  // kept rather than settled: keeping it does not make this shape safe, and the
  // rule the SDK applies is not the app's to rely on.
  const OPEN_QUESTION = [user("what is in token.txt?"), response(askingRead())];

  it("rejects a Conversation whose last Turn is the question", async () => {
    const rejection = await rejectionFor(settledTurns(OPEN_QUESTION));

    expect(MissingToolResultsError.isInstance(rejection)).toBe(true);
  });

  it("forgets the question silently when another user message follows it", async () => {
    const rejection = await rejectionFor(
      settledTurns([...OPEN_QUESTION, user("forget it, tell me about src instead")]),
    );

    expect(rejection).toBeNull();
  });
});