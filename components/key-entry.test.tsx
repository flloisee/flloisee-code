// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EndpointPicker } from "@/components/endpoint-picker";
import type { EndpointStatus } from "@/lib/endpoints/status";

/**
 * Key Entry: entering a Cloud Endpoint's Credential through the interface.
 *
 * These drive the reader's own controls — the Endpoint picker and the modal it
 * opens — rather than any function inside them. `fetch` is stubbed because it is
 * the boundary between the browser and this app's server; nothing about how a
 * Credential is stored or read is asserted here, only what the interface shows
 * and what it sends. The model layer is never mocked.
 *
 * The Registry fixture is mutable on purpose: a real save makes the Endpoint
 * Configured on the server, so the next read of the Registry says so. Flipping it
 * here models that, and makes the claim under test the honest one — that the
 * interface reports the Endpoint Configured after the save, without a reload of
 * the page or a restart of the server.
 */

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  runAsEnvironment(originalNodeEnv);
});

const LOCAL: Status = {
  id: "ollama",
  name: "Ollama",
  credentialEnvVar: null,
  configured: true,
  group: "local",
};
const CLOUD_READY: Status = {
  id: "openrouter",
  name: "OpenRouter",
  credentialEnvVar: "OPENROUTER_API_KEY",
  configured: true,
  group: "recommended",
};
const CLOUD_BARE: Status = {
  id: "groq",
  name: "Groq",
  credentialEnvVar: "GROQ_API_KEY",
  configured: false,
  group: "recommended",
};

/** What the Registry route answers with: one Endpoint, or several. */
type Status = EndpointStatus;
type KeyEntryReply = { status: number; body: unknown };

/**
 * Next declares NODE_ENV read-only because the framework owns it, and these tests
 * set it deliberately — the key entry route refuses to run outside development,
 * and the interface offers the affordance on the same condition. This is the one
 * thing that has to go around that.
 */
function runAsEnvironment(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

/** What the key entry route is answering, rewritten per test. */
let keyEntryReplies: (body: { envVar: string; credential: string }) => KeyEntryReply;
let entered: { envVar: string; credential: string }[];

function appAnswers(statuses: () => Status[], reply?: (body: { envVar: string; credential: string }) => KeyEntryReply) {
  entered = [];
  keyEntryReplies =
    reply ??
    (() => ({ status: 200, body: { envVar: "GROQ_API_KEY", applied: true, shadowedByShell: false } }));

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const json = (body: unknown, status: number) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });

      if (url === "/api/endpoints") return json({ endpoints: statuses() }, 200);

      if (url === "/api/keys") {
        const body = JSON.parse(init.body as string);
        entered.push(body);
        const { status, body: replyBody } = keyEntryReplies(body);
        return json(replyBody, status);
      }

      throw new Error(`Unexpected request to ${url}`);
    }),
  );
}

/** The picker as the reader meets it, on a given Endpoint. */
function renderApp(endpointId = "groq", statuses: () => Status[] = () => [LOCAL, CLOUD_BARE, CLOUD_READY], reply?: (body: { envVar: string; credential: string }) => KeyEntryReply) {
  // The key entry route refuses to run outside development, and the interface
  // offers the affordance on the same condition. Vitest sets NODE_ENV to "test",
  // so each of these renders is done as a dev server would be.
  runAsEnvironment("development");

  appAnswers(statuses, reply);
  const onSelect = vi.fn();
  render(<EndpointPicker endpointId={endpointId} onSelect={onSelect} />);
  return { onSelect };
}

/** Opens Key Entry for the chosen Endpoint, from where the reader reaches it. */
async function openKeyEntry() {
  fireEvent.click(await screen.findByRole("button", { name: /Credential/i }));
  return screen.findByRole("dialog");
}

async function typeAndSubmit(dialog: HTMLElement, credential: string) {
  fireEvent.change(within(dialog).getByLabelText(/Credential/i), {
    target: { value: credential },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: /Save|Store/i }));
}

/**
 * The picker's own line about the chosen Endpoint.
 *
 * Scoped because the open dialog has a live region of its own confirming the
 * save — two regions reporting, each about a different thing.
 */
function pickerStatus(): string {
  const [picker] = screen.getAllByRole("status").filter((element) => !element.closest("[role=dialog]"));
  return picker.textContent ?? "";
}

