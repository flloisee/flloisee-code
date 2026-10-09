// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EndpointPicker } from "@/components/endpoint-picker";

/**
 * What choosing an Endpoint looks like.
 *
 * The Registry is one list however an Endpoint reached it, so these assert what
 * a reader can see and do: pick a provider by name rather than type an address,
 * see that one lacking a Credential is not Configured, and be told which
 * environment variable to set.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCAL = { id: "ollama", name: "Ollama", credentialEnvVar: null, configured: true };
const CLOUD_READY = {
  id: "openrouter",
  name: "OpenRouter",
  credentialEnvVar: "OPENROUTER_API_KEY",
  configured: true,
};
const CLOUD_BARE = {
  id: "groq",
  name: "Groq",
  credentialEnvVar: "GROQ_API_KEY",
  configured: false,
};

function registryAnswers(entries: unknown[], status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ endpoints: entries }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

function renderPicker(endpointId = "ollama") {
  const onSelect = vi.fn();
  render(<EndpointPicker endpointId={endpointId} onSelect={onSelect} />);
  return { onSelect };
}

describe("choosing an Endpoint from the Registry", () => {
  it("offers Local and Cloud Endpoints in one list, by name rather than by address", async () => {
    registryAnswers([LOCAL, CLOUD_READY]);

    renderPicker();

    const list = await screen.findByRole("combobox");
    const offered = [...list.querySelectorAll("option")].map((option) => option.textContent);

    expect(offered).toContain("Ollama");
    expect(offered).toContain("OpenRouter");
    // An address is what the Catalog is for; it is never the thing being picked.
    expect(offered.join(" ")).not.toContain("localhost");
  });

  it("selects the Endpoint I choose", async () => {
    registryAnswers([LOCAL, CLOUD_READY]);

    const { onSelect } = renderPicker();

    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "openrouter" } });

    expect(onSelect).toHaveBeenCalledWith("openrouter");
  });

  it("lists a Cloud Endpoint with no Credential rather than hiding it", async () => {
    registryAnswers([LOCAL, CLOUD_BARE]);

    renderPicker();

    const list = await screen.findByRole("combobox");
    const offered = [...list.querySelectorAll("option")].map((option) => option.textContent);

    expect(offered.join(" ")).toContain("Groq");
  });

  it("shows the chosen Endpoint as not Configured, so its absence is diagnosable", async () => {
    registryAnswers([LOCAL, CLOUD_BARE]);

    // Chosen rather than merely listed: the reader has picked it and is being
    // told why it will not answer.
    renderPicker("groq");

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Groq has no Credential"),
    );
  });

  it("names the environment variable to set, so no source has to be read", async () => {
    registryAnswers([LOCAL, CLOUD_BARE]);

    renderPicker("groq");

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("GROQ_API_KEY"),
    );
  });

  it("says nothing about Credentials when the chosen Endpoint is Configured", async () => {
    registryAnswers([LOCAL, CLOUD_READY]);

    renderPicker("openrouter");

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.getByRole("status").textContent).not.toContain("Credential");
  });

  it("tells me the Registry could not be read, rather than showing an empty control", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    renderPicker();

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Could not read the Endpoint list"),
    );
  });
});