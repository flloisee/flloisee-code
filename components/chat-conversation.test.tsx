// @vitest-environment jsdom

import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/chat/route";
import { POST as ENDPOINTS_POST } from "@/app/api/endpoints/route";
import { POST as MODELS_POST } from "@/app/api/models/route";
import { Workspace } from "@/components/workspace";
import { backendFor } from "@/lib/conversations/use-conversations";
import { findEndpoint } from "@/lib/endpoints/registry";

/**
 * The whole saving path, driven the way the reader drives it.
 *
 * The same substitution as `chat.test.tsx` — the browser → Route Handler hop
 * rewired to call POST directly, against a stub Endpoint streaming real deltas —
 * so nothing in the chat or the Route Handler is stubbed out. What is different
 * here is that the store is a real in-memory database, because the thing worth
 * testing is the round trip: a Turn sent in the interface has to be there after
 * a reload, under a name derived from the message that opened it.
 */

// Generous for the whole file rather than per test, and not a licence to wait:
// every wait below is awaited on what it is actually waiting for, so a failure
// surfaces as a failed assertion rather than as a timeout landing here first.
// The default 5s is simply too tight for a test that streams two Responses,
// saves both, and drives a real server between them under a parallel suite —
// which showed up as a different test failing on each run.
vi.setConfig({ testTimeout: 20_000 });

let stubURL = "";
/** The answers the stub Endpoint will give, one per call. */
let plans: string[][] = [];
/**
 * Milliseconds the stub waits before its first chunk, per test.
 *
 * A cold Model answers nothing while it loads — seconds of silence before the
 * first token — and the save that lands in that silence must not disturb the
 * stream waiting on it. Zero is the usual instant answer.
 */
let streamDelayMs = 0;
/** Every Endpoint and Model the app was asked to use, in order. */
let askedFor: { endpointId: string; modelId: string }[] = [];
/**
 * The Model identifiers chat completions actually arrived with, in order.
 *
 * Recorded at the stub rather than in the interface, so this is what the
 * Endpoint itself was asked for — the identifier that decides which Model
 * loads — rather than what the interface believes it sent.
 */
let loadedModels: string[] = [];
/**
 * The identifiers discovery offers, in the shape a compatible server answers
 * with. LM Studio's own listing, so a dropdown pick here is the same act as
 * picking from a live server's list.
 */
const DISCOVERED_MODELS = [
  "ornith-1.5-9b-mlx",
  "google/gemma-4-e2b",
  "qwen3.5-4b-mlx",
  "neohorse-1-4b-mlx",
  "ling-3.0-tiny-oq4e",
  "ling-3.0-tiny-abliterated-apex",
  "ornith-1.5-9b-uncensored-mlx",
  "text-embedding-nomic-embed-text-v1.5",
];
const sockets = new Set<Socket>();
const REAL_FETCH = globalThis.fetch;

function streamCompletion(res: ServerResponse, words: string[]) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const chunks = () => {
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

    chunk({ role: "assistant", content: "" }, null);
    for (const word of words) chunk({ content: `${word} ` }, null);
    chunk({}, "stop");
    res.write("data: [DONE]\n\n");
    res.end();
  };

  // Held rather than sent, so a test can hold the stream open past the save
  // the way a loading Model does — and prove the save leaves it alone.
  if (streamDelayMs > 0) {
    const timer = setTimeout(chunks, streamDelayMs);
    res.on("close", () => clearTimeout(timer));
  } else {
    chunks();
  }
}

beforeAll(async () => {
  const server = createServer((req, res) => {
    // A compatible server's two paths: the listing discovery reads, and the
    // completions a message sends. Routed here so one stub stands in for the
    // whole server, discovery and generation together.
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: DISCOVERED_MODELS.map((id) => ({
            id,
            object: "model",
            owned_by: "organization_owner",
          })),
          object: "list",
        }),
      );
      return;
    }

    // The chat path records which Model it was asked for before streaming, so
    // a test can say which Model the Endpoint would have loaded.
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        loadedModels.push(JSON.parse(body).model);
      } catch {
        loadedModels.push("");
      }
      streamCompletion(res, plans.shift() ?? ["ok"]);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stubURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  afterAll(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
});