describe("entering a Credential", () => {
  it("sends it to the app's server under the variable name the Catalog declares", async () => {
    renderApp("groq");

    await typeAndSubmit(await openKeyEntry(), "gsk-typed-by-hand");

    await waitFor(() => expect(entered).toHaveLength(1));
    // The Endpoint's id, not its variable name. The route refuses anything but a
    // declared variable name, and the Registry is what converts one to the other.
    expect(entered[0]).toEqual({ envVar: "GROQ_API_KEY", credential: "gsk-typed-by-hand" });
  });

  it("makes the Endpoint Configured, with no restart and no reload of the page", async () => {
    // The Registry answers as the server would after a save: the Credential is
    // now in the environment, so this Endpoint is Configured from then on.
    let configured = false;
    renderApp("groq", () => [
      LOCAL,
      { ...CLOUD_BARE, configured },
      CLOUD_READY,
    ]);

    await waitFor(() => expect(pickerStatus()).toContain("Groq has no Credential"));

    await typeAndSubmit(await openKeyEntry(), "gsk-live-123");
    configured = true;

    // The interface re-reads the Registry rather than guessing, so what it shows
    // is what the server now holds.
    await waitFor(() => expect(pickerStatus()).toContain("Groq is Configured"));
  });

  it("offers the Endpoint in the list as Configured, so a missing key is never found by a failed request", async () => {
    renderApp("groq", () => [LOCAL, CLOUD_BARE, CLOUD_READY]);

    const list = await screen.findByRole("combobox");
    const offered = [...list.querySelectorAll("option")].map((option) => option.textContent);

    expect(offered).toContain("Groq — no Credential");
    expect(offered).toContain("OpenRouter");
  });

  // The spec asks the interface to stay usable in a window narrow enough to sit
  // beside a terminal (story 36). That is a layout property, and jsdom has no
  // layout engine: it reports every element's width and height as 0 whether the
  // stylesheet says `w-full` or a fixed `640px`. A test could only assert the
  // class names back, which would pass on a dialog that overflows and fail on one
  // that does not — it would pin the fix rather than the behaviour. So the
  // claim is not tested here at all. What is left is the part a reader can
  // actually be blocked by, which the next test does check.
  it("keeps everything needed to finish reachable, since nothing else is on the way", async () => {
    renderApp("groq");

    const dialog = await openKeyEntry();

    // The field to type into, and the control that submits it, both present and
    // usable — a reader who has to scroll a dialog to find Save has lost the
    // affordance however good the scrolling is.
    const field = within(dialog).getByLabelText(/Credential/i);
    const save = within(dialog).getByRole("button", { name: /Save|Store/i });

    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(field, { target: { value: "gsk-typed" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(entered).toHaveLength(1));

    expect(within(dialog).getByRole("button", { name: /Close/i })).toBeTruthy();
  });

  it("keeps the field usable at any window width, because nothing sizes it in pixels", async () => {
    renderApp("groq");

    const dialog = await openKeyEntry();

    // A fixed pixel width or height is the one thing that genuinely cannot
    // shrink with the window, and it is the only measurement a layout-free DOM
    // can still tell is wrong. Every other bound — percentages, viewport units,
    // max-width with overflow — resolves against the window and is invisible
    // here, so this checks the absence of the failure rather than the fix.
    expect(dialog.className).not.toMatch(/\d+px/);
    expect(dialog.getAttribute("style")).toBeNull();
  });
});

describe("which Endpoints are Configured", () => {
  it("is visible for each Endpoint at a glance, without discovering it by a failed request", async () => {
    renderApp("groq", () => [LOCAL, CLOUD_BARE, CLOUD_READY]);

    const list = await screen.findByRole("combobox");
    const offered = [...list.querySelectorAll("option")].map((option) => option.textContent);

    // Every Endpoint is listed either way. One missing its Credential is marked
    // as such rather than hidden, since a hidden Endpoint is one the reader never
    // knew existed and cannot go and fix.
    expect(offered).toContain("Groq — no Credential");
    expect(offered).toContain("OpenRouter");
    expect(offered).toContain("Ollama");
  });

  it("names the variable each missing Credential belongs in, never any value", async () => {
    renderApp("groq");

    await waitFor(() => expect(pickerStatus()).toContain("GROQ_API_KEY"));
    // The whole Registry is named by variable and by state, and nothing anywhere
    // on the page is a Credential.
    expect(document.body.textContent).not.toMatch(/sk-[a-z0-9]/i);
  });

  it("shows a Local Endpoint as Configured from the start, needing no Credential", async () => {
    renderApp("ollama", () => [LOCAL, CLOUD_BARE, CLOUD_READY]);

    await waitFor(() =>
      expect(pickerStatus()).toContain("Ollama runs on this machine and needs no Credential"),
    );
  });

  it("re-reads the Registry after a save, so the Endpoint shown as Configured is the one the server holds", async () => {
    let configured = false;
    let reads = 0;
    runAsEnvironment("development");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/keys") {
          return new Response(
            JSON.stringify({ envVar: "GROQ_API_KEY", applied: true, shadowedByShell: false }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        reads += 1;
        return new Response(
          JSON.stringify({ endpoints: [LOCAL, { ...CLOUD_BARE, configured }, CLOUD_READY] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    render(<EndpointPicker endpointId="groq" onSelect={vi.fn()} />);

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, "gsk-live-123");
    configured = true;

    await waitFor(() => expect(pickerStatus()).toContain("Groq is Configured"));
    // Two reads: the one on open, and the one the save caused. The second is what
    // makes this work without a restart — a list that was not re-read would still
    // be showing the answer from before the Credential existed.
    expect(reads).toBe(2);
  });
});

describe("a Credential written but not yet in use", () => {
  // Neither of the two outcomes above: the file has it, and the environment is
  // not serving a different value — it is serving nothing at all. The route says
  // so with `applied: false, shadowedByShell: false`, which is a real state: a
  // loader that rebuilds process.env from its own snapshot drops a name the
  // snapshot never had. Saying "no restart needed" here would be the same lie as
  // the shadowed case, so it gets its own wording rather than the stored one.
  const notApplied = () => ({
    status: 200,
    body: { envVar: "GROQ_API_KEY", applied: false, shadowedByShell: false },
  });

  it("is not reported as stored, since the environment is not carrying it yet", async () => {
    renderApp("groq", undefined, notApplied);

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, "gsk-written-but-not-live");

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());

    const said = within(dialog).getByRole("alert").textContent ?? "";
    expect(said).toContain("GROQ_API_KEY");
    // The one sentence that would be a lie: the value is not in use.
    expect(said).not.toContain("no restart needed");
  });
});

describe("a Credential a shell export is shadowing", () => {
  // The file was written, so it is stored — and the shell is serving a different
  // value, so the Endpoint is not being called with what was just typed. This is
  // the one outcome where a bare success would send someone off to send a message
  // and fail, so it gets its own wording rather than the stored one.
  const shadowed = () => ({
    status: 200,
    body: { envVar: "GROQ_API_KEY", applied: false, shadowedByShell: true },
  });

  it("is reported as shadowed, not as a saved Credential that is now in use", async () => {
    renderApp("groq", undefined, shadowed);

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, "gsk-typed-but-not-the-one-used");

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());

    const said = within(dialog).getByRole("alert").textContent ?? "";
    expect(said).toContain("exported in your shell");
    expect(said).toContain("GROQ_API_KEY");
    // The one sentence this outcome must never contain.
    expect(said).not.toContain("no restart needed");
  });

  it("says what to do about it, since the fix is in the reader's shell and not in the app", async () => {
    renderApp("groq", undefined, shadowed);

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, "gsk-typed-but-not-the-one-used");

    const said = await waitFor(() => {
      const alert = within(dialog).getByRole("alert");
      expect(alert.textContent).toContain("Unset GROQ_API_KEY");
      return alert.textContent ?? "";
    });

    // It must be honest about the state it is in: the value written is not in use.
    expect(said).toContain("the one being used");
  });

  it("still empties the field, because the Credential was written either way", async () => {
    renderApp("groq", undefined, shadowed);

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, "gsk-typed-but-not-the-one-used");

    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
    expect((within(dialog).getByLabelText(/Credential/i) as HTMLInputElement).value).toBe("");
    expect(dialog.textContent).not.toContain("gsk-typed-but-not-the-one-used");
  });
});

