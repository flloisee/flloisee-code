"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    let current = true;

    void requestEndpoints().then((result) => {
      if (current) setAnswer(result);
    });

    return () => {
      current = false;
    };
  }, []);

  const statuses = answer?.statuses ?? [];
  const chosen = statuses.find((status) => status.id === endpointId);

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
    return chosen.credentialEnvVar === undefined
      ? `${chosen.name} runs on this machine and needs no Credential.`
      : `${chosen.name} is Configured.`;
  }

  return `${chosen.name} has no Credential, so it cannot receive messages yet. Set ${chosen.credentialEnvVar} and try again.`;
}