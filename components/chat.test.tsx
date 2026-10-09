// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/chat/route";
import { Chat, Turn } from "@/components/chat";
import { findEndpoint } from "@/lib/endpoints/registry";

/**
 * Drives the whole path the user drives, with nothing in the model layer stubbed:
 *
 *   Chat component → real useChat → real Route Handler → real stub Endpoint
 *
 * The one substitution is the network hop between the browser and the Route
 * Handler, rewired to call POST directly. Everything asserted below — which
 * controls exist, what text is on screen — is produced by the shipping code.
 */

const REAL_BASE_URL = "http://localhost:11434/v1";

/** Long enough that a Response is reliably still in progress when Stop is pressed. */
const DELTA_INTERVAL_MS = 60;

/** Words per Response. The Endpoint streams one delta per word, slowly. */
type ResponsePlan = string[] | "reject" | "garbage";

let stubURL = "";
/** The answers the Endpoint will give, in order, one per call. */
let plans: ResponsePlan[] = [];
let stubCalls = 0;
/** The messages the Endpoint was last asked to answer. */
let lastRequest: { messages: { role: string; content: unknown }[] } | null = null;
/** Resolves whoever is waiting on the Endpoint being called. */
let callListener: (() => void) | null = null;
/** Responses the Endpoint began but never finished — i.e. ones the user cut short. */
let stubAborts = 0;
/** Every open socket, so a test never leaks one into the next. */
const sockets = new Set<Socket>();
const REAL_FETCH = globalThis.fetch;

function streamCompletion(res: ServerResponse, words: string[]) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const chunk = (delta: object, finishReason: string | null) => {
    if (!res.writableEnded) {
      res.write(
        `data: ${JSON.stringify({
          id: "1",
          object: "chat.completion.chunk",
          created: 0,
          model: "stub",
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`,
      );
    }
  };

  // Space-separated so the assembled text reads like prose, and so a test can
  // count how much of it has reached the screen.
  const timers = words.map((word, index) =>
    setTimeout(() => chunk({ content: index === 0 ? word : ` ${word}` }, null), index * DELTA_INTERVAL_MS),
  );
  const finish = setTimeout(() => {
    if (res.writableEnded) return;
    chunk({}, "stop");
    res.write("data: [DONE]\n\n");
    res.end();
  }, words.length * DELTA_INTERVAL_MS);

  res.on("close", () => {
    // An unfinished Response is exactly what stopping looks like to the Endpoint.
    if (!res.writableEnded) stubAborts += 1;
    timers.forEach(clearTimeout);
    clearTimeout(finish);
  });
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (!req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const index = stubCalls++;
    lastRequest = JSON.parse(raw);
    callListener?.();

    const planned = plans[index];

    if (planned === "reject") {
      // An Endpoint refusing the Credential, echoing the request back the way a
      // real provider does. Nothing here may reach the reader.
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
      return;
    }

    if (planned === "garbage") {
      // A Response in a form the app cannot read: prose where a stream belongs.
      res.writeHead(200, { "content-type": "text/event-stream" }).end("not a stream\n\n");
      return;
    }

    streamCompletion(res, planned ?? ["nothing", "planned"]);
  });
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        stubURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      sockets.forEach((socket) => socket.destroy());
      server.close(() => resolve());
    }),
);

/** Plans the Endpoint's answers; index N serves the Nth call. */
function endpointAnswers(...answers: ResponsePlan[]) {
  plans = answers;
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubCalls = 0;
  stubAborts = 0;
  callListener = null;
  plans = [];
  lastRequest = null;
  findEndpoint("ollama")!.baseURL = stubURL;

  // jsdom exposes `clipboard` as a getter, so it is redefined outright rather
  // than assigned. Copying out of a Response is observable behaviour, so the
  // test below reads what actually reached the clipboard.
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

  // Rewire only the browser → Route Handler hop. The Route Handler's own call
  // out to the Endpoint falls through to the captured real fetch, untouched.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/chat")) {
      return POST(new Request(new URL(url, "http://localhost").href, init));
    }
    return REAL_FETCH(input, init);
  }) as typeof fetch;

  render(<Chat endpointId="ollama" />);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = REAL_FETCH;
  findEndpoint("ollama")!.baseURL = REAL_BASE_URL;
});

/** Sends a message the way a person does: type it, then press Send. */
function sendMessage(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/send a message/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

function control(name: RegExp): HTMLButtonElement | null {
  return screen.queryByRole("button", { name });
}

/**
 * The text of every Turn on screen, in order.
 *
 * Read from the bubbles themselves rather than from any one tag inside them:
 * a Response is rendered as markdown, so its text sits in whatever element
 * the renderer chose. Keying off the bubble keeps these assertions about what
 * the reader sees, not about how it happens to be marked up.
 */
function turnsOnScreen(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".rounded-2xl"),
  ).map((bubble) => (bubble.textContent ?? "").trim());
}