let factory: IDBFactory;

beforeEach(async () => {
  factory = new IDBFactory();
  plans = [];
  askedFor = [];
  loadedModels = [];
  streamDelayMs = 0;
  // The app keeps the Endpoint and Model the reader chose, so these tests each
  // start from a first visit: jsdom's storage is shared by every test in the
  // file, and one test's choice of Endpoint would otherwise open the next on it.
  window.localStorage.clear();
  // Every Endpoint used here is pointed at the stub, so a Response actually
  // arrives whichever one the reader has chosen. A test that only wired one
  // would see its later sends fail and read as a different bug.
  findEndpoint("ollama")!.baseURL = stubURL;
  findEndpoint("lmstudio")!.baseURL = stubURL;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/chat")) {
      // Recorded here rather than in the Route Handler, so the assertion is
      // about what the interface put in the request — which is the thing that
      // decides where the message is actually sent.
      const body = JSON.parse(String(init?.body ?? "{}"));
      askedFor.push({ endpointId: body.endpointId, modelId: body.modelId });
      return POST(new Request(new URL(url, "http://localhost").href, init));
    }
    // The Endpoint picker asks the app's own server which Endpoints exist. Left
    // on the real fetch it would never resolve in jsdom, and the picker would
    // sit empty — with no Endpoint to choose but the one already in use, which
    // is the very thing these tests need to change.
    if (url.endsWith("/api/endpoints")) {
      return ENDPOINTS_POST();
    }
    // Discovery asks the app's server which Models an Endpoint offers, which
    // proxies to the stub's listing above. Left on the real fetch the picker
    // would never leave its manual field, so no test could pick from a list.
    if (url.endsWith("/api/models")) {
      return MODELS_POST(new Request(new URL(url, "http://localhost").href, init));
    }
    return REAL_FETCH(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = REAL_FETCH;
  findEndpoint("ollama")!.baseURL = "http://localhost:11434/v1";
  findEndpoint("lmstudio")!.baseURL = "http://127.0.0.1:1234/v1";
});

/** The page as it ships, with the store pointed at this test's database. */
function renderApp() {
  return render(<Workspace endpointId="ollama" backend={backendFor(factory)} />);
}

function send(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/send a message/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

/** The names in the list, as the reader would read them. */
function names(): string[] {
  return [...document.querySelectorAll("[data-conversation]")].map(
    (row) => row.querySelector("button")?.textContent ?? "",
  );
}

/** The text of every Turn on screen, in order. */
function turnsOnScreen(): string[] {
  return [...document.querySelectorAll("[data-turn]")].map((turn) => turn.textContent ?? "");
}

/** Waits for the save to land, which is debounced rather than immediate. */
async function savedCount(n: number) {
  await waitFor(() => expect(names()).toHaveLength(n), { timeout: 5000 });
}

/**
 * What a message sent from the composer would be sent to, as the reader reads it.
 *
 * Read from the composer rather than from the picker, because that is where the
 * reader would look: the choice is made in a dialog that closes, and the question
 * this answers is whether what they chose is the thing still on show afterwards.
 */
function inUse(): string {
  return document.querySelector<HTMLElement>("[data-in-use]")?.textContent ?? "";
}

/** Opens Settings, which is where the Endpoint and Model are chosen. */
function openSettings() {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  return screen.getByRole("dialog");
}

/** Leaves Settings, so the reader is back at the Conversation rather than over it. */
function closeSettings() {
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
}

/** The Endpoint the picker is on, as the reader would read it. */
function chosenEndpoint(): string {
  return (screen.getByLabelText("Endpoint") as HTMLSelectElement).value;
}

/**
 * Waits for the picker to be showing `endpointId`.
 *
 * The pickers are mounted only while Settings is open, and each opening asks the
 * app's server for the Registry again — so it is briefly empty while that is in
 * flight. An assertion that samples it at that moment reads "" and fails for a
 * reason that has nothing to do with what is under test.
 */
async function pickerShows(endpointId: string) {
  await waitFor(() => expect(chosenEndpoint()).toBe(endpointId), { timeout: 5000 });
}

/**
 * Puts the app on an Endpoint other than the one it opens on.
 *
 * Ollama is what the page opens on and what every other test here uses, so a
 * regression that quietly sent everything back to Ollama would pass every other
 * test in this file. Choosing a second Endpoint is what makes the mistake
 * visible.
 */
async function chooseSecondEndpoint() {
  openSettings();
  await waitFor(() => expect(chosenEndpoint()).toBe("ollama"));

  // LM Studio rather than a Cloud Endpoint: it sits beside Ollama in the
  // Registry, so nothing about a Cloud Endpoint's configuration has to hold for
  // it to be listed. Being a different Endpoint is all this needs.
  fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "lmstudio" } });

  await pickerShows("lmstudio");
  closeSettings();
}