describe("a Credential the app refuses to store", () => {
  it("shows what the route said, rather than a bare failure", async () => {
    renderApp("groq", undefined, () => ({
      status: 400,
      body: {
        error:
          "A Credential is stored as one line of the environment file, and this one has a " +
          "character that would not survive it. Nothing was written.",
      },
    }));

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, "sk-bad$dollar");

    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain("would not survive it"),
    );
    // Refused, so nothing is Configured and the interface must not claim it is.
    expect(pickerStatus()).toContain("Groq has no Credential");
  });

  it("does not claim success when the route cannot be reached at all", async () => {
    renderApp("groq");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, "gsk-typed-offline");

    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain(
        "Could not reach the app's Key Entry route",
      ),
    );
    expect(dialog.querySelector("[role=status]")).toBeNull();
  });
});

describe("a stored Credential", () => {
  const STORED = "gsk-stored-and-never-shown-again";

  it("is never rendered back into the field after a successful save", async () => {
    renderApp("groq");

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, STORED);

    await waitFor(() => expect(within(dialog).getByRole("status")).toBeTruthy());

    // The field is emptied the moment the Credential is sent, so what remains on
    // screen is a confirmation and a variable name — never the value again.
    expect((within(dialog).getByLabelText(/Credential/i) as HTMLInputElement).value).toBe("");
    expect(dialog.textContent).not.toContain(STORED);
    expect(document.body.innerHTML).not.toContain(STORED);
  });

  it("does not pre-fill the field for an Endpoint that is already Configured, even if the Registry offers one", async () => {
    // The Registry route never carries a Credential value, so this cannot
    // pre-fill today. It is written anyway because the guarantee is about the
    // interface rather than about today's route: if a future change to what
    // EndpointStatus carries ever let a value reach the browser, the field must
    // still not take it. A field that seeded itself from an answer would put a
    // stored Credential on screen unasked, which is the failure this rules out.
    const LEAKY = { ...CLOUD_READY, credential: "sk-or-leaked-by-the-route" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url === "/api/endpoints" ? { endpoints: [LOCAL, CLOUD_BARE, LEAKY] } : {};
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    runAsEnvironment("development");
    render(<EndpointPicker endpointId="openrouter" onSelect={vi.fn()} />);

    const dialog = await openKeyEntry();

    expect((within(dialog).getByLabelText(/Credential/i) as HTMLInputElement).value).toBe("");
    expect(dialog.textContent).not.toContain("sk-or-leaked-by-the-route");
  });

  it("is not kept when the dialog is closed and opened again", async () => {
    renderApp("groq");

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, STORED);
    fireEvent.click(within(dialog).getByRole("button", { name: /Close/i }));

    const reopened = await openKeyEntry();
    expect((within(reopened).getByLabelText(/Credential/i) as HTMLInputElement).value).toBe("");
  });

  it("is never echoed back into the page by the confirmation itself", async () => {
    renderApp("groq");

    const dialog = await openKeyEntry();
    await typeAndSubmit(dialog, STORED);

    await waitFor(() =>
      expect(within(dialog).getByRole("status").textContent).toContain("GROQ_API_KEY"),
    );
    // The variable name is the diagnostic; the value is not part of it.
    expect(within(dialog).getByRole("status").textContent).not.toContain(STORED);
  });
});

describe("where Key Entry is offered", () => {
  it("is offered for a Cloud Endpoint that has no Credential, since that is the one fix", async () => {
    renderApp("groq");

    expect(await screen.findByRole("button", { name: /Credential/i })).toBeTruthy();
  });

  it("is not offered for a Local Endpoint, which needs no Credential to begin with", async () => {
    renderApp("ollama");

    await screen.findByRole("combobox");
    expect(screen.queryByRole("button", { name: /Credential/i })).toBeNull();
  });

  it("is not offered where Key Entry cannot work, rather than offering a button that always fails", async () => {
    renderApp("groq");
    await screen.findByRole("button", { name: /Credential/i });

    // A deployed build is the case the route's 404 exists for.
    runAsEnvironment("production");
    cleanup();
    render(<EndpointPicker endpointId="groq" onSelect={vi.fn()} />);

    await screen.findByRole("combobox");
    expect(screen.queryByRole("button", { name: /Credential/i })).toBeNull();
  });
});
