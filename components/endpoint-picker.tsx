"use client";

import { useCallback, useEffect, useState } from "react";

import { KeyEntry } from "@/components/key-entry";
import { ENDPOINT_GROUPS } from "@/lib/endpoints/groups";
import { keyEntryIsAvailable } from "@/lib/endpoints/key-entry";
import { requestEndpoints } from "@/lib/endpoints/request";
import type { EndpointStatus } from "@/lib/endpoints/status";

/**
 * Choosing an Endpoint: pick one from the Registry by name, rather than typing a
 * base URL.
 *
 * The list and each Endpoint's Configured state come from the app's own server,
 * because whether a Credential is present is known only there — and no Credential
 * value ever crosses to the browser.
 */

export type EndpointPickerProps = {
  /** The Endpoint in use, which is the one the list shows selected. */
  endpointId: string;
  /** Called with the id of the Endpoint chosen. */
  onSelect: (endpointId: string) => void;
};

export function EndpointPicker({ endpointId, onSelect }: EndpointPickerProps) {
  const [answer, setAnswer] = useState<{
    statuses: readonly EndpointStatus[];
    trouble: string | null;
  } | null>(null);

  // Bumped after a Key Entry, to ask the Registry again. The Environment changed
  // underneath a running server, so what this list last said is stale — and the
  // Endpoint only shows as Configured because of that second read.
  const [reRead, setReRead] = useState(0);

  useEffect(() => {
    let current = true;

    void requestEndpoints().then((result) => {
      if (current) setAnswer(result);
    });

    return () => {
      current = false;
    };
  }, [reRead]);

  const onStored = useCallback(() => setReRead((previous) => previous + 1), []);

  const statuses = answer?.statuses ?? [];
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
    <div className="flex flex-col gap-2 border-b border-rule pb-3">
      <div className="flex items-center gap-3">
        {/* The mono register: a field name, set like a label on a control panel
            rather than a heading. */}
        <label className="hm-label w-16 shrink-0" htmlFor="endpoint-picker">
          Endpoint
        </label>

        <select
          id="endpoint-picker"
          value={endpointId}
          onChange={(event) => onSelect(event.target.value)}
          disabled={answer === null}
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
          arriving message never shoves the Conversation down the page. */}
      <p role="status" className="hm-status">
        {sayAboutChosen(answer, chosen)}
      </p>

      {keyEntryFor !== null && <KeyEntry endpointId={keyEntryFor} onStored={onStored} />}
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
  answer: { statuses: readonly EndpointStatus[]; trouble: string | null } | null,
  chosen: EndpointStatus | undefined,
): string {
  if (answer === null) return "Reading the Endpoint list...";

  if (answer.trouble !== null) return answer.trouble;

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
