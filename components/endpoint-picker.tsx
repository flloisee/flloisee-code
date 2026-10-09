"use client";

import { useCallback, useEffect, useState } from "react";

import { KeyEntry } from "@/components/key-entry";
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

  return (
    <div className="flex flex-col gap-1.5 border-b border-black/[.08] pb-3 dark:border-white/[.15]">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-zinc-500" htmlFor="endpoint-picker">
          Endpoint
        </label>

        <select
          id="endpoint-picker"
          value={endpointId}
          onChange={(event) => onSelect(event.target.value)}
          disabled={answer === null}
          className="min-w-0 flex-1 rounded-md border border-black/[.1] bg-transparent px-2 py-1 text-sm outline-none focus:border-black/30 disabled:opacity-40 dark:border-white/[.15] dark:focus:border-white/40"
        >
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
              {status.configured ? "" : " — no Credential"}
            </option>
          ))}
        </select>
      </div>

      <p role="status" className="text-xs text-zinc-500">
        {describe(answer, chosen)}
      </p>

      {keyEntryFor !== null && <KeyEntry endpointId={keyEntryFor} onStored={onStored} />}
    </div>
  );
}

/**
 * Says one thing about the chosen Endpoint, so the control is never silent.
 *
 * The unconfigured case names the environment variable to set, because that is
 * the whole answer to "why isn't this working?" and reading source to find it
 * would be a poor thing to ask of someone setting up an Endpoint.
 */
function describe(
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