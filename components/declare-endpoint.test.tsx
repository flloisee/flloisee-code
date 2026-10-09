// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeclareEndpoint } from "@/components/declare-endpoint";
import type { EndpointStatus } from "@/lib/endpoints/status";

/**
 * Adding an Endpoint of one's own, as the reader meets it.
 *
 * What is asserted is what the interface promises and what it must never do:
 * that the Credential is emptied the moment it has been sent, that a Credential
 * stored-but-not-in-use is not reported as stored, and that the button is not
 * offered where the route would refuse.
 *
 * The route refuses outside development, so each render is done as a dev server
 * would be — the same arrangement `key-entry.test.tsx` uses and for the same
 * reason.
 */

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  runAsEnvironment(originalNodeEnv);
});

function runAsEnvironment(value: string | undefined) {
  // NODE_ENV is declared read-only, which is the framework's to own; a test that
  // sets it on purpose is the one thing that has to go around that. The same
  // arrangement `key-entry.test.tsx` uses.
  const environment = process.env as Record<string, string | undefined>;

  if (value === undefined) {
    delete environment.NODE_ENV;
  } else {
    environment.NODE_ENV = value;
  }
}

const DECLARED: EndpointStatus = {
  id: "my-server",
  name: "My server",
  credentialEnvVar: null,
  configured: true,
  group: "declared",
  defaultModelId: "qwen3-coder",
};

const DECLARED_WITH_KEY: EndpointStatus = {
  ...DECLARED,
  credentialEnvVar: "CUSTOM_MY_SERVER_API_KEY",
};

/** What the declaration route answers with, one call at a time. */
type Reply = { status: number; body: unknown };

function routeAnswers(reply: (body: Record<string, unknown>) => Reply) {
  const sent: Record<string, unknown>[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      sent.push(body);

      const { status, body: replyBody } = reply(body);
      return new Response(JSON.stringify(replyBody), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );

  return sent;
}

const STORED: Reply = {
  status: 200,
  body: {
    endpoint: {
      id: "my-server",
      name: "My server",
      baseURL: "http://localhost:8000/v1",
      defaultModelId: "qwen3-coder",
      knownModels: ["qwen3-coder"],
    },
    credential: { written: false, envVar: null, reason: "notNeeded" },
  },
};

/** A successful declaration that also stored a Credential. */
const STORED_WITH_KEY: Record<string, unknown> = {
  endpoint: {
    id: "my-server",
    name: "My server",
    baseURL: "http://localhost:8000/v1",
    defaultModelId: "qwen3-coder",
    knownModels: ["qwen3-coder"],
    credentialEnvVar: "CUSTOM_MY_SERVER_API_KEY",
  },
  credential: {
    written: true,
    envVar: "CUSTOM_MY_SERVER_API_KEY",
    applied: false,
    shadowedByShell: true,
  },
};

function renderDialog(declared: readonly EndpointStatus[] = []) {
  runAsEnvironment("development");
  const onChanged = vi.fn();
  const onStored = vi.fn();
  render(<DeclareEndpoint declared={declared} onChanged={onChanged} onStored={onStored} />);

  fireEvent.click(screen.getByRole("button", { name: /add your own endpoint/i }));
  return { onChanged, onStored };
}

async function fill(name: string, url: string, models: string[] = ["qwen3-coder"]) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: url } });

  // The dialog starts with one row; the rest are added the way a reader would.
  for (let index = 1; index < models.length; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: /add another model/i }));
  }

  models.forEach((model, index) => {
    fireEvent.change(screen.getByLabelText(`Model ${index + 1}`), { target: { value: model } });
  });
}

function theCredentialField() {
  return screen.getByLabelText(/Credential/i) as HTMLInputElement;
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Add Endpoint" }));
}

describe("the button to add an Endpoint", () => {
  it("is offered where the route would accept it", () => {
    runAsEnvironment("development");
    render(<DeclareEndpoint declared={[]} onChanged={vi.fn()} onStored={vi.fn()} />);

    expect(screen.getByRole("button", { name: /add your own endpoint/i })).toBeTruthy();
  });

  it("is not offered outside development, rather than offering one that can only fail", () => {
    // The route answers 404 there. A button that could only fail is worse than
    // no button, because it looks like a capability the app has.
    runAsEnvironment("production");
    render(<DeclareEndpoint declared={[]} onChanged={vi.fn()} onStored={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /add your own endpoint/i })).toBeNull();
  });
});

