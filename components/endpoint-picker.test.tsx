// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/**
 * The table, as the reader opens it.
 *
 * Pressing the control and waiting for the search field, rather than reaching in
 * for the list: the rows only exist while the popup does, and the popup is what a
 * reader opens. Anything else would test a list that no reader has ever been able
 * to see.
 */
async function openTable() {
  fireEvent.click(await screen.findByRole("button", { name: /Endpoint/ }));
  return screen.findByRole("listbox", { name: "Endpoints" });
}

/** The Endpoint names currently offered, in the order they are drawn. */
function offered(): string[] {
  return [...document.querySelectorAll("[data-endpoint]")].map(
    (row) => row.querySelector("span:nth-of-type(2)")?.textContent ?? "",
  );
}

describe("choosing an Endpoint from the Registry", () => {
  it("offers Local and Cloud Endpoints in one list, by name rather than by address", async () => {
    registryAnswers([LOCAL, CLOUD_READY]);

    renderPicker();
    await openTable();

    const shown = offered();

    expect(shown).toContain("Ollama");
    expect(shown).toContain("OpenRouter");
    // An address is what the Catalog is for; it is never the thing being picked.
    expect(shown.join(" ")).not.toContain("localhost");
  });

  it("selects the Endpoint I choose", async () => {
    registryAnswers([LOCAL, CLOUD_READY]);

    const { onSelect } = renderPicker();

    fireEvent.click(await within(await openTable()).getByRole("option", { name: /OpenRouter/ }));

    expect(onSelect).toHaveBeenCalledWith("openrouter");
  });

  it("lists a Cloud Endpoint with no Credential rather than hiding it", async () => {
    registryAnswers([LOCAL, CLOUD_BARE]);

    renderPicker();
    await openTable();

    expect(offered()).toContain("Groq");
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
    //
    // Each read twice — closed and open — because the table added a vocabulary of
    // its own in the column headings and the three Credential states, and copy
    // that is only ever seen with the popup up is exactly the copy nobody re-reads.
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

      await openTable();
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
 * four groups. These assert the reader's side of that: the headings appear, an
 * Endpoint sits under the group the Registry gave it, and an empty group is still
 * there so the list does not change shape as Credentials come and go.
 */

/** The group headings currently rendered, in the order they appear. */
function groupLabels() {
  return [...document.querySelectorAll("[data-group]")].map((group) => group.getAttribute("data-group"));
}

/** The group headings as the reader reads them, which is the wording under test. */
function headings() {
  return [...document.querySelectorAll("[data-group] > p")].map((heading) => heading.textContent);
}

/** The Endpoint names offered under one group heading. */
function namesUnder(kind: string) {
  const group = document.querySelector(`[data-group="${kind}"]`);
  return [...(group?.querySelectorAll("[data-endpoint]") ?? [])].map(namesIn);
}

/**
 * One row's Endpoint name, read past the mark and the two columns beside it.
 *
 * By structural hook and position rather than by class, on the reasoning
 * `data-turn` records: a test pinned to a class is pinned to the styling, and this
 * claim is about which Endpoints are in which group.
 */
function namesIn(row: Element) {
  return row.querySelector("span:nth-of-type(2)")?.textContent ?? "";
}

describe("the four groups the Registry is offered in", () => {
  it("offers the reader's own first, then Local, then Cloud recommended, then others", async () => {
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_OTHER]);

    renderPicker();
    await openTable();

    expect(groupLabels()).toEqual(["declared", "local", "recommended", "others"]);
    expect(headings()).toEqual(["Added by you", "Local", "Cloud", "Cloud (Others)"]);
  });

  it("puts each Endpoint under the group the Registry gave it", async () => {
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_OTHER, DECLARED]);

    renderPicker();
    await openTable();

    expect(namesUnder("local")).toEqual(["Ollama"]);
    expect(namesUnder("recommended")).toEqual(["OpenRouter"]);
    expect(namesUnder("others")).toEqual(["A Small Provider"]);
    expect(namesUnder("declared")).toEqual(["My server"]);
  });

  it("trusts the Registry over its own idea of who is recommended", async () => {
    // Groq is one of the recommended names in the Registry, so a list that
    // decided the grouping itself would place it accordingly. Sent here as
    // "others" instead, it must follow the answer — otherwise the interface
    // carries a second, silently divergent opinion about the Registry.
    const groqAsOthers = { ...CLOUD_BARE, group: "others" };

    registryAnswers([LOCAL, groqAsOthers]);

    renderPicker();
    await openTable();

    expect(namesUnder("recommended")).toEqual([]);
    expect(namesUnder("others")).toEqual(["Groq"]);
  });

  it("keeps a group visible when nothing is in it", async () => {
    // Otherwise the headings would come and go with the reader's Credentials, and
    // the control would appear to answer a question nobody asked.
    registryAnswers([LOCAL]);

    renderPicker();
    await openTable();

    expect(groupLabels()).toEqual(["declared", "local", "recommended", "others"]);
  });

  it("still annotates each Endpoint with whether it needs a Credential", async () => {
    registryAnswers([CLOUD_READY, CLOUD_OTHER]);

    renderPicker();
    await openTable();

    // A column rather than a suffix on the name, which is the whole reason the
    // list became a table: "will this work" and "what will I get" are two things
    // to read across rows, and folding both into the name meant neither was.
    const says = (id: string) =>
      document.querySelector(`[data-endpoint="${id}"]`)?.textContent ?? "";

    expect(says("openrouter")).toContain("Configured");
    expect(says("small-provider")).toContain("Not set");
  });
});