describe("the Endpoint and Model chosen survive a Conversation switch", () => {
  it("keeps them when starting a new Conversation", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    await chooseSecondEndpoint();
    send("First question");
    // Waited for the Response to land, not just for the request to be made:
    // switching Conversations mid-stream is a different thing, and a save that
    // has not happened yet means there is no Conversation to switch away from.
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");

    // The second message goes where the first one did. Falling back to the
    // Endpoint the page opens on would send it somewhere the reader never chose.
    await waitFor(() => expect(askedFor).toHaveLength(2), { timeout: 5000 });
    expect(askedFor[1].endpointId).toBe(askedFor[0].endpointId);

    // Waited for the Response too, not just the request: the stub consumes its
    // next plan when the request reaches the server, which lands after the
    // interface records it. Ending here would let that land in the next test
    // and steal the first plan from its list.
    await waitFor(() => expect(screen.getByText(/Two\./)).toBeTruthy(), { timeout: 5000 });
  });

  it("keeps them when reopening a saved Conversation", async () => {
    plans = [["One."], ["Two."], ["Three."], ["Four."]];
    renderApp();

    // Two Conversations, so opening the first is a real switch rather than a
    // click on the row already open — only a switch remounts the chat.
    send("First question");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");
    await waitFor(() => expect(screen.getByText(/Two\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(2);

    await chooseSecondEndpoint();
    send("Third question");
    await waitFor(() => expect(screen.getByText(/Three\./)).toBeTruthy(), { timeout: 5000 });
    expect(askedFor[2].endpointId).toBe("lmstudio");

    // Opening the other Conversation remounts the chat; the choice must outlive it.
    fireEvent.click(screen.getByRole("button", { name: "First question" }));
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy());

    // Reopened to check the choice, rather than trusted: it is the one thing this
    // test exists to prove, and the picker is where it is kept.
    openSettings();
    await pickerShows("lmstudio");
    closeSettings();

    send("Fourth question");
    await waitFor(() => expect(askedFor).toHaveLength(4), { timeout: 5000 });
    expect(askedFor[3].endpointId).toBe("lmstudio");

    // Waited for the Response for the same reason as the test above: the stub
    // consumes the plan after the interface records the request, so ending on
    // the request lets it steal from the next test.
    await waitFor(() => expect(screen.getByText(/Four\./)).toBeTruthy(), { timeout: 5000 });
  });

  it("keeps the Model chosen for the Endpoint", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    // Chosen from the discovered list rather than typed: with a live server
    // answering, the picker is a list, and choosing from it is the act that
    // has to survive starting a new Conversation.
    openSettings();
    await waitFor(() => expect(screen.getByText(/reports 8 Models/)).toBeTruthy(), {
      timeout: 5000,
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "neohorse-1-4b-mlx" },
    });
    closeSettings();

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");

    // The Model is keyed by Endpoint and held above the remount, so a new
    // Conversation continues with the Model already chosen.
    await waitFor(() => expect(askedFor).toHaveLength(2), { timeout: 5000 });
    expect(askedFor[1].modelId).toBe("neohorse-1-4b-mlx");

    // Waited for the Response so the stub has consumed its plan before the
    // next test sets its own list — otherwise this request steals from it.
    await waitFor(() => expect(screen.getByText(/Two\./)).toBeTruthy(), { timeout: 5000 });
  });

  it("keeps a typed Model identifier through a Conversation switch", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    // An identifier discovery never listed is typed through the manual option,
    // which is a second act from picking — choosing the option first, then
    // typing into the field it opens.
    openSettings();
    await waitFor(() => expect(screen.getByText(/reports 8 Models/)).toBeTruthy(), {
      timeout: 5000,
    });
    const picker = screen.getByLabelText("Model") as HTMLSelectElement;
    const manual = [...picker.querySelectorAll("option")].find(
      (option) => option.text === "Type an identifier...",
    );
    expect(manual).toBeTruthy();
    fireEvent.change(picker, { target: { value: manual!.value } });

    const field = screen.getByLabelText("Model") as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
    fireEvent.change(field, { target: { value: "my-model" } });
    fireEvent.keyDown(field, { key: "Enter" });
    closeSettings();

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");

    await waitFor(() => expect(askedFor).toHaveLength(2), { timeout: 5000 });
    expect(askedFor[1].modelId).toBe("my-model");

    // Waited for the Response so the stub has consumed its plan before the
    // next test sets its own list.
    await waitFor(() => expect(screen.getByText(/Two\./)).toBeTruthy(), { timeout: 5000 });
  });

  it("still opens on the Endpoint the page chose", async () => {
    plans = [["One."]];
    renderApp();

    send("First question");

    await waitFor(() => expect(askedFor).toHaveLength(1), { timeout: 5000 });
    expect(askedFor[0].endpointId).toBe("ollama");

    // Waited for the Response for the same cross-test reason as above.
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
  });
});

