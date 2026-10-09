// @vitest-environment jsdom

import type { UIMessage } from "ai";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalAnswering } from "@/components/approval-answer";
import { Turn } from "@/components/chat";
import type { ApprovalAnswer } from "@/lib/chat/approval-answer";
import type { ToolCallPart } from "@/lib/chat/tool-part";
import * as route from "@/lib/roots/declare-root";
import type { GrantAnswer } from "@/lib/roots/declare-root";

/**
 * The three answers the reader has to a read the Model is asking to make.
 *
 * A read outside the Root stops and asks, and this is the whole of what happens
 * next. What is asserted is what the reader is shown, what is sent when they
 * press something, and — for "always allow" — that the Grant is recorded *before*
 * the answer goes, because the two are one decision and an answer that says
 * "from now on" over a Grant that was never written is a promise the app cannot
 * keep.
 */

const APPROVAL_ID = "aitxt-1";
const TOOL_CALL_ID = "call_1";
const ASKED = "../elsewhere/notes.md";

let answers: ApprovalAnswer[] = [];
let grantAnswers: GrantAnswer[] = [];

beforeEach(() => {
  answers = [];
  grantAnswers = [];

  vi.spyOn(route, "grantPath").mockImplementation(async () =>
    (grantAnswers.shift() as never) ?? { status: "granted", grants: ["/Users/reader/elsewhere/notes.md"] },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A read outside the Root the reader is being asked about, with whatever it carries. */
function askedRead(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    type: "tool-read_file",
    toolCallId: TOOL_CALL_ID,
    state: "approval-requested",
    input: { path: ASKED },
    approval: {
      id: APPROVAL_ID,
      requestReason:
        "/Users/reader/project/../elsewhere/notes.md is outside the folder you shared, so the Model is asking before reading it.",
    },
    ...overrides,
  } as ToolCallPart;
}

function renderQuestion(...parts: ToolCallPart[]) {
  render(
    <ApprovalAnswering
      answer={(answer) => {
        answers.push(answer);
      }}
    >
      <Turn
        message={
          { id: "a1", role: "assistant", parts } as unknown as UIMessage
        }
      />
    </ApprovalAnswering>,
  );
}

function button(name: RegExp): HTMLButtonElement {
  const found = screen.queryByRole<HTMLButtonElement>("button", { name });
  if (!found) throw new Error(`no control named ${name}`);
  return found;
}

describe("a read the reader is being asked about", () => {
  it("offers three answers, and no more", () => {
    renderQuestion(askedRead());

    // Three and only three: allow this once, allow it from now on, or not at all.
    // A fourth would be a way of answering the question that the policy has no
    // opinion about, and a question with no owner is one that gets guessed at.
    expect(screen.getByRole("button", { name: /allow once/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /always allow/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /deny/i })).toBeTruthy();
    expect(answers).toEqual([]);
  });

  it("answers once against the approval's own id, not the Tool Call's", () => {
    renderQuestion(askedRead());

    fireEvent.click(button(/allow once/i));

    // The approval's `aitxt-…` and the call's `call_…` sit beside each other in
    // the stream and look alike. The SDK matches on the approval: the other one
    // would update nothing and still fire the resume, so the mistake shows as a
    // duplicate Turn rather than as a failure.
    expect(answers).toEqual([
      { id: APPROVAL_ID, approved: true, reason: expect.any(String) },
    ]);
    expect(answers[0].id).not.toBe(TOOL_CALL_ID);
  });

  it("denies against the same id, and says in the transcript that the reader chose it", () => {
    renderQuestion(askedRead());

    fireEvent.click(button(/deny/i));

    expect(answers[0].approved).toBe(false);
    // The sentence travels back with the answer and is what the settled row
    // shows, so it has to be written for a person and not as a status.
    expect(answers[0].reason).toBe("You chose not to let this read happen.");
  });

  it("records the Grant first and answers after it, so the two cannot disagree", async () => {
    const order: string[] = [];
    vi.spyOn(route, "grantPath").mockImplementation(async () => {
      order.push("granted");
      return { status: "granted", grants: ["/Users/reader/elsewhere/notes.md"] };
    });

    render(
      <ApprovalAnswering
        answer={() => {
          order.push("answered");
        }}
      >
        <Turn
          message={
            { id: "a1", role: "assistant", parts: [askedRead()] } as unknown as UIMessage
          }
        />
      </ApprovalAnswering>,
    );

    fireEvent.click(button(/always allow/i));

    await waitFor(() => expect(order).toEqual(["granted", "answered"]));
  });

  it("sends the path the Model wrote, leaving the server to say where it is", async () => {
    renderQuestion(askedRead());

    fireEvent.click(button(/always allow/i));

    // Not resolved here: the browser has no Root, so any answer this module
    // invented would be a Grant on a path the reader was never shown.
    await waitFor(() => expect(route.grantPath).toHaveBeenCalledWith(ASKED));
    expect(answers[0].approved).toBe(true);
  });

  it("does not answer when the Grant was refused, because 'always' would then be a lie", async () => {
    grantAnswers.push({
      status: "refused",
      message: "That path is already inside the folder the Model reads.",
    });

    renderQuestion(askedRead());

    fireEvent.click(button(/always allow/i));

    // The reader pressed "from now on" and was not given "from now on". Sending
    // the approval anyway would leave the read allowed once with a Grant that
    // was never written, and a second Turn asking the same question with no
    // memory of the first.
    await waitFor(() => expect(route.grantPath).toHaveBeenCalled());
    expect(answers).toEqual([]);
    expect(screen.getByRole("alert").textContent ?? "").toContain("already inside the folder");
  });

  it("leaves the question open after a refused Grant, so the other two answers are still reachable", async () => {
    grantAnswers.push({ status: "refused", message: "no" });

    renderQuestion(askedRead());

    fireEvent.click(button(/always allow/i));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: /allow once/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /deny/i })).toBeTruthy();
  });

  it("gives the reader one answer per press, however many times they press", async () => {
    renderQuestion(askedRead());

    const allow = button(/allow once/i);
    fireEvent.click(allow);
    fireEvent.click(allow);

    // The SDK matches on `approval-requested`, so a second press updates nothing
    // — and still fires the resume. Two presses must not mean two Turns.
    expect(answers).toHaveLength(1);
  });

  it("offers no answers to a read a Grant already decided", () => {
    renderQuestion(
      askedRead({ approval: { id: APPROVAL_ID, isAutomatic: true } } as Partial<ToolCallPart>),
    );

    // The same machinery asks and answers in one generation. A control here would
    // be asking the reader to decide again something that has been decided for
    // them, which is the failure this feature cannot have.
    expect(screen.queryByRole("button", { name: /allow once/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /always allow/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deny/i })).toBeNull();
  });

  it("offers no answers to a read that has already been answered", () => {
    renderQuestion(
      askedRead({
        state: "approval-responded",
        approval: { id: APPROVAL_ID, approved: true },
      } as Partial<ToolCallPart>),
    );

    expect(screen.queryByRole("button", { name: /allow once/i })).toBeNull();
  });

  it("offers no answers to a read that did not stop for one", () => {
    renderQuestion(
      askedRead({
        state: "output-available",
        output: { ok: true, note: "1 line." },
      } as Partial<ToolCallPart>),
    );

    expect(screen.queryByRole("button", { name: /allow once/i })).toBeNull();
  });

  it("does not offer 'always allow' for a call that named no path to remember", () => {
    // A Grant is a path. With nothing named there is nothing to record, and a
    // button that answered "once" while claiming "always" would be the two
    // disagreeing.
    renderQuestion(askedRead({ input: { query: "id_rsa" } } as Partial<ToolCallPart>));

    expect(screen.queryByRole("button", { name: /always allow/i })).toBeNull();
    expect(screen.getByRole("button", { name: /allow once/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /deny/i })).toBeTruthy();
  });
});