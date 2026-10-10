"use client";

import { useCallback, useMemo } from "react";

import { DeclareEndpoint } from "@/components/declare-endpoint";
import { KeyEntry } from "@/components/key-entry";
import {
  Chevron,
  optionId,
  searchKeys,
  Tick,
  usePickerPopup,
  type Popup,
  type PopupRefs,
} from "@/components/picker-popup";
import { ENDPOINT_GROUPS } from "@/lib/endpoints/groups";
import { keyEntryIsAvailable } from "@/lib/endpoints/key-entry";
import { useRegistry } from "@/lib/endpoints/use-registry";
import type { EndpointStatus } from "@/lib/endpoints/status";
import { announceRegistryChanged } from "@/lib/selection/store";

/**
 * Choosing an Endpoint: pick one from the Registry by name, rather than typing a
 * base URL.
 *
 * The list and each Endpoint's Configured state come from the app's own server,
 * because whether a Credential is present is known only there — and no Credential
 * value ever crosses to the browser.
 *
 * **The 187 names are why this is a searchable table and not a `<select>`.** A
 * native menu draws every option in one run with nothing to filter it by, so the
 * only way to reach Groq in it is to arrow past a hundred and eighty names while
 * watching them go. A `<select>` of the whole Registry is not a list the reader
 * chooses from; it is a list they have to survive, and the Catalog the app is
 * built on is effectively hidden behind that scroll. So the control is a button
 * showing what is chosen, and pressing it opens a search field over a table.
 *
 * The table has three columns rather than one because the two facts a reader is
 * actually choosing between — *will it work today* and *what will I get* — were
 * folded into the name in the old list. Splitting them out is what makes reading
 * across two rows worth anything.
 *
 * How the panel opens, walks and dismisses is `picker-popup.tsx`, shared with the
 * Model picker: choosing an Endpoint and choosing a Model are two questions about
 * two different lists, but the mechanism that answers them is one thing.
 *
 * The one place a base URL is typed is the button below, which opens a dialog
 * rather than a field here. That separation is the point: this control is about
 * choosing among Endpoints that exist, and an editable-looking control is an
 * invitation to type into something that was never going to read it.
 */

/**
 * The columns, written once and used by the headings and the rows alike.
 *
 * Two copies of a column width is two answers to one question, and the answer that
 * drifts is the one where "Model" ends up over the Credential.
 */
const ROW = "flex items-center gap-2 px-3 py-1.5";
const NAME = "min-w-0 flex-1 truncate";
const CREDENTIAL = "w-24 shrink-0";
const MODEL = "w-28 shrink-0 truncate font-mono text-xs";
const MARK = "w-4 shrink-0";

export type EndpointPickerProps = {
  /** The Endpoint in use, which is the one the table shows as selected. */
  endpointId: string;
  /** Called with the id of the Endpoint chosen. */
  onSelect: (endpointId: string) => void;
};