describe("the Endpoint and Model in use are shown while chatting", () => {
  it("says which Endpoint and Model a message will go to", () => {
    renderApp();

    // Shown before anything is sent, not only once there is a Conversation: the
    // first message is chosen under the same uncertainty as the hundredth.
    expect(inUse()).toContain("Ollama");
    expect(inUse()).toContain("llama3.2");
  });

  it("follows a new Endpoint and Model, once Settings is closed again", async () => {
    plans = [["One."]];
    renderApp();

    await chooseSecondEndpoint();

    openSettings();
    await waitFor(() => expect(screen.getByText(/reports 8 Models/)).toBeTruthy(), {
      timeout: 5000,
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "neohorse-1-4b-mlx" },
    });
    closeSettings();

    // The dialog is gone, so this can only be the composer reading the choice
    // rather than the picker echoing it back. Naming the previous Endpoint or
    // Model here would leave the reader typing into a composer that says one
    // thing while the Request carries another.
    expect(inUse()).toContain("LM Studio");
    expect(inUse()).toContain("neohorse-1-4b-mlx");
    expect(inUse()).not.toContain("llama3.2");

    // And it is what the next message actually reaches — the readout and the
    // Request are the same pair or the readout is decoration.
    send("First question");
    await waitFor(() => expect(askedFor).toHaveLength(1), { timeout: 5000 });
    expect(askedFor[0]).toEqual({ endpointId: "lmstudio", modelId: "neohorse-1-4b-mlx" });

    // Waited for the Response for the same cross-test reason as elsewhere above.
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
  });
});

