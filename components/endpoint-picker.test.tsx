// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EndpointPicker } from "@/components/endpoint-picker";
import type { EndpointStatus } from "@/lib/endpoints/status";

/**
 * What choosing an Endpoint looks like.
 *
 * The Registry is one list however an Endpoint reached it, so these assert what
 * a reader can see and do: pick an Endpoint by name rather than type an address,
 * see that one lacking a Credential is not Configured, and be told which
 * environment variable to set.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LOCAL: EndpointStatus = {
  id: "ollama",
  name: "Ollama",
  credentialEnvVar: null,
  configured: true,
  group: "local",
  defaultModelId: "llama3.2",
};
const CLOUD_READY: EndpointStatus = {
  id: "openrouter",
  name: "OpenRouter",
  credentialEnvVar: "OPENROUTER_API_KEY",
  configured: true,
  group: "recommended",
  defaultModelId: "openai/gpt-4o",
};
const CLOUD_BARE: EndpointStatus = {
  id: "groq",
  name: "Groq",
  credentialEnvVar: "GROQ_API_KEY",
  configured: false,
  group: "recommended",
  defaultModelId: "llama-3.3-70b",
};
/** A Cloud Endpoint the Registry does not recommend, standing in for the other 182. */
const CLOUD_OTHER: EndpointStatus = {
  id: "small-provider",
  name: "A Small Provider",
  credentialEnvVar: "SMALL_PROVIDER_API_KEY",
  configured: false,
  group: "others",
  defaultModelId: "small-model",
};
/** One the reader declared through the interface, which needs no Credential. */
const DECLARED: EndpointStatus = {
  id: "my-server",
  name: "My server",
  credentialEnvVar: null,
  configured: true,
  group: "declared",
  defaultModelId: "llama3.2",
};

function registryAnswers(entries: unknown[], status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ endpoints: entries, declaredTrouble: null }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

function renderPicker(endpointId = "ollama") {
  const onSelect = vi.fn();
  const view = render(<EndpointPicker endpointId={endpointId} onSelect={onSelect} />);
  return { onSelect, unmount: view.unmount };
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

describe("the words the interface uses", () => {
  it("calls an Endpoint an Endpoint and its secret a Credential, as the glossary defines both", async () => {
    // GLOSSARY.md lists provider, backend and API key among the words to avoid
    // for Endpoint and Credential. They drift in easily and tell the reader the
    // app means something other than what the glossary defines, so the
    // vocabulary is pinned here — where a reader would actually see it.
    //
    // Rendered three ways, because the picker's copy differs by state and only
    // the states that are rendered can be checked: nothing chosen, a Local
    // Endpoint already Configured, and a Cloud Endpoint missing its Credential.
    const shown: string[] = [];

    for (const [id, entries] of [
      ["absent", [LOCAL, CLOUD_BARE, CLOUD_READY]],
      ["ollama", [LOCAL, CLOUD_BARE, CLOUD_READY]],
      ["groq", [LOCAL, CLOUD_BARE, CLOUD_READY]],
    ] as const) {
      registryAnswers([...entries]);
      const { unmount } = renderPicker(id);
      await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
      shown.push(document.body.textContent ?? "");
      unmount();
    }

    for (const text of shown) {
      expect(text).toContain("Endpoint");
      for (const avoided of ["provider", "backend", "API key", "secret", "password"]) {
        expect(text, `the interface says "${avoided}"`).not.toContain(avoided);
      }
    }

    // The unconfigured state is the one that talks about the Credential, and it
    // names the variable rather than the value.
    expect(shown.join(" ")).toContain("Credential");
    expect(shown.join(" ")).not.toMatch(/sk-[a-z0-9]/i);
  });
});

/**
 * The list of 187 Cloud Endpoints is unreadable as one run, so it is offered in
 * three groups. These assert the reader's side of that: the headings appear, an
 * Endpoint sits under the group the Registry gave it, and an empty group is still
 * there so the list does not change shape as Credentials come and go.
 */

/** The group headings currently rendered, in the order they appear. */
function groupLabels() {
  return [...document.querySelectorAll("optgroup")].map((group) => group.label);
}

/** The Endpoint names offered under one group heading. */
function namesUnder(label: string) {
  const group = [...document.querySelectorAll("optgroup")].find((one) => one.label === label);

  return [...(group?.querySelectorAll("option") ?? [])].map((option) => option.textContent);
}

describe("the four groups the Registry is offered in", () => {
  it("offers the reader's own first, then Local, then Cloud recommended, then others", async () => {
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_OTHER]);

    renderPicker();
    await screen.findByRole("combobox");

    expect(groupLabels()).toEqual([
      "Added by you",
      "Local",
      "Cloud (Recommended)",
      "Cloud (Others)",
    ]);
  });

  it("puts each Endpoint under the group the Registry gave it", async () => {
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_OTHER, DECLARED]);

    renderPicker();
    await screen.findByRole("combobox");

    expect(namesUnder("Local")).toEqual(["Ollama"]);
    expect(namesUnder("Cloud (Recommended)")).toEqual(["OpenRouter"]);
    expect(namesUnder("Cloud (Others)")).toEqual(["A Small Provider — no Credential"]);
    expect(namesUnder("Added by you")).toEqual(["My server"]);
  });

  it("trusts the Registry over its own idea of who is recommended", async () => {
    // Groq is one of the recommended names in the Registry, so a list that
    // decided the grouping itself would place it accordingly. Sent here as
    // "others" instead, it must follow the answer — otherwise the interface
    // carries a second, silently divergent opinion about the Registry.
    const groqAsOthers = { ...CLOUD_BARE, group: "others" };

    registryAnswers([LOCAL, groqAsOthers]);

    renderPicker();
    await screen.findByRole("combobox");

    expect(namesUnder("Cloud (Recommended)")).toEqual([]);
    expect(namesUnder("Cloud (Others)")).toEqual(["Groq — no Credential"]);
  });

  it("keeps a group visible when nothing is in it", async () => {
    // Otherwise the headings would come and go with the reader's Credentials, and
    // the control would appear to answer a question nobody asked.
    registryAnswers([LOCAL]);

    renderPicker();
    await screen.findByRole("combobox");

    expect(groupLabels()).toEqual([
      "Added by you",
      "Local",
      "Cloud (Recommended)",
      "Cloud (Others)",
    ]);
  });

  it("still annotates each Endpoint with whether it needs a Credential", async () => {
    registryAnswers([CLOUD_READY, CLOUD_OTHER]);

    renderPicker();
    await screen.findByRole("combobox");

    expect(namesUnder("Cloud (Recommended)")).toEqual(["OpenRouter"]);
    expect(namesUnder("Cloud (Others)")).toEqual(["A Small Provider — no Credential"]);
  });
});