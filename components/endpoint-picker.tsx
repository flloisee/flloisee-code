"use client";

import { useCallback } from "react";

import { DeclareEndpoint } from "@/components/declare-endpoint";
import { KeyEntry } from "@/components/key-entry";
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
 * The one place a base URL is typed is the button below, which opens a dialog
 * rather than a field here. That separation is the point: this control is about
 * choosing among Endpoints that exist, and an editable-looking dropdown is an
 * invitation to type into a control that was never going to read it.
 */

export type EndpointPickerProps = {
  /** The Endpoint in use, which is the one the list shows selected. */
  endpointId: string;
  /** Called with the id of the Endpoint chosen. */
  onSelect: (endpointId: string) => void;
};

export function EndpointPicker({ endpointId, onSelect }: EndpointPickerProps) {
  const answer = useRegistry();

  // Announced rather than fetched here. The Environment and `.endpoints.json`
  // have both changed underneath a running server, so every view of the Registry
  // is now stale — not just this list — and asking again on its own would leave
  // the rest of the interface showing the previous answer.
  const onStored = useCallback(() => announceRegistryChanged(), []);

  const statuses = answer.statuses;
  const chosen = statuses.find((status) => status.id === endpointId);

  // Only a Cloud Endpoint needs a Credential, and only where Key Entry can run:
  // offering the button for a Local Endpoint, or outside development, would be
  // offering a dialog that cannot help.
  const keyEntryFor =
    keyEntryIsAvailable() && chosen?.credentialEnvVar != null ? chosen.id : null;

  // Every group is rendered even when empty, so the shape of the list does not
  // change with the Credential someone happens to have set. An Endpoint group
  // that appeared and vanished would make the control feel like it was
  // answering a question the reader did not ask.
  const grouped = ENDPOINT_GROUPS.map((group) => ({
    ...group,
    entries: statuses.filter((status) => status.group === group.kind),
  }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* The mono register: a field name, set like a label on a control panel
            rather than a heading. */}
        <label className="hm-label w-16 shrink-0" htmlFor="endpoint-picker">
          Endpoint
        </label>

        {/* Disabled until the list has arrived, and disabled again if the
            answer carried nothing to choose from. A list that arrived empty or
            unreadable is not a list of choices, and offering the control over it
            would be offering a stale or empty one — which is the exact thing the
            `trouble` line below is there to explain. */}
        <select
          id="endpoint-picker"
          value={endpointId}
          onChange={(event) => onSelect(event.target.value)}
          disabled={statuses.length === 0}
          className="hm-field flex-1"
        >
          {grouped.map(({ kind, label, entries }) => (
            <optgroup key={kind} label={label}>
              {entries.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                  {status.configured ? "" : " — no Credential"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Reserved one line whether or not there is anything to say, so an
          arriving message never shoves the Conversation down the page.

          The reader's own Endpoints are reported separately from the list's own
          failures: the built-in Endpoints are all present and usable, so a
          corrupt `.endpoints.json` must not read as the whole Registry being
          gone. */}
      <p role="status" className="hm-status">
        {answer.declaredTrouble ?? sayAboutChosen(answer, chosen)}
      </p>

      {keyEntryFor !== null && <KeyEntry endpointId={keyEntryFor} onStored={onStored} />}

      <DeclareEndpoint
        declared={statuses.filter((status) => status.group === "declared")}
        onChanged={onStored}
        onStored={onStored}
      />
    </div>
  );
}

/**
 * Says one thing about the chosen Endpoint, so the control is never silent.
 *
 * Named for what it does rather than `describe`, which reads as the test
 * framework's global and invites a reader looking for a test to find this
 * instead.
 *
 * The unconfigured case names the environment variable to set, because that is
 * the whole answer to "why isn't this working?" and reading source to find it
 * would be a poor thing to ask of someone setting up an Endpoint.
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