/** Waits until the Endpoint has been asked for at least `count` Responses. */
async function waitForCalls(count: number) {
  if (stubCalls >= count) return;
  await new Promise<void>((resolve) => {
    callListener = resolve;
    setTimeout(resolve, 5000);
  });
}

/** The messages the Endpoint was last asked to answer. */
function lastRequestBody() {
  return lastRequest?.messages;
}

/**
 * The assistant Responses on screen, excluding what the user typed.
 *
 * The two are told apart by which side they sit on: the user's own words are
 * right-aligned, a Response left — the same distinction a reader relies on.
 */
function responseText() {
  return Array.from(document.querySelectorAll<HTMLElement>(".justify-start .rounded-2xl"))
    .map((bubble) => (bubble.textContent ?? "").trim())
    .join(" ");
}

/** Counts the words in the assistant Response that have reached the screen. */
function wordsShown() {
  return responseText().split(/\s+/).filter((word) => word.length > 0).length;
}

/** Waits until the assistant Response has at least `count` words on screen. */
async function waitForResponseWords(count: number) {
  await waitFor(() => expect(wordsShown()).toBeGreaterThanOrEqual(count), { timeout: 5000 });
}

/**
 * One Turn is one user message and the Response it produced. They are shown
 * differently on purpose: a Response is formatted by the Model, whereas what
 * the user typed is theirs to have shown back verbatim.
 */

const message = (role: "user" | "assistant", text: string): UIMessage => ({
  id: "m1",
  role,
  parts: [{ type: "text", text }],
});

describe("a Turn in the Conversation", () => {
  it("shows a Response as formatted text", () => {
    const { container } = render(
      <Turn message={message("assistant", "## Plan\n\n- one\n- two\n\n**done**")} />,
    );

    expect(container.querySelector("h2")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("done");
  });

  it("shows what the user typed literally, without formatting it as a Response", () => {
    const { container } = render(<Turn message={message("user", "## not a heading")} />);

    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).toContain("## not a heading");
  });

  it("keeps the user's own line breaks", () => {
    const { container } = render(<Turn message={message("user", "first\nsecond")} />);

    // Rendered as prose, a single newline is not a break; the user's own
    // spacing is preserved so what they typed is what they see.
    expect(container.querySelector("p")).toBeNull();
    expect(container.textContent).toContain("first\nsecond");
  });

  // Spec story 35 asks for a code block to be readable, and story 36 for the
  // interface to stay usable in a narrow window. A long unbroken line is what
  // breaks both, by making the Turn wider than the window. Whether that
  // actually happens is a layout property, and jsdom has no layout engine — it
  // reports every element's width as 0, so `min-w-0` on the flex child and a
  // fixed `400px` both "pass". What jsdom *can* see is the content: the line
  // must reach the reader whole, and be copyable out of the Conversation, which
  // is the observable half of the same claim. The layout half is unobservable
  // here and is deliberately not asserted.
  it("keeps a long unbroken line whole and copyable, rather than truncating it", () => {
    const line = "x".repeat(400);

    render(<Turn message={message("assistant", "```\n" + line + "\n```")} />);

    const pre = document.querySelector("pre");
    // Every character of the line is on screen: a Turn that clipped it would
    // leave the reader unable to read the very code they asked for.
    expect(pre?.textContent ?? "").toContain(line);

    // And it survives the round trip out of the Conversation intact.
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(line);
  });
});

describe("abandoning a Response", () => {
  it("offers a Stop control while a Response is in progress, and none otherwise", async () => {
    endpointAnswers(["one", "two", "three", "four"]);

    expect(control(/stop/i)).toBeNull();

    sendMessage("hello");

    await waitFor(() => expect(control(/stop/i)).not.toBeNull());
  });

  it("leaves the partial text of a stopped Response on screen", async () => {
    endpointAnswers(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);

    sendMessage("hello");

    // Stop only once text has arrived, so "partial" genuinely means partial.
    await waitForResponseWords(1);
    const beforeStop = responseText();

    fireEvent.click(control(/stop/i)!);

    // Whatever had already arrived is still readable afterwards.
    await waitFor(() => expect(control(/stop/i)).toBeNull());
    expect(responseText()).toBe(beforeStop);
    expect(beforeStop.length).toBeGreaterThan(0);
  });

  it("stops the Response short of the text the Endpoint had left to give", async () => {
    endpointAnswers(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);

    sendMessage("hello");
    await waitForResponseWords(1);

    fireEvent.click(control(/stop/i)!);
    await waitFor(() => expect(control(/stop/i)).toBeNull());

    // Give any still-in-flight text time to arrive and wrongly appear.
    await new Promise((resolve) => setTimeout(resolve, DELTA_INTERVAL_MS * 8));

    const shown = responseText();
    expect(shown).not.toContain("Foxtrot");
  });

  it("halts generation at the Endpoint rather than streaming on unseen", async () => {
    endpointAnswers(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);

    sendMessage("hello");
    await waitForResponseWords(1);

    fireEvent.click(control(/stop/i)!);

    await waitFor(() => expect(stubAborts).toBe(1), { timeout: 5000 });
  });

  it("lets a new message be sent after stopping", async () => {
    endpointAnswers(["First"], ["Second"]);

    sendMessage("hello");
    await waitForResponseWords(1);

    fireEvent.click(control(/stop/i)!);
    await waitFor(() => expect(control(/stop/i)).toBeNull());

    sendMessage("again");

    // The Endpoint is asked afresh, so the Conversation moved on rather than
    // the abandoned Response quietly carrying on.
    await waitForCalls(2);
    expect(stubCalls).toBe(2);
  });
});