describe("the Endpoint and Model chosen survive a reload", () => {
  it("opens again on what the reader last chose", async () => {
    plans = [["One."]];
    const first = renderApp();

    await chooseSecondEndpoint();

    // A Model chosen too, because the two are kept apart and either could
    // quietly be the one that did not survive.
    openSettings();
    await waitFor(() => expect(screen.getByText(/reports 8 Models/)).toBeTruthy(), {
      timeout: 5000,
    });
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "neohorse-1-4b-mlx" },
    });
    closeSettings();

    first.unmount();

    // A fresh mount is what a reload looks like from in here: nothing is carried
    // over in memory, so what opens is what was kept.
    renderApp();

    // Checked in the picker rather than trusted, because that is where the
    // reader would look to see whether it took.
    openSettings();
    await pickerShows("lmstudio");
    await waitFor(() => expect(screen.getByText(/reports 8 Models/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("neohorse-1-4b-mlx");
    closeSettings();

    // And in the Request that follows, which is where it actually matters: a
    // Conversation held with the Endpoint the reader chose is the whole point.
    send("First question");

    await waitFor(() => expect(askedFor).toHaveLength(1), { timeout: 5000 });
    expect(askedFor[0].endpointId).toBe("lmstudio");
    expect(askedFor[0].modelId).toBe("neohorse-1-4b-mlx");

    // Waited for the Response for the same cross-test reason as above.
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
  });
});

describe("a Conversation survives a reload", () => {
  it("reopens with the Turns it was left holding", async () => {
    plans = [["A", "lint", "rule", "fired."]];
    const first = renderApp();

    send("Why is the build red?");
    await waitFor(() => expect(screen.getByText(/A lint rule fired/)).toBeTruthy(), {
      timeout: 5000,
    });
    await savedCount(1);

    first.unmount();

    // A fresh mount is what a reload looks like from in here.
    renderApp();

    await waitFor(() => expect(names()).toEqual(["Why is the build red?"]), { timeout: 5000 });

    // Opening it is a click, not something that happens on load: the Turns are
    // shown because they were stored, not because they were fetched.
    fireEvent.click(screen.getByRole("button", { name: "Why is the build red?" }));

    // Scoped to the Turns, because the list carries the same words as a row and
    // a plain text query matches both — which had this passing on the row alone.
    // Generous timeouts: under a full parallel suite this test starves
    // intermittently, and a reload path failing one run in four is a broken
    // test whatever the cause.
    await waitFor(
      () => expect(turnsOnScreen()).toContain("Why is the build red?"),
      { timeout: 10000 },
    );
    expect(screen.getByText(/A lint rule fired/)).toBeTruthy();
  }, 20000);

  it("opens on an empty Conversation after a reload, not the last one", async () => {
    plans = [["A", "lint", "rule", "fired."]];
    const first = renderApp();

    send("Why is the build red?");
    await waitFor(() => expect(screen.getByText(/A lint rule fired/)).toBeTruthy(), {
      timeout: 5000,
    });
    await savedCount(1);
    first.unmount();

    renderApp();

    // A reload lands on a fresh Conversation rather than reopening whatever was
    // last in use, so the reader is never dropped into Turns they did not ask
    // for — and the list is there to open one deliberately.
    await waitFor(() => expect(names()).toHaveLength(1));
    expect(turnsOnScreen()).toEqual([]);
  });

  it("names it after the first message, not the last", async () => {
    plans = [["A", "lint", "rule", "fired."], ["No."]];
    renderApp();

    send("Why is the build red?");
    await waitFor(() => expect(screen.getByText(/lint rule fired/)).toBeTruthy(), {
      timeout: 5000,
    });
    await savedCount(1);

    send("And on main?");
    await waitFor(() => expect(screen.getByText(/No\./)).toBeTruthy(), { timeout: 5000 });

    // The name is derived once, when the Conversation gets its first Turn.
    await waitFor(() => expect(names()).toEqual(["Why is the build red?"]));
  });

  it("cuts a long first message to a name", async () => {
    plans = [["Here", "goes."]];
    renderApp();

    send("Explain how the deployment pipeline handles rollback of a failed migration");
    await waitFor(() => expect(screen.getByText(/Here goes/)).toBeTruthy(), { timeout: 5000 });

    // The name is cut at a word boundary, so it does not end mid-word.
    await waitFor(() => expect(names()).toEqual(["Explain how the deployment…"]), {
      timeout: 5000,
    });
  });

  it("lists newest first", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");
    await waitFor(() => expect(screen.getByText(/Two\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(2);

    await waitFor(() => expect(names()).toEqual(["Second question", "First question"]));
  });
});

describe("switching between Conversations", () => {
  it("shows the Turns of the one opened", async () => {
    plans = [["First", "answer."], ["Second", "answer."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/First answer/)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");
    await waitFor(() => expect(screen.getByText(/Second answer/)).toBeTruthy(), { timeout: 5000 });
    await savedCount(2);

    // Opening the older one must not leave the newer one's Turns on screen.
    fireEvent.click(screen.getByRole("button", { name: "First question" }));

    await waitFor(() => {
      expect(screen.getByText(/First answer/)).toBeTruthy();
      expect(screen.queryByText(/Second answer/)).toBeNull();
    });
  });

  it("does not write the new Turns into the Conversation just left open", async () => {
    plans = [["First", "answer."], ["Second", "answer."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/First answer/)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");
    await waitFor(() => expect(screen.getByText(/Second answer/)).toBeTruthy(), { timeout: 5000 });
    await savedCount(2);

    // Each row still names the question it was opened with, which it would stop
    // doing if one Conversation's Turns had been written over the other.
    await waitFor(() => expect(names()).toEqual(["Second question", "First question"]));

    fireEvent.click(screen.getByRole("button", { name: "Second question" }));
    await waitFor(() => expect(screen.getByText(/Second answer/)).toBeTruthy());
    expect(screen.queryByText(/First answer/)).toBeNull();
  });
});

describe("starting a new Conversation from the list", () => {
  it("clears the Turns of the one left open", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    // The list's own New, which is a different control from the composer's and
    // does not pass through the chat at all.
    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);

    // Leaving the old Turns on screen would mean the next message was sent into
    // a Conversation the reader believes is empty — and saved under it. Scoped
    // to the Turns, since the list still names the Conversation it saved.
    await waitFor(() => expect(document.querySelectorAll("[data-turn]")).toHaveLength(0));
    expect(names()).toEqual(["First question"]);
  });

  it("keeps the saved Conversation intact", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);

    // The Turns move to a new Conversation rather than being destroyed with the
    // view of the old one.
    fireEvent.click(screen.getByRole("button", { name: "First question" }));
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy());
  });
});