export function EndpointPicker({ endpointId, onSelect }: EndpointPickerProps) {
  const answer = useRegistry();

  const statuses = answer.statuses;
  const chosen = statuses.find((status) => status.id === endpointId);

  /**
   * The search, over the name and the Credential variable and nothing else.
   *
   * The variable is in because a reader holding `GROQ_API_KEY` has it in front of
   * them from a README and wants the Endpoint that takes it. The Model is not,
   * because every Local Endpoint in the Registry declares `llama3.2` and matching
   * on it would answer most searches with the entire Local group.
   *
   * Run in Registry order rather than grouped, because `picker-popup` owns one
   * search over one list and the grouping is a drawing of it — splitting the list
   * into four before searching would mean four searches and four walks.
   */
  const [popup, { triggerRef, activeRowRef, searchRef }] = usePickerPopup({
    items: statuses,
    matches: (status: EndpointStatus, wanted: string) =>
      status.name.toLowerCase().includes(wanted) ||
      (status.credentialEnvVar?.toLowerCase().includes(wanted) ?? false),
  });

  /**
   * The list drawn as the Registry groups it, from the searched rows.
   *
   * Groups with nothing in them are kept while nothing is being searched for, so
   * the shape of the list does not change with the Credential someone happens to
   * have set. Under a search they are dropped: a heading over nothing is a heading
   * that has stopped answering the question asked of it.
   */
  const groups = useMemo(() => {
    const searching = popup.query.trim().length > 0;

    const drawn = ENDPOINT_GROUPS.map((group) => ({
      kind: group.kind,
      label: group.label,
      entries: popup.shown.filter((status) => status.group === group.kind),
    }));

    return searching ? drawn.filter((group) => group.entries.length > 0) : drawn;
  }, [popup.shown, popup.query]);

  /**
   * Where each Endpoint sits in the searched list, so the table can be drawn in
   * group order while the arrows still walk it end to end in the Registry's order.
   */
  const places = useMemo(
    () => new Map(popup.shown.map((status, at) => [status.id, at])),
    [popup.shown],
  );

  // Only a Cloud Endpoint needs a Credential, and only where Key Entry can run:
  // offering the button for a Local Endpoint, or outside development, would be
  // offering a dialog that cannot help.
  const keyEntryFor =
    keyEntryIsAvailable() && chosen?.credentialEnvVar != null ? chosen.id : null;

  const choose = useCallback(
    (status: EndpointStatus) => {
      onSelect(status.id);
      popup.hide(true);
    },
    [onSelect, popup],
  );

  const labelId = "endpoint-picker-label";
  const shownId = "endpoint-picker-shown";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* The mono register: a field name, set like a label on a control panel
            rather than a heading. A `span` and not a `<label for>`, because the
            control it names is a button whose own text is the Endpoint in use: a
            label pointing at that button would name it "Endpoint" and leave the
            reader with no idea which one is chosen until they opened it. */}
        <span id={labelId} className="hm-label w-16 shrink-0">
          Endpoint
        </span>

        {/* Disabled until the list has arrived, and disabled again if the answer
            carried nothing to choose from. A list that arrived empty or unreadable
            is not a list of choices, and offering the control over it would be
            offering a stale or empty one — which is the exact thing the `trouble`
            line below is there to explain. */}
        <button
          ref={triggerRef}
          type="button"
          // Both, so the control reads as "Endpoint: Ollama" rather than as
          // "Endpoint" with the answer somewhere off to the side.
          aria-labelledby={`${labelId} ${shownId}`}
          aria-haspopup="listbox"
          aria-expanded={popup.open}
          aria-controls={popup.open ? popup.listId : undefined}
          disabled={statuses.length === 0}
          onClick={popup.toggle}
          // Which Endpoint this control is holding, as a structural hook rather
          // than as the name it happens to be drawn with — the reasoning
          // `data-turn` records. A caller that has to ask "what does it say" to
          // find out what it means is reading a label, and a rename would break it
          // without anything about the app having changed.
          data-chosen={chosen?.id ?? ""}
          className="hm-field flex cursor-pointer items-center justify-between gap-2 text-left"
        >
          <span id={shownId} className={NAME}>
            {chosen?.name ?? "Choose an Endpoint"}
          </span>
          <Chevron />
        </button>
      </div>

      {/* Drawn at the end of the document rather than here, because the dialog
          around this control is `overflow: hidden` and would clip it. */}
      {popup.layer(
        <EndpointPanel
          popup={popup}
          refs={{ searchRef, activeRowRef }}
          groups={groups}
          places={places}
          endpointId={endpointId}
          total={statuses.length}
          onChoose={choose}
        />,
      )}

      {/* Reserved one line whether or not there is anything to say, so an arriving
          message never shoves the Conversation down the page.

          The reader's own Endpoints are reported separately from the list's own
          failures: the built-in Endpoints are all present and usable, so a corrupt
          `.endpoints.json` must not read as the whole Registry being gone. */}
      <p role="status" className="hm-status">
        {answer.declaredTrouble ?? sayAboutChosen(answer, chosen)}
      </p>

      {keyEntryFor !== null && (
        <KeyEntry endpointId={keyEntryFor} onStored={announceRegistryChanged} />
      )}

      <DeclareEndpoint
        declared={statuses.filter((status) => status.group === "declared")}
        onChanged={announceRegistryChanged}
        onStored={announceRegistryChanged}
      />
    </div>
  );
}

/**
 * The table, as the panel holds it.
 *
 * Split out so the picker above reads as the picker. Everything in here is only
 * true while the panel is on screen, and mounting it only then is what keeps a
 * reader who came to change the Theme from having anything to look at.
 */
