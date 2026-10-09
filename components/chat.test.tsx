// @vitest-environment jsdom

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/chat/route";
import { Chat } from "@/components/chat";
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
type ResponsePlan = string[];

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
    streamCompletion(res, plans[index] ?? ["nothing", "planned"]);
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

beforeEach(() => {
  stubCalls = 0;
  stubAborts = 0;
  callListener = null;
  plans = [];
  lastRequest = null;
  findEndpoint("ollama")!.baseURL = stubURL;

  // Rewire only the browser → Route Handler hop. The Route Handler's own call
  // out to the Endpoint falls through to the captured real fetch, untouched.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/chat")) {
      return POST(new Request(new URL(url, "http://localhost").href, init));
    }
    return REAL_FETCH(input, init);
  }) as typeof fetch;

  render(<Chat endpointId="ollama" modelId="llama3.2" />);
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

/** The text of every message on screen, in order. */
function turnsOnScreen(): string[] {
  return screen
    .getAllByText(/.*/)
    .filter((node) => node.tagName === "SPAN")
    .map((node) => node.textContent ?? "");
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

/** The assistant Responses on screen, excluding any user message. */
function responseText() {
  return turnsOnScreen()
    .filter((text) => text !== "hello" && text !== "second question")
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