describe("a Response that takes longer than the save", () => {
  it("still arrives, because the save must not disturb the stream", async () => {
    plans = [["Slow.", "answer."]];
    // Silent for a full second: a cold Model loads before its first token, and
    // the save lands inside that silence. Three times the debounce, so this is
    // not close to the boundary on either side.
    streamDelayMs = 1000;
    renderApp();

    send("Slow question");

    // The save fires while the stream is still waiting — and then the stream
    // answers anyway. If the save remounted the chat, the wait would be
    // aborted with it and this would time out on nothing arriving.
    await waitFor(() => expect(screen.getByText(/Slow\. answer\./)).toBeTruthy(), {
      timeout: 8000,
    });
    expect(askedFor).toHaveLength(1);
  }, 15000);

  it("saves the finished Conversation under one name, not two", async () => {
    plans = [["Slow.", "answer."]];
    streamDelayMs = 1000;
    renderApp();

    send("Slow question");
    await waitFor(() => expect(screen.getByText(/Slow\. answer\./)).toBeTruthy(), {
      timeout: 8000,
    });

    // One save mid-stream and one after it must not mint two Conversations for
    // one chat: the second save has to reuse the first save's Conversation.
    await savedCount(1);
    expect(names()).toEqual(["Slow question"]);
  }, 15000);
});

