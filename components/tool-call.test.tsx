// @vitest-environment jsdom

import type { UIMessage } from "ai";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Turn } from "@/components/chat";
import type { ToolPart } from "@/lib/chat/tool-part";

/**
 * What the reader can see of what the Model read.
 *
 * A Conversation that can read a folder and does not say so is the one failure
 * the Local File Tools feature cannot have: an answer that cites a line number
 * is only checkable if the reader can see which file it came from and what the
 * read actually returned. These tests sit at the `Turn` seam — a Response is
 * handed over carrying the parts the Endpoint produced for it, and what is
 * asserted is what reaches the screen.
 *
 * Rows are found two ways, both structural. `data-tool` says which Tool made a
 * row, the same idea as `data-turn` in `components/chat.tsx`, so no test here
 * knows what colour or radius a row is drawn with; and the disclosure is reached
 * by its role and its accessible name, which is how a keyboard or screen-reader
 * reader meets it anyway.
 */

afterEach(cleanup);

/** One Response carrying the parts an Endpoint produced for it. */
function response(parts: UIMessage["parts"]): UIMessage {
  return { id: "m1", role: "assistant", parts };
}

/** The parts of a read that has run and come back with a whole file. */
function completedRead(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "output-available",
    input: { path: "app/api/chat/route.ts" },
    output: {
      ok: true,
      path: "app/api/chat/route.ts",
      startLine: 1,
      totalLines: 3,
      lines: ["1: const parse = schema.safeParse(body);", "2: if (!parse.success) {", "3: }"],
      continuesAtLine: null,
      note: "3 lines. This is the whole file.",
    },
    ...overrides,
  } as ToolPart;
}

/** The parts of a read the Model has named and the disk has not answered yet. */
function runningRead(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "input-available",
    input: { path: "app/api/chat/route.ts" },
    ...overrides,
  } as ToolPart;
}

/**
 * The parts of a read outside the Root that a Grant the reader had already given
 * covers, settled and finished.
 *
 * This is the state a granted read actually rests in: `approval-requested` is
 * emitted and answered inside one generation with `isAutomatic` set, so all the
 * transcript ever holds of the decision is the `approval` carried on the
 * finished part.
 */
function grantedRead(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "output-available",
    input: { path: "/Users/reader/notes/todo.md" },
    output: {
      ok: true,
      path: "/Users/reader/notes/todo.md",
      startLine: 1,
      totalLines: 1,
      lines: ["1: ship the thing"],
      continuesAtLine: null,
      note: "1 line. This is the whole file.",
    },
    approval: {
      id: "aitxt-1",
      approved: true,
      isAutomatic: true,
      reason:
        "/Users/reader/notes/todo.md is outside the folder you shared, and a Grant you have already given covers it.",
    },
    ...overrides,
  } as ToolPart;
}

/** The parts of a read the Tools answered "no" to, which is not a failure. */
function refusedRead(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "output-available",
    input: { path: "assets/logo.png" },
    output: {
      ok: false,
      reason: "not-text",
      note: "`assets/logo.png` is not text — it holds bytes that are not characters — so it was not shown.",
    },
    ...overrides,
  } as ToolPart;
}

/** The parts of a listing, as `list_files` answers with one. */
function listing(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-list_files",
    toolCallId: "call_2",
    state: "output-available",
    input: { path: "app" },
    output: {
      ok: true,
      path: "app",
      entries: [
        { name: "api", path: "app/api", kind: "directory", size: null },
        { name: "globals.css", path: "app/globals.css", kind: "file", size: 4096 },
      ],
      total: 2,
      more: false,
      note: "2 entries.",
    },
    ...overrides,
  } as ToolPart;
}

/** The parts of a search, as `search_files` answers with one. */
function search(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-search_files",
    toolCallId: "call_3",
    state: "output-available",
    input: { query: "useChat" },
    output: {
      ok: true,
      path: ".",
      query: "useChat",
      matches: [
        { path: "components/chat.tsx", line: 4, text: 'import { useChat } from "@ai-sdk/react";' },
      ],
      complete: true,
      filesRead: 42,
      filesSkipped: 3,
      foldersSkipped: 1,
      note: '1 line contains "useChat", out of 42 files read.',
    },
    ...overrides,
  } as ToolPart;
}

/**
 * The parts of a read outside the Root that the policy has asked the reader
 * about, and is waiting.
 *
 * This is the state a reader reaches today, with no way yet to answer it — the
 * controls are a later ticket's work. What belongs to this one is that the
 * question is visible and names the file it is about, rather than the Turn
 * simply stopping.
 */