describe("searching the Registry", () => {
  it("narrows 187 names to the one I am after, which is the reason it is not a menu", async () => {
    const many = Array.from({ length: 187 }, (_, at) => ({
      ...CLOUD_OTHER,
      id: `other-${at}`,
      name: `Other ${at}`,
    }));
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_BARE, ...many]);

    renderPicker();
    await openTable();
    expect(offered().length).toBe(190);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "groq" } });

    expect(offered()).toEqual(["Groq"]);
  });

  it("finds an Endpoint from its Credential variable, since that is what a reader has in front of them", async () => {
    // The variable is in a README or a shell history. Matching only on the name
    // would make the reader translate it back into a vendor name themselves.
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_BARE]);

    renderPicker();
    await openTable();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "OPENROUTER_API_KEY" } });

    expect(offered()).toEqual(["OpenRouter"]);
  });

  it("drops the headings it has nothing to put under, rather than showing four", async () => {
    // The empty groups are kept when nothing is searched for, because the shape of
    // the list should not change with the reader's Credentials. Under a search the
    // shape *is* the answer, and a heading over nothing is a heading that has
    // stopped answering the question.
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_BARE]);

    renderPicker();
    await openTable();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "groq" } });

    expect(headings()).toEqual(["Cloud"]);
  });

  it("says so when nothing matches, rather than showing an empty table", async () => {
    // An empty list is a list that failed silently, which is the one thing a reader
    // cannot tell apart from a Registry that really is empty.
    registryAnswers([LOCAL, CLOUD_READY]);

    renderPicker();
    await openTable();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nothing here" } });

    expect(screen.getByText(/named like that/i)).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("starts the walk at the top again for each search", async () => {
    // A reader who has arrowed to row 40 and then typed has asked a new question,
    // and an answer whose highlight sits at row 40 of a two-row list is not
    // pointing at anything.
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_BARE]);

    renderPicker();
    await openTable();

    const field = screen.getByRole("combobox");
    for (let at = 0; at < 3; at += 1) fireEvent.keyDown(field, { key: "ArrowDown" });

    fireEvent.change(field, { target: { value: "groq" } });

    expect(document.activeElement?.getAttribute("aria-activedescendant")).toBe(
      document.querySelector("[data-endpoint='groq']")?.id,
    );
  });

  it("forgets the last search when reopened, since nobody asked for it twice", async () => {
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_BARE]);

    renderPicker();
    await openTable();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "groq" } });
    expect(offered()).toEqual(["Groq"]);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    await openTable();

    expect(offered().length).toBe(3);
  });
});

describe("choosing from the table with the keyboard", () => {
  it("puts the caret in the search field, so a name can be typed straight away", async () => {
    registryAnswers([LOCAL, CLOUD_READY]);

    renderPicker();
    await openTable();

    // The whole of what `aria-activedescendant` is for: focus never leaves the
    // field, so nothing takes it and a keypress cannot reach the dialog behind.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox")));
  });

  it("takes the row I have walked to with Enter", async () => {
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_BARE]);

    const { onSelect } = renderPicker();
    await openTable();

    const field = screen.getByRole("combobox");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("groq");
  });

  it("wraps at both ends, so the table cannot be fallen off", async () => {
    registryAnswers([LOCAL, CLOUD_READY]);

    renderPicker();
    await openTable();

    const field = screen.getByRole("combobox");
    // Three rows, and the walk starts on the first, so one ArrowUp lands on the
    // last rather than refusing to move.
    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(field.getAttribute("aria-activedescendant")).toBe(
      document.querySelector("[data-endpoint='openrouter']")?.id,
    );
  });

  it("names the row in use, so the one already chosen is findable at a glance", async () => {
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_BARE]);

    renderPicker("groq");
    await openTable();

    const row = document.querySelector("[data-endpoint='groq']");
    expect(row?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[data-endpoint='ollama']")?.getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("closes on Escape without taking the dialog with it", async () => {
    // Settings binds Escape on the document. A reader dismissing a list of names
    // is not a reader asking to lose the whole dialog to their first Escape, so
    // the popup stops the key rather than merely handling it.
    registryAnswers([LOCAL, CLOUD_READY]);

    render(
      <div>
        <EndpointPicker endpointId="ollama" onSelect={vi.fn()} />
      </div>,
    );
    await openTable();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Endpoints" })).toBeNull();
  });

  it("gives the caret back to the control, so the reader can carry on to the Model", async () => {
    registryAnswers([LOCAL, CLOUD_READY, CLOUD_BARE]);

    renderPicker();
    const trigger = await screen.findByRole("button", { name: /Endpoint/ });
    await openTable();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    // The popup took focus when it opened. Leaving it on nothing would drop the
    // reader back to the top of the dialog.
    expect(document.activeElement).toBe(trigger);
  });
});