describe("chatting with a Model picked from discovery", () => {
  it("sends the picked identifier to the Endpoint, which is what loads it", async () => {
    plans = [["Hello."]];
    renderApp();

    await chooseSecondEndpoint();

    // Picked from the list discovery returned — not typed — so this is the act
    // the reader performs against a live server, listing and all. Awaited via
    // the status line, because while discovery is in flight the picker is its
    // manual field and holding that element would wait on options forever.
    openSettings();
    await waitFor(() => expect(screen.getByText(/reports 8 Models/)).toBeTruthy(), {
      timeout: 5000,
    });
    const picker = screen.getByLabelText("Model") as HTMLSelectElement;
    expect([...picker.querySelectorAll("option")].map((option) => option.value)).toContain(
      "ling-3.0-tiny-abliterated-apex",
    );
    fireEvent.change(picker, { target: { value: "ling-3.0-tiny-abliterated-apex" } });
    closeSettings();

    send("Say hello");

    // Two assertions because there are two places this can be wrong: the
    // interface has to send the picked identifier, and the server has to
    // forward it untouched. A server loading any other Model — its default, or
    // nothing at all — is this test failing at the stub rather than in words.
    await waitFor(() => expect(screen.getByText(/Hello\./)).toBeTruthy(), { timeout: 5000 });
    expect(askedFor[0]).toEqual({
      endpointId: "lmstudio",
      modelId: "ling-3.0-tiny-abliterated-apex",
    });
    expect(loadedModels).toEqual(["ling-3.0-tiny-abliterated-apex"]);
  });
});

describe("renaming and deleting", () => {
  it("keeps a renamed name through a further Turn", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    send("Why is the build red?");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getByRole("button", { name: /Rename Why is the build red/ }));
    fireEvent.change(screen.getByLabelText("Conversation name"), {
      target: { value: "Build triage" },
    });
    fireEvent.keyDown(screen.getByLabelText("Conversation name"), { key: "Enter" });

    await waitFor(() => expect(names()).toEqual(["Build triage"]));

    send("And on main?");
    await waitFor(() => expect(screen.getByText(/Two\./)).toBeTruthy(), { timeout: 5000 });

    // The save that follows a rename reuses the name rather than deriving it
    // again, so the rename does not silently undo itself.
    await waitFor(() => expect(names()).toEqual(["Build triage"]));
  });

  it("forgets a deleted Conversation and leaves the rest", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");
    await waitFor(() => expect(screen.getByText(/Two\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(2);

    fireEvent.click(screen.getByRole("button", { name: /Delete Second question/ }));

    await waitFor(() => expect(names()).toEqual(["First question"]));
  });

  it("forgets every Conversation, and only once the reader confirms", async () => {
    plans = [["One."], ["Two."]];
    renderApp();

    send("First question");
    await waitFor(() => expect(screen.getByText(/One\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(1);

    fireEvent.click(screen.getAllByRole("button", { name: "New" })[0]);
    send("Second question");
    await waitFor(() => expect(screen.getByText(/Two\./)).toBeTruthy(), { timeout: 5000 });
    await savedCount(2);

    openSettings();

    // The count is the app's own, not a number handed to the dialog: it has to be
    // the same one the list beside it is showing, or the reader is asked to agree
    // to something different from what they can see.
    expect(screen.getByText("2 saved.")).toBeTruthy();

    // Cancelling first, because the whole point is that nothing has happened yet
    // and a test that only ever confirms would not notice if it had.
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Newest first, as the list always is.
    expect(names()).toEqual(["Second question", "First question"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));

    // The list behind the dialog empties, and the Conversation being read is
    // closed to an empty one rather than left showing Turns stored nowhere.
    await waitFor(() => expect(screen.getByText("None saved.")).toBeTruthy());
    expect(names()).toEqual([]);
    expect(turnsOnScreen()).toEqual([]);
  });
});