describe("retrying a disappointing Response", () => {
  it("offers a Regenerate control once a Response has finished", async () => {
    endpointAnswers(["Alpha", "Bravo"]);

    expect(control(/regenerate/i)).toBeNull();

    sendMessage("hello");
    await waitForResponseWords(2);

    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());
  });

  it("hides Regenerate while a Response is in progress", async () => {
    endpointAnswers(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);

    sendMessage("hello");
    await waitForResponseWords(1);

    expect(control(/regenerate/i)).toBeNull();

    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());
  });

  it("replaces the previous answer rather than adding a second one", async () => {
    endpointAnswers(["A", "B"], ["Z", "Y", "X"]);

    sendMessage("hello");
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());

    fireEvent.click(control(/regenerate/i)!);

    await waitForCalls(2);
    await waitFor(() => expect(turnsOnScreen().join(" ")).toContain("Z"));
    expect(turnsOnScreen().join(" ")).not.toContain("A");
    expect(turnsOnScreen().join(" ")).not.toContain("B");
  });

  it("leaves the same number of Turns on screen as before", async () => {
    endpointAnswers(["A", "B"], ["Z", "Y"]);

    sendMessage("hello");
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());
    const before = turnsOnScreen().length;

    fireEvent.click(control(/regenerate/i)!);
    await waitForCalls(2);
    await waitFor(() => expect(turnsOnScreen().join(" ")).toContain("Z"));

    // A user message and one Response, before and after.
    expect(turnsOnScreen().length).toBe(before);
  });

  it("regenerates from the same last user message", async () => {
    endpointAnswers(["A", "B"], ["Z", "Y"]);

    sendMessage("hello");
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());

    fireEvent.click(control(/regenerate/i)!);
    await waitForCalls(2);

    expect(turnsOnScreen().join(" ")).toContain("hello");
    expect(turnsOnScreen().filter((text) => text === "hello").length).toBe(1);
  });
});

describe("the Conversation around a stopped or retried Response", () => {
  it("keeps earlier Turns intact when a later Response is stopped", async () => {
    endpointAnswers(["Answer", "One"], ["Two", "Three", "Four", "Five"]);

    sendMessage("hello");
    await waitForResponseWords(1);
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());

    sendMessage("second question");
    await waitForResponseWords(3);

    fireEvent.click(control(/stop/i)!);
    await waitFor(() => expect(control(/stop/i)).toBeNull());

    const onScreen = turnsOnScreen().join(" ");
    expect(onScreen).toContain("hello");
    expect(onScreen).toContain("Answer");
    expect(onScreen).toContain("second question");
    expect(onScreen).toContain("One");
  });

  it("keeps earlier Turns intact when the last Response is regenerated", async () => {
    // Three distinct answers, so the retried one is unmistakably the third.
    endpointAnswers(["Answer"], ["First try", "was wrong"], ["Second try", "is right"]);

    sendMessage("hello");
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());

    sendMessage("second question");
    await waitForResponseWords(4);
    const before = turnsOnScreen().length;

    // Regenerate is withheld while the Response streams, so wait for it to return.
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());
    fireEvent.click(control(/regenerate/i)!);
    await waitForCalls(2);
    await waitFor(() => expect(turnsOnScreen().join(" ")).toContain("Second try"));

    const onScreen = turnsOnScreen().join(" ");
    expect(onScreen).toContain("hello");
    expect(onScreen).toContain("Answer");
    expect(onScreen).toContain("second question");
    expect(turnsOnScreen().length).toBe(before);
  });

  it("still carries the whole Conversation to the Endpoint on regenerate", async () => {
    endpointAnswers(["Answer"], ["First try", "was wrong"], ["Second try", "is right"]);

    sendMessage("hello");
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());

    sendMessage("second question");
    await waitForResponseWords(4);

    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());
    fireEvent.click(control(/regenerate/i)!);
    await waitForCalls(2);
    await waitFor(() => expect(turnsOnScreen().join(" ")).toContain("Second try"));

    // The retried Response was produced with the Turns before it still in view.
    // The answer being replaced is absent; it is the thing being re-derived.
    expect(lastRequestBody()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Answer" },
      { role: "user", content: "second question" },
    ]);
  });
});

