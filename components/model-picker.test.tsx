// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("a Model discovered from an Endpoint", () => {
  it("is offered as a selectable list rather than typed", async () => {
    discoveryAnswers(() => found(["llama3.2:latest", "qwen2.5-coder:7b"]));

    renderPicker("llama3.2:latest");

    const list = await screen.findByRole("combobox");
    const offered = [...list.querySelectorAll("option")].map((o) => o.value);

    expect(offered).toContain("llama3.2:latest");
    expect(offered).toContain("qwen2.5-coder:7b");
  });

  it("selects the Model I choose", async () => {
    discoveryAnswers(() => found(["llama3.2:latest", "qwen2.5-coder:7b"]));

    const { onSelect } = renderPicker("llama3.2:latest");
    const list = await screen.findByRole("combobox");

    fireEvent.change(list, { target: { value: "qwen2.5-coder:7b" } });

    expect(onSelect).toHaveBeenCalledWith("qwen2.5-coder:7b");
  });

  it("stays on screen while chatting, so the Model producing a Response is known", async () => {
    discoveryAnswers(() => found(["llama3.2:latest"]));

    renderPicker("qwen2.5-coder:7b");

    // A Model chosen by hand and absent from the list is still shown, rather
    // than the control silently reading as some other Model.
    const list = await screen.findByRole("combobox") as HTMLSelectElement;
    expect(list.value).toBe("qwen2.5-coder:7b");
    expect([...list.querySelectorAll("option")].map((o) => o.value)).toContain(
      "qwen2.5-coder:7b",
    );
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
    discoveryAnswers(() => found(["llama3.2:latest"]));

    renderPicker("llama3.2:latest");
    const list = await screen.findByRole("combobox");

    // Choosing the last entry is how the reader asks for the typed field.
    const manual = [...list.querySelectorAll("option")].at(-1)!.value;
    fireEvent.change(list, { target: { value: manual } });

    expect(await screen.findByPlaceholderText("Model identifier")).toBeTruthy();
  });
});

describe("re-running discovery", () => {
  it("shows a Model loaded after the first ask, without restarting anything", async () => {
    let loaded = ["llama3.2:latest"];
    discoveryAnswers(() => found(loaded));

    renderPicker("llama3.2:latest");
    await screen.findByRole("combobox");

    // The Model is loaded on the Endpoint after the page was already open.
    loaded = [...loaded, "gemma3:4b"];

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      const offered = [...document.querySelectorAll("option")].map((o) => o.value);
      expect(offered).toContain("gemma3:4b");
    });
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
    await screen.findByRole("combobox");

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