describe("declaring an Endpoint", () => {
  it("sends the name, the address, and the Models the reader gave", async () => {
    const sent = routeAnswers(() => STORED);
    renderDialog();

    await fill("My server", "http://localhost:8000/v1", ["qwen3-coder", "llama3.2"]);
    submit();

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      action: "declare",
      name: "My server",
      baseURL: "http://localhost:8000/v1",
      models: ["qwen3-coder", "llama3.2"],
    });
  });

  it("adds another Model row rather than making the reader retype the first", async () => {
    routeAnswers(() => STORED);
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /add another model/i }));

    // The first row kept what it had: a list the reader has to rebuild from
    // nothing each time is worse than one more row.
    expect((screen.getByLabelText("Model 1") as HTMLInputElement).value).toBe("");
    await fill("My server", "http://localhost:8000/v1", ["first", "second"]);
    expect((screen.getByLabelText("Model 2") as HTMLInputElement).value).toBe("second");
  });

  it("cannot be sent without an address, since there would be nowhere to send it", async () => {
    const sent = routeAnswers(() => STORED);
    renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My server" } });

    expect((screen.getByRole("button", { name: "Add Endpoint" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(sent).toHaveLength(0);
  });

  it("says the Credential is not needed rather than saying nothing", async () => {
    // The ordinary case for a server on the reader's own machine. Silence here
    // would read as a failure where there was none.
    routeAnswers(() => STORED);
    renderDialog();

    await fill("My server", "http://localhost:8000/v1");
    submit();

    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("needs no Credential"),
    );
  });

  it("shows what the route refused, rather than a bare failure", async () => {
    routeAnswers(() => ({ status: 400, body: { error: "That is not a URL this app can reach." } }));
    renderDialog();

    await fill("My server", "not a url");
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain("not a URL this app can reach");
  });
});

describe("the Credential field", () => {
  it("is emptied the moment it has been sent, whether or not it was accepted", async () => {
    // The only copy of a Credential that should ever exist in the browser is the
    // one being typed, and this is what stops a failed save from leaving it on
    // screen behind a dialog the reader has to trust.
    routeAnswers(() => ({ status: 400, body: { error: "Nothing was written." } }));
    renderDialog();

    await fill("My server", "http://localhost:8000/v1");
    fireEvent.change(theCredentialField(), { target: { value: "sk-a-secret" } });
    submit();

    await screen.findByRole("alert");
    expect(theCredentialField().value).toBe("");
  });

  it("is never sent when it was left empty", async () => {
    const sent = routeAnswers(() => STORED);
    renderDialog();

    await fill("My server", "http://localhost:8000/v1");
    submit();

    await waitFor(() => expect(sent).toHaveLength(1));
    // Absent rather than an empty string: a blank password field is a blank
    // field, and sending one as a Credential would be a zero-length secret.
    expect(sent[0]).not.toHaveProperty("credential");
  });

  it("is not echoed back into the page by the confirmation", async () => {
    routeAnswers(() => STORED);
    renderDialog();

    await fill("My server", "http://localhost:8000/v1");
    fireEvent.change(theCredentialField(), { target: { value: "sk-never-echoed" } });
    submit();

    await screen.findByRole("status");
    expect(document.body.textContent).not.toContain("sk-never-echoed");
  });

  it("reports a Credential written but shadowed, rather than as stored and in use", async () => {
    // Saying "in use now" here would send the reader off to send a message and
    // fail: the file is written, but their shell is serving something else.
    routeAnswers(() => ({ status: 200, body: STORED_WITH_KEY }));
    renderDialog();

    await fill("My server", "http://localhost:8000/v1");
    fireEvent.change(theCredentialField(), { target: { value: "sk-a-key" } });
    submit();

    const message = await screen.findByRole("status");
    expect(message.textContent).not.toContain("in use now");
    expect(message.textContent).toContain("CUSTOM_MY_SERVER_API_KEY");
  });

  it("leaves the dialog open after a Credential, so what became of it can be read", async () => {
    // The picker looks identical whether a key was stored and is shadowed or
    // was never typed, so the only place that outcome is visible is here.
    routeAnswers(() => ({ status: 200, body: STORED_WITH_KEY }));
    const { onStored, onChanged } = renderDialog();

    await fill("My server", "http://localhost:8000/v1");
    fireEvent.change(theCredentialField(), { target: { value: "sk-a-key" } });
    submit();

    await screen.findByRole("status");
    expect(onStored).toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

describe("removing an Endpoint the reader added", () => {
  it("says which variable the stored Credential will be taken out of", async () => {
    // A Credential in a file the reader cannot see from here would otherwise be a
    // secret they did not know they were deleting.
    routeAnswers(() => ({ status: 200, body: { forgotten: "my-server" } }));
    renderDialog([DECLARED_WITH_KEY]);

    expect(screen.getByText(/CUSTOM_MY_SERVER_API_KEY/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says an Endpoint needing no Credential takes nothing else with it", async () => {
    routeAnswers(() => ({ status: 200, body: { forgotten: "my-server" } }));
    renderDialog([DECLARED]);

    expect(screen.getByText(/needs no Credential/i)).toBeTruthy();
  });

  it("is not offered for Endpoints that are not the reader's own", () => {
    runAsEnvironment("development");
    const onChanged = vi.fn();
    const onStored = vi.fn();
    render(<DeclareEndpoint declared={[]} onChanged={onChanged} onStored={onStored} />);
    fireEvent.click(screen.getByRole("button", { name: /add your own endpoint/i }));

    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