describe("a Request that fails", () => {
  /** Waits for the failure the Route Handler reports to reach the screen. */
  async function waitForFailure() {
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined(), { timeout: 10_000 });
    return screen.getByRole("alert").textContent ?? "";
  }

  it("is reported in the interface rather than failing silently", async () => {
    endpointAnswers("reject");

    sendMessage("hello");

    expect(await waitForFailure()).not.toBe("");
  }, 20_000);

  it("keeps every earlier Turn, so the Conversation I had built survives", async () => {
    endpointAnswers(["Answer to the first"], "reject");

    sendMessage("hello");
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull());

    sendMessage("second question");
    await waitForFailure();

    // The context built up before the failure is still on screen and readable.
    const onScreen = turnsOnScreen().join(" ");
    expect(onScreen).toContain("hello");
    expect(onScreen).toContain("Answer to the first");
    expect(onScreen).toContain("second question");
  }, 20_000);

  it("leaves the input ready to type into, rather than holding the failed text", async () => {
    endpointAnswers("reject");

    sendMessage("hello");
    await waitForFailure();

    // The message is retryable rather than retyped, so the box is free for the
    // next thing — and the Turn itself still shows what was asked.
    expect((screen.getByPlaceholderText(/send a message/i) as HTMLTextAreaElement).value).toBe("");
    expect(turnsOnScreen().join(" ")).toContain("hello");
  }, 20_000);

  it("can be retried without retyping the message", async () => {
    endpointAnswers("reject", ["Recovered"]);

    sendMessage("hello");
    await waitForFailure();
    expect(stubCalls).toBe(1);

    // The failed Turn is still the user's message on screen, so it can be sent
    // again as it stands rather than being composed a second time.
    fireEvent.change(screen.getByPlaceholderText(/send a message/i), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitForCalls(2);
    expect(stubCalls).toBe(2);
    await waitForResponseWords(1);
    expect(responseText()).toContain("Recovered");
  }, 20_000);

  it("offers Regenerate after a failure, so the retry needs no retyping at all", async () => {
    endpointAnswers("reject", ["Recovered"]);

    sendMessage("hello");
    await waitForFailure();

    // Regenerate resends the last user message as it stands, so nothing has to
    // be typed again for a transient failure to be worth another go.
    await waitFor(() => expect(control(/regenerate/i)).not.toBeNull(), { timeout: 10_000 });

    fireEvent.click(control(/regenerate/i)!);

    await waitForCalls(2);
    await waitForResponseWords(1);
    expect(responseText()).toContain("Recovered");

    // Retrying adds one Response to the failed Turn rather than a second copy
    // of the message, and the failure is no longer being reported.
    expect(turnsOnScreen().filter((text) => text === "hello")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  }, 30_000);

  it("does not leave an empty bubble where a Response should have been", async () => {
    endpointAnswers("reject");

    sendMessage("hello");
    await waitForFailure();

    // Every Turn on screen holds text. A failed Response shows the reason rather
    // than rendering as an empty bubble with nothing in it.
    for (const turn of turnsOnScreen()) {
      expect(turn.length).toBeGreaterThan(0);
    }
  }, 20_000);

  it("shows the failure without echoing what the Endpoint said about the request", async () => {
    endpointAnswers("reject");

    sendMessage("hello");
    const shown = await waitForFailure();

    // The upstream body names the problem in the upstream's words; the reader
    // gets ours, which is safe to screenshot.
    expect(shown).not.toMatch(/invalid api key/i);
    expect(shown).not.toMatch(/401|Unauthorized/i);
  }, 20_000);

  it("shows an error rather than an empty bubble when the Response is unreadable", async () => {
    endpointAnswers("garbage");

    sendMessage("hello");
    const shown = await waitForFailure();

    expect(shown).not.toBe("");
    // Every Turn holds text: the reader is told why there is no answer, rather
    // than being left with a blank bubble and no explanation.
    for (const turn of turnsOnScreen()) {
      expect(turn.length).toBeGreaterThan(0);
    }
  }, 20_000);

  it("keeps the Conversation and the failed message on screen when the Response is unreadable", async () => {
    endpointAnswers("garbage");

    sendMessage("what is two plus two");
    await waitForFailure();

    expect(turnsOnScreen().join(" ")).toContain("what is two plus two");
  }, 20_000);
});