function EndpointPanel({
  popup,
  refs,
  groups,
  places,
  endpointId,
  total,
  onChoose,
}: {
  popup: Popup<EndpointStatus>;
  /** Passed beside `popup` rather than inside it, so a render never reads a ref. */
  refs: Pick<PopupRefs, "searchRef" | "activeRowRef">;
  groups: { kind: string; label: string; entries: EndpointStatus[] }[];
  places: Map<string, number>;
  endpointId: string;
  /** How many there were before the search, so "see all of them" can say how many. */
  total: number;
  onChoose: (status: EndpointStatus) => void;
}) {
  // Destructured rather than read as `refs.searchRef` and `popup.shown` at each
  // use. The two are the same to React, but the second is a property of an object
  // that carries refs, and a render reading one is a render the `react-hooks/refs`
  // rule cannot tell apart from a render reading a ref's `current` — which is the
  // mistake that rule exists to catch. Plain locals are unambiguous.
  const { searchRef, activeRowRef } = refs;
  const { shown, listId, activeId, query, setQuery, goTo } = popup;

  return (
    <>
      <div className="shrink-0 border-b border-rule p-2">
        <input
          ref={searchRef}
          type="search"
          role="combobox"
          aria-label="Search Endpoints"
          aria-expanded={true}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={searchKeys(popup, () => {
            if (popup.active !== undefined) onChoose(popup.active);
          })}
          placeholder="Search by name or Credential variable"
          autoComplete="off"
          spellCheck={false}
          className="hm-field"
        />
      </div>

      {/* The headings, hidden from assistive technology, and that is not an
          oversight: every one of these words is already in the row beneath it, and
          inside a listbox a heading is a fragment with nothing to point at. */}
      <div aria-hidden className="shrink-0 border-b border-rule py-1.5">
        <p className={`${ROW} text-xs text-muted`}>
          <span className={MARK} />
          <span className={NAME}>Endpoint</span>
          <span className={CREDENTIAL}>Credential</span>
          <span className={MODEL}>Model</span>
        </p>
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-label="Endpoints"
        className="hm-scroll min-h-0 flex-1 overflow-y-auto py-1"
      >
        {shown.length === 0 ? (
          <li role="presentation" className="px-3 py-3">
            <p className="text-sm text-ink-2">
              Nothing in the Registry is named like that. Clear the search to see all {total} of
              them.
            </p>
          </li>
        ) : (
          groups.map((group) => (
            <li
              key={group.kind}
              role="group"
              aria-labelledby={`${listId}-${group.kind}`}
              data-group={group.kind}
            >
              <p id={`${listId}-${group.kind}`} className="hm-label px-3 py-1.5">
                {group.label}
              </p>

              {group.entries.map((status) => {
                const index = places.get(status.id) ?? 0;
                const id = optionId(listId, index);
                const onIt = id === activeId;
                const inUse = status.id === endpointId;

                return (
                  <li
                    key={status.id}
                    id={id}
                    role="option"
                    aria-selected={inUse}
                    // Structural hooks rather than styling ones, on the reasoning
                    // `data-turn` records: a test reading a row's text is pinned
                    // to the words it happens to be drawn with, and a test reading
                    // a class is pinned to the styling.
                    data-endpoint={status.id}
                    data-configured={status.configured ? "true" : "false"}
                    ref={onIt ? activeRowRef : undefined}
                    // The pointer is a way in, never the only one, and choosing
                    // with it still needs the search field to hold the caret: a
                    // mousedown let through would blur it, and the panel would read
                    // that as a press outside and close before the click arrived.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => goTo(index)}
                    onClick={() => onChoose(status)}
                    className={`${ROW} cursor-pointer ${
                      onIt ? "bg-paper-3 text-ink" : "text-ink-2 hover:bg-paper-2"
                    }`}
                  >
                    {/* Always present and always the same width, so a name is not
                        pushed along by the mark beside it. */}
                    <span className={`${MARK} text-accent`}>{inUse && <Tick />}</span>
                    <span className={NAME}>{status.name}</span>
                    <span className={`${CREDENTIAL} text-xs`}>{credentialOf(status)}</span>
                    <span className={`${MODEL} text-muted`} title={status.defaultModelId}>
                      {status.defaultModelId}
                    </span>
                  </li>
                );
              })}
            </li>
          ))
        )}
      </ul>
    </>
  );
}

/**
 * Says one thing about the chosen Endpoint, so the control is never silent.
 *
 * Named for what it does rather than `describe`, which reads as the test
 * framework's global and invites a reader looking for a test to find this
 * instead.
 *
 * The unconfigured case names the environment variable to set, because that is the
 * whole answer to "why isn't this working?" and reading source to find it would be
 * a poor thing to ask of someone setting up an Endpoint.
 */
function sayAboutChosen(
  answer: { statuses: readonly EndpointStatus[]; trouble: string | null },
  chosen: EndpointStatus | undefined,
): string {
  if (answer.trouble !== null) return answer.trouble;

  // Covers both "the list has not arrived" and "the chosen id is no longer
  // offered", which read the same way to the reader: there is nothing here to
  // say about an Endpoint this app is not currently offering.
  if (chosen === undefined) return "Choose an Endpoint to hold a Conversation.";

  if (chosen.configured) {
    // Compared against null rather than undefined: the Registry route sends a
    // Local Endpoint's variable as JSON null, and a Local Endpoint says so here
    // rather than being left indistinguishable from a Cloud one that is set up.
    return chosen.credentialEnvVar === null
      ? `${chosen.name} runs on this machine and needs no Credential.`
      : `${chosen.name} is Configured.`;
  }

  return `${chosen.name} has no Credential, so it cannot receive messages yet. Set ${chosen.credentialEnvVar} and try again.`;
}

/**
 * What one row says about its Credential, in the fewest words that answer "can I
 * use this today".
 *
 * Three states rather than two, because a Local Endpoint needs no Credential at
 * all — saying nothing about it would leave it indistinguishable from a Cloud
 * Endpoint whose Credential happens to be set, which is the opposite of the fact.
 */
function credentialOf(status: EndpointStatus): string {
  if (status.credentialEnvVar === null) return "Not needed";
  return status.configured ? "Configured" : "Not set";
}