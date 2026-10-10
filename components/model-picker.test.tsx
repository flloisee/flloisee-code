// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelPicker } from "@/components/model-picker";

/**
 * What the interface offers when discovery answers each way.
 *
 * These assert what the reader can see and do, not how the component is built:
 * the Model list an Endpoint reports, the identifier typed when it reports
 * none, and whether the reason is stated.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Answers discovery the way the Route Handler would. Rewritten per test. */
let answer: (endpointId: string) => { status: number; body: unknown };

function discoveryAnswers(route: (endpointId: string) => { status: number; body: unknown }) {
  answer = route;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { endpointId } = JSON.parse(init.body as string);
      const { status, body } = answer(endpointId);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

const found = (models: string[]) => ({
  status: 200,
  body: { endpointId: "ollama", result: { status: "found", models } },
});

function renderPicker(modelId = "llama3.2") {
  const onSelect = vi.fn();
  render(
    <ModelPicker
      endpointId="ollama"
      endpointName="Ollama"
      modelId={modelId}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

/**
 * The searched list, as the reader opens it.
 *
 * Pressing the control and waiting for the search field, because the rows only
 * exist while the panel does — anything else would test a list no reader has ever
 * been able to see.
 */
async function openList() {
  fireEvent.click(await screen.findByRole("button", { name: /Model/ }));
  return screen.findByRole("listbox", { name: "Models" });
}

/** The Model identifiers currently offered, in the order they are drawn. */
function offered(): string[] {
  return [...document.querySelectorAll("[data-model]")].map(
    (row) => row.getAttribute("data-model") ?? "",
  );
}

describe("a Model discovered from an Endpoint", () => {
  it("is offered as a searchable list rather than typed", async () => {
    discoveryAnswers(() => found(["llama3.2:latest", "qwen2.5-coder:7b"]));

    renderPicker("llama3.2:latest");
    await openList();

    const shown = offered();

    expect(shown).toContain("llama3.2:latest");
    expect(shown).toContain("qwen2.5-coder:7b");
  });

  it("selects the Model I choose", async () => {
    discoveryAnswers(() => found(["llama3.2:latest", "qwen2.5-coder:7b"]));

    const { onSelect } = renderPicker("llama3.2:latest");
    const list = await openList();

    fireEvent.click(within(list).getByRole("option", { name: /qwen2\.5-coder:7b/ }));

    expect(onSelect).toHaveBeenCalledWith("qwen2.5-coder:7b");
  });

  it("stays on screen while chatting, so the Model producing a Response is known", async () => {
    discoveryAnswers(() => found(["llama3.2:latest"]));

    renderPicker("qwen2.5-coder:7b");

    // The control shows the Model actually in use rather than some other one, which
    // is the whole claim here: it used to be an `<option>` added to the list for
    // exactly this case.
    const trigger = await screen.findByRole("button", { name: /Model/ });
    expect(trigger.textContent).toContain("qwen2.5-coder:7b");

    await openList();
    expect(offered()[0]).toBe("qwen2.5-coder:7b");
    expect(screen.getByRole("option", { name: /qwen2\.5-coder:7b/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
});

describe("searching what an Endpoint reports", () => {
  it("finds a Model from part of its identifier, which is the only text there is", async () => {
    // `qwen3.5-4b-mlx` and `text-embedding-nomic-embed-text-v1.5` are what an
    // Endpoint reports: bare identifiers, no human names. Searching is therefore
    // the only way a hundred of them is a list rather than a wall.
    discoveryAnswers(() =>
      found(["qwen3.5-4b-mlx", "text-embedding-nomic-embed-text-v1.5", "ling-3.0-tiny-oq4e"]),
    );

    renderPicker("qwen3.5-4b-mlx");
    await openList();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "embed" } });

    expect(offered()).toEqual(["text-embedding-nomic-embed-text-v1.5"]);
  });

  it("finds a Model written with underscores as well as hyphens", async () => {
    // The same Model is spelled `qwen3.5_4b` by one tool and `qwen3.5-4b-mlx` by
    // another, and a reader copying the first should find the second.
    discoveryAnswers(() => found(["qwen3.5-4b-mlx", "ling-3.0-tiny-oq4e"]));

    renderPicker("qwen3.5-4b-mlx");
    await openList();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "qwen3.5_4b" } });

    expect(offered()).toEqual(["qwen3.5-4b-mlx"]);
  });

  it("offers to type the identifier when a search finds nothing", async () => {
    // A search that misses is exactly the case where the list cannot answer, and
    // the reader may well be holding a Model the Endpoint does not report.
    discoveryAnswers(() => found(["llama3.2:latest"]));

    renderPicker("llama3.2:latest");
    await openList();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a-model-it-does-not-have" } });

    const list = screen.getByRole("listbox", { name: "Models" });
    fireEvent.click(within(list).getByRole("button", { name: /Type an identifier/i }));

    expect(await screen.findByPlaceholderText("Model identifier")).toBeTruthy();
  });
});

describe("an Endpoint that cannot be discovered", () => {
  it("offers a field to type an identifier in, so it stays usable", async () => {
    discoveryAnswers(() => ({
      status: 200,
      body: { endpointId: "ollama", result: { status: "unavailable" } },
    }));

    const { onSelect } = renderPicker("");

    const field = await screen.findByPlaceholderText("Model identifier");
    fireEvent.change(field, { target: { value: "some-model" } });

    expect(onSelect).toHaveBeenLastCalledWith("some-model");
  });

  it("tells me the Endpoint has nothing loaded, rather than showing an empty control", async () => {
    discoveryAnswers(() => ({
      status: 200,
      body: { endpointId: "ollama", result: { status: "empty" } },
    }));

    renderPicker();

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("reports no Models"),
    );
  });

  it("tells me the Endpoint is not running, so I know to start it", async () => {
    discoveryAnswers(() => ({
      status: 200,
      body: { endpointId: "ollama", result: { status: "unreachable" } },
    }));

    renderPicker();

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Could not reach Ollama"),
    );
  });

  it("names the environment variable when the Endpoint has no Credential", async () => {
    discoveryAnswers(() => ({
      status: 400,
      body: { error: "OpenRouter has no Credential. Set OPENROUTER_API_KEY and try again." },
    }));

    renderPicker();

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("OPENROUTER_API_KEY"),
    );
  });

  it("lets me type an identifier even when discovery did work", async () => {
    // A real Endpoint reports some Models and not others — a Model the reader
    // loaded before the app asked, or one served under a name it does not list.
    discoveryAnswers(() => found(["llama3.2:latest"]));

    renderPicker("llama3.2:latest");
    await screen.findByRole("button", { name: /Model/ });

    // A control beside the list rather than an option inside it, so the arrows can
    // never walk onto an action that replaces the control instead of choosing
    // from it.
    fireEvent.click(screen.getByRole("button", { name: /Type an identifier instead/i }));

    expect(await screen.findByPlaceholderText("Model identifier")).toBeTruthy();
  });
});

describe("re-running discovery", () => {
  it("shows a Model loaded after the first ask, without restarting anything", async () => {
    let loaded = ["llama3.2:latest"];
    discoveryAnswers(() => found(loaded));

    renderPicker("llama3.2:latest");
    await screen.findByRole("button", { name: /Model/ });

    // The Model is loaded on the Endpoint after the page was already open.
    loaded = [...loaded, "gemma3:4b"];

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await openList();

    expect(offered()).toContain("gemma3:4b");
  });

  it("asks again about the Endpoint currently selected", async () => {
    const asked: string[] = [];
    discoveryAnswers((endpointId) => {
      asked.push(endpointId);
      return found(["llama3.2:latest"]);
    });

    const { rerender } = render(
      <ModelPicker
        endpointId="ollama"
        endpointName="Ollama"
        modelId="llama3.2"
        onSelect={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: /Model/ });

    rerender(
      <ModelPicker
        endpointId="lmstudio"
        endpointName="LM Studio"
        modelId="local-model"
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => expect(asked).toContain("lmstudio"));
  });
});