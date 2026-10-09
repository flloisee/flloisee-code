// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EndpointPicker } from "@/components/endpoint-picker";
import type { EndpointStatus } from "@/lib/endpoints/status";
import { REGISTRY_CHANGED_KEY } from "@/lib/selection/store";
import { Workspace } from "@/components/workspace";

/**
 * The Registry as one shared answer rather than one per view.
 *
 * These are for a bug this feature introduced and a reader would have hit every
 * time: declaring an Endpoint updated the picker, and the chat header kept
 * showing the Endpoint and Model it had before, because the header was reading
 * an answer fetched once on mount and nothing told it a second was needed. So a
 * reader who added a server and chose it saw the new name in the dropdown and
 * the old one above the composer — and the Conversation was claimed to be going
 * somewhere it was not.
 */

const originalNodeEnv = process.env.NODE_ENV;

function runAsEnvironment(value: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
});

const OLLAMA: EndpointStatus = {
  id: "ollama",
  name: "Ollama",
  credentialEnvVar: null,
  configured: true,
  group: "local",
  defaultModelId: "llama3.2",
};

const DECLARED: EndpointStatus = {
  id: "home-vllm",
  name: "Home vLLM",
  credentialEnvVar: null,
  configured: true,
  group: "declared",
  defaultModelId: "qwen3-coder",
};

/**
 * The Registry route, answering differently the second time it is asked.
 *
 * That is the whole situation: the first answer has no declared Endpoint in it,
 * and something changes on the server before the second.
 */
function registryGrowsOnSecondRead() {
  let reads = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/endpoints")) {
        reads += 1;
        const statuses = reads === 1 ? [OLLAMA] : [DECLARED, OLLAMA];

        return new Response(JSON.stringify({ endpoints: statuses, declaredTrouble: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (String(url).endsWith("/api/models")) {
        return new Response(
          JSON.stringify({ endpointId: "home-vllm", result: { status: "empty" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected request to ${url}`);
    }),
  );
}

describe("the Registry changing while the interface is open", () => {
  it("reaches the picker, which offers the new Endpoint without a reload", async () => {
    registryGrowsOnSecondRead();
    runAsEnvironment("development");

    render(<EndpointPicker endpointId="ollama" onSelect={vi.fn()} />);

    await screen.findByRole("combobox");
    expect(screen.queryByRole("option", { name: "Home vLLM" })).toBeNull();

    // What a declaration does once it has written its file.
    window.dispatchEvent(new StorageEvent("storage", { key: REGISTRY_CHANGED_KEY }));

    expect(await screen.findByRole("option", { name: "Home vLLM" })).toBeTruthy();
  });

  it("reaches the chat header, which had kept showing the Endpoint it had before", async () => {
    // The failure in full: the picker updates and the header does not, so the
    // interface shows the new Endpoint in one place and the old one in the other.
    registryGrowsOnSecondRead();
    runAsEnvironment("development");

    render(<Workspace endpointId="ollama" backend={null} />);

    const inUse = () => document.querySelector("[data-in-use]")?.textContent ?? "";

    await waitFor(() => expect(inUse()).toContain("Ollama"));

    window.dispatchEvent(new StorageEvent("storage", { key: REGISTRY_CHANGED_KEY }));
    fireEvent.change(screen.getByPlaceholderText(/send a message/i), {
      target: { value: "Hello." },
    });

    // And the chosen Endpoint is kept rather than being discarded as unknown,
    // which is what happened before: the stored id was checked against a list
    // that did not yet hold it, so the reader was handed Ollama back.
    window.localStorage.setItem("multi-endpoint-chat.endpoint", "home-vllm");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "multi-endpoint-chat.endpoint",
        newValue: "home-vllm",
      }),
    );

    await waitFor(() => expect(inUse()).toContain("Home vLLM"), { timeout: 5000 });
  });
});