function askedRead(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "approval-requested",
    input: { path: "../.ssh/id_rsa" },
    approval: {
      id: "aitxt-1",
      requestReason:
        "/Users/reader/project/.ssh/id_rsa is outside the folder you shared, so the Model is asking before reading it.",
    },
    ...overrides,
  } as ToolPart;
}

/** The parts of a read the reader said no to, so it never ran. */
function deniedRead(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "output-denied",
    input: { path: "../.ssh/id_rsa" },
    approval: {
      id: "aitxt-1",
      approved: false,
      reason: "You chose not to let this read happen.",
    },
    ...overrides,
  } as ToolPart;
}

/** The parts of a read the Tool threw on rather than answering. */
function failedRead(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: "tool-read_file",
    toolCallId: "call_1",
    state: "output-error",
    input: { path: "app/api/chat/route.ts" },
    errorText: "The file could not be opened.",
    ...overrides,
  } as ToolPart;
}

/** Every Tool row on screen, named by the Tool that made it. */
function rowsOnScreen(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-tool]"),
  ).map((row) => row.getAttribute("data-tool") ?? "");
}

/** The disclosure of the row a named Tool made. */
function disclosure(name: RegExp): HTMLButtonElement | null {
  return screen.queryByRole("button", { name });
}

describe("a Tool Call in a Response", () => {
  it("says which file a completed read was about", () => {
    render(
      <Turn
        message={response([
          { type: "text", text: "The route refuses an Endpoint it does not know." },
          completedRead(),
        ])}
      />,
    );

    // The one line the reader needs to decide whether to believe the answer:
    // which Tool ran, and which file it ran on.
    const summary = disclosure(/read_file/)?.textContent ?? "";
    expect(summary).toContain("app/api/chat/route.ts");
  });

  it("opens to show what the read came back with, so a cited line can be checked", () => {
    render(<Turn message={response([completedRead()])} />);

    // A Response stays readable as prose with four reads in it, so what came
    // back is not on the line — it is one press away and not before.
    const cited = document.querySelector("[data-tool-body]");
    expect(cited).toBeNull();

    fireEvent.click(disclosure(/read_file/)!);

    // Now the line the Model cited can be looked at rather than taken on trust.
    expect(document.querySelector("[data-tool-body]")?.textContent ?? "").toContain(
      "2: if (!parse.success) {",
    );
  });

  it("says so on the row when a read failed, and shows the reason rather than the file", () => {
    render(<Turn message={response([failedRead()])} />);

    // On the row, not behind the disclosure: a reader looking at a Conversation
    // that cannot answer their question has to be able to see which read is the
    // one that went wrong, without opening every row in the Turn to find out.
    const summary = disclosure(/read_file/)?.textContent ?? "";
    expect(summary).toContain("Failed");

    // And it is open already. There is nothing to inspect about a failure — one
    // reason and no content — so a collapsed row would be hiding the only
    // sentence there is.
    expect(document.querySelector("[data-tool-body]")?.textContent ?? "").toContain(
      "The file could not be opened.",
    );
  });

  it("shows a failure with none of the content a successful read would have", () => {
    render(<Turn message={response([failedRead()])} />);

    // No file, no lines, no note: a failed read has nothing to quote, and a
    // transcript that showed any would be showing the reader something the
    // Model never got.
    expect(document.querySelector("[data-tool-body]")?.textContent ?? "").not.toContain(
      "parse.success",
    );
    expect(document.querySelector("pre")).toBeNull();
  });

  it("says a read is still running, because a pause is otherwise a stalled app", () => {
    render(<Turn message={response([runningRead()])} />);

    // A read of a large file takes long enough to look like the app has hung,
    // and the reader has no other way to tell the two apart. Said on the row
    // itself, so it is visible without opening anything.
    expect(disclosure(/read_file/)?.textContent ?? "").toContain("Running…");
  });

  it("says so while the Model is still naming the arguments, when there is no path yet", () => {
    // Mid-stream the input is a partial object, so there may be no path to show
    // at all. The row still says the same thing: it is running, not empty.
    render(
      <Turn message={response([runningRead({ state: "input-streaming", input: {} })])} />,
    );

    const summary = disclosure(/read_file/)?.textContent ?? "";
    expect(summary).toContain("Running…");
    expect(summary).toContain(".");
  });

  it("marks a read a Grant had already allowed, rather than letting it arrive looking like one inside the Root", () => {
    render(<Turn message={response([grantedRead()])} />);

    // A path outside the Root and a path inside it read identically in every
    // other respect: same Tool, same state, same finished. Without this the
    // reader cannot tell that anything crossed the boundary at all, which is
    // precisely what the boundary is for.
    const summary = disclosure(/read_file/)?.textContent ?? "";
    expect(summary).toContain("Approved automatically");
    expect(summary).toContain("/Users/reader/notes/todo.md");
  });

  it("marks it as automatic on the approval itself too, in the moment it is issued", () => {
    // The brief form of the same row, which is on screen for as long as the
    // disk takes to answer. An approval that was already made is not a question
    // the reader is being asked.
    render(
      <Turn
        message={response([
          grantedRead({
            state: "approval-requested",
            output: undefined,
            approval: { id: "aitxt-1", isAutomatic: true },
          }),
        ])}
      />,
    );

    const summary = disclosure(/read_file/)?.textContent ?? "";
    expect(summary).toContain("Approved automatically");
    expect(summary).not.toContain("Needs your answer");
  });

  it("says a read is waiting on the reader, and shows which file is being asked about", () => {
    render(<Turn message={response([askedRead()])} />);

    // A question addressed to the reader is not something to go looking for. It
    // is on the row, and the panel is already open, because the one thing they
    // can act on is the sentence naming the file.
    const summary = disclosure(/read_file/)?.textContent ?? "";
    expect(summary).toContain("Needs your answer");

    // The policy writes this sentence with the path fully resolved, because a
    // relative path would not tell the reader which file is being asked about —
    // and showing our own shorter version of it would undo that.
    expect(document.querySelector("[data-tool-body]")?.textContent ?? "").toContain(
      "/Users/reader/project/.ssh/id_rsa is outside the folder you shared",
    );
  });

  it("puts the row inside the Response that made it, rather than giving it a Turn of its own", () => {
    const { container } = render(
      <Turn
        message={response([
          { type: "text", text: "The route refuses an Endpoint it does not know." },
          completedRead(),
        ])}
      />,
    );

    // A read is part of one Turn's answer, not an exchange of its own. Given a
    // Turn of its own it would be a second bubble, and a Conversation that read
    // a file would count as several Turns rather than as one question.
    expect(container.querySelectorAll("[data-turn]")).toHaveLength(1);
    expect(document.querySelector('[data-turn="response"] [data-tool]')).toBeTruthy();
  });

  it("keeps the prose on either side of a read as separate paragraphs", () => {
    render(
      <Turn
        message={response([
          { type: "text", text: "First I looked at the route." },
          completedRead(),
          { type: "text", text: "So it refuses an Endpoint it does not know." },
        ])}
      />,
    );

    // Two paragraphs, in that order. Joined into one they would read as a
    // single sentence, and the read that sat between them — the whole reason
    // the row is on the screen — would vanish.
    const paragraphs = Array.from(
      document.querySelectorAll('[data-turn="response"] p'),
    ).map((p) => p.textContent);
    expect(paragraphs).toEqual([
      "First I looked at the route.",
      "So it refuses an Endpoint it does not know.",
    ]);
  });

  it("cuts a very long result short, and says how much of it it did not show", () => {
    // A read is capped at two thousand lines by the Tool itself, and two
    // thousand numbered lines inside a chat bubble pushes the rest of the
    // Conversation off the screen. What was left out is stated rather than
    // dropped — the same rule every other ceiling in this feature keeps to.
    const many = Array.from({ length: 400 }, (_, index) => `${index + 1}: line`);

    render(
      <Turn
        message={response([
          completedRead({
            output: {
              ok: true,
              path: "app/api/chat/route.ts",
              startLine: 1,
              totalLines: 400,
              lines: many,
              continuesAtLine: 201,
              note: "Showing lines 1-200 of 400.",
            },
          }),
        ])}
      />,
    );

    fireEvent.click(disclosure(/read_file/)!);

    const body = document.querySelector("[data-tool-body]")?.textContent ?? "";
    expect(body).toContain("1: line");
    expect(body).not.toContain("400: line");
    expect(body).toContain("200 more lines are not shown here.");
  });

  it("leaves a Response that called nothing as it was, inventing no row for it", () => {
    // The guard on the block-keeping above: a Turn of nothing but words takes the
    // path it always took, and no row is drawn for a call that never happened.
    render(<Turn message={response([{ type: "text", text: "## Plan\n\n- one\n- two" }])} />);

    expect(document.querySelector("h2")).toBeTruthy();
    expect(document.querySelectorAll("li")).toHaveLength(2);
    expect(rowsOnScreen()).toEqual([]);
  });

  it("is a disclosure a keyboard can open, rather than a div that looks like one", () => {
    render(<Turn message={response([completedRead()])} />);

    // Found by its role above, which is already the first claim: a `div` with a
    // click handler has no button role to find. And a real button is the whole
    // of the keyboard path — Enter and Space open it without a key handler
    // being written here, and it takes focus in tab order without being told to.
    const button = disclosure(/read_file/)!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("tabindex")).toBeNull();
  });

  it("says whether it is open, and points at the thing it opens", () => {
    render(<Turn message={response([completedRead()])} />);

    const button = disclosure(/read_file/)!;

    // Announced state, and the element it refers to is the panel rather than
    // something that only exists once the reader has already opened it — so the
    // relationship holds in both directions of the toggle.
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panelId = button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toBeNull();

    fireEvent.click(button);

    expect(disclosure(/read_file/)?.getAttribute("aria-expanded")).toBe("true");
    // The id it names is the panel itself, not a wrapper around one.
    expect(document.getElementById(panelId!)).toBe(document.querySelector("[data-tool-body]"));
  });

  it("lets the reader close a row that opened itself", () => {
    render(<Turn message={response([failedRead()])} />);

    // Opened already, so that the reason is on screen. Still closable: a row
    // that fought back would leave a reader who has read the failure with no
    // way to put it away.
    expect(document.querySelector("[data-tool-body]")).toBeTruthy();

    fireEvent.click(disclosure(/read_file/)!);

    expect(document.querySelector("[data-tool-body]")).toBeNull();
  });

  it("shows a refusal as a file that was not read, rather than as a read that produced nothing", () => {
    render(<Turn message={response([refusedRead()])} />);

    // A refusal arrives as a *finished* call with a result attached, exactly like
    // a read that worked — `lib/tools/file-tools.ts` returns it rather than
    // throwing so the Turn survives. So the state cannot tell them apart, and a
    // transcript that trusted it would show a file that was never opened as
    // though it had been read.
    const summary = disclosure(/read_file/)?.textContent ?? "";
    expect(summary).toContain("Not read");
    expect(summary).not.toContain("Running…");

    // The Tools' own sentence, in full: it is written for the reader and says
    // what would make the call work, which is more than a transcript could.
    const body = document.querySelector("[data-tool-body]")?.textContent ?? "";
    expect(body).toContain("is not text");
  });

  it("opens a listing to show what was in the folder", () => {
    render(<Turn message={response([listing()])} />);

    expect(disclosure(/list_files/)?.textContent ?? "").toContain("app");

    fireEvent.click(disclosure(/list_files/)!);

    const body = document.querySelector("[data-tool-body]")?.textContent ?? "";
    expect(body).toContain("api");
    expect(body).toContain("directory");
    expect(body).toContain("globals.css");
    expect(body).toContain("2 entries.");
  });

  it("opens a search to show the lines it found, and says what it looked for", () => {
    render(<Turn message={response([search()])} />);

    // What was asked for is the query, not the folder: a search with no path is
    // the whole project, so the row would otherwise read `search_files .` and
    // tell the reader nothing they could check the answer against.
    const summary = disclosure(/search_files/)?.textContent ?? "";
    expect(summary).toContain("useChat");

    fireEvent.click(disclosure(/search_files/)!);

    const body = document.querySelector("[data-tool-body]")?.textContent ?? "";
    expect(body).toContain("components/chat.tsx:4");
    expect(body).toContain('import { useChat } from "@ai-sdk/react";');
  });

  it("does not show a question that was answered for them as one waiting", () => {
    // The distinction that makes the row above mean anything: a read a Grant
    // covers is asked about by the same machinery and was never the reader's to
    // answer.
    render(<Turn message={response([askedRead({ approval: { id: "aitxt-1", isAutomatic: true } })])} />);

    expect(disclosure(/read_file/)?.textContent ?? "").not.toContain("Needs your answer");
  });

  it("names the path of a read that was denied, so being cautious next Turn is a choice the reader can place", () => {
    render(<Turn message={response([deniedRead()])} />);

    // The path is on the row rather than only inside the refusal, because the
    // reader's likely next question is "which file was that?" — and a denial
    // they cannot place is a denial they learn nothing from.
    const summary = disclosure(/read_file/)?.textContent ?? "";
    expect(summary).toContain("Denied by you");
    expect(summary).toContain("../.ssh/id_rsa");
  });

  it("opens a denial to show what it says, and none of a file that was never read", () => {
    render(<Turn message={response([deniedRead()])} />);

    // Open already, like a failure: a denial has one sentence in it and no
    // content, so a collapsed row would be a row that says nothing.
    expect(document.querySelector("[data-tool-body]")?.textContent ?? "").toContain(
      "You chose not to let this read happen.",
    );
    expect(document.querySelector("pre")).toBeNull();
  });
});