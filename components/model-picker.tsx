"use client";

import { useCallback, useEffect, useState } from "react";

import { requestModels, type DiscoveryAnswer } from "@/lib/models/request";

/**
 * Choosing a Model: pick from what an Endpoint reports it has, or type an
 * identifier when it cannot be asked.
 *
 * Discovery runs against the app's own server, which proxies to the Endpoint —
 * the browser never contacts an Endpoint directly, so no Credential is ever in
 * a request it constructs.
 */

/** The control the reader reaches for to type an identifier instead of picking. */
const MANUAL_OPTION = "__type_an_identifier__";

export type ModelPickerProps = {
  endpointId: string;
  /** The Model currently in use, whether picked, typed, or declared by default. */
  modelId: string;
  /** Called with the identifier to use, already trimmed. */
  onSelect: (modelId: string) => void;
  /** How the Endpoint is named in messages, so it reads as this Endpoint and not another. */
  endpointName: string;
};

/** An answer, tagged with the Endpoint and the run that produced it. */
type Answered = {
  endpointId: string;
  /** Distinguishes re-runs, so pressing Refresh shows as asking again. */
  run: number;
  answer: DiscoveryAnswer;
};

export function ModelPicker({
  endpointId,
  modelId,
  onSelect,
  endpointName,
}: ModelPickerProps) {
  const [run, setRun] = useState(0);
  const [answered, setAnswered] = useState<Answered | null>(null);
  // Keyed by Endpoint rather than a bare flag, so the typed-identifier field
  // belongs to the Endpoint it was opened for and switching back does not
  // silently reopen it.
  const [manualFor, setManualFor] = useState<string | null>(null);

  // Asked whenever the selected Endpoint changes, so switching Endpoints shows
  // that Endpoint's Models rather than the previous one's. An answer left in
  // flight for a previous Endpoint is discarded rather than shown here.
  useEffect(() => {
    let current = true;

    void requestModels(endpointId).then((answer) => {
      if (current) setAnswered({ endpointId, run, answer });
    });

    return () => {
      current = false;
    };
  }, [endpointId, run]);

  // Derived rather than stored, so there is no render in which the previous
  // Endpoint's list is shown against the new Endpoint's name.
  const current = answered?.endpointId === endpointId && answered.run === run ? answered.answer : null;

  const discovered = current?.status === "found" ? current.models : [];

  const showManual = manualFor === endpointId || discovered.length === 0;

  const refresh = useCallback(() => setRun((previous) => previous + 1), []);

  function submitManual() {
    const identifier = modelId.trim();
    if (identifier.length > 0) onSelect(identifier);
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-black/[.08] pb-3 dark:border-white/[.15]">
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-zinc-500" htmlFor="model-picker">
          Model
        </label>

        {showManual ? (
          <input
            id="model-picker"
            value={modelId}
            onChange={(event) => onSelect(event.target.value)}
            onBlur={submitManual}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitManual();
            }}
            placeholder="Model identifier"
            aria-describedby="model-discovery-message"
            className="min-w-0 flex-1 rounded-md border border-black/[.1] bg-transparent px-2 py-1 text-sm outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
          />
        ) : (
          <select
            id="model-picker"
            value={modelId}
            onChange={(event) => {
              if (event.target.value === MANUAL_OPTION) {
                setManualFor(endpointId);
                return;
              }
              onSelect(event.target.value);
            }}
            className="min-w-0 flex-1 rounded-md border border-black/[.1] bg-transparent px-2 py-1 text-sm outline-none focus:border-black/30 dark:border-white/[.15]"
          >
            {/* A Model chosen by hand stays shown even when not on the list, so
                the identifier that will be used is never hidden from the reader. */}
            {!discovered.includes(modelId) && <option value={modelId}>{modelId}</option>}
            {discovered.map((identifier) => (
              <option key={identifier} value={identifier}>
                {identifier}
              </option>
            ))}
            <option value={MANUAL_OPTION}>Type an identifier...</option>
          </select>
        )}

        {/* Re-runs discovery on demand, so a Model loaded a moment ago appears
            without restarting anything. */}
        <button
          type="button"
          onClick={refresh}
          disabled={current === null}
          className="shrink-0 rounded-md border border-black/[.08] px-2 py-1 text-xs disabled:opacity-40 dark:border-white/[.15]"
        >
          {current === null ? "Asking..." : "Refresh"}
        </button>
      </div>

      <p id="model-discovery-message" role="status" className="text-xs text-zinc-500">
        {describe(current, endpointName, showManual)}
      </p>
    </div>
  );
}

/**
 * Says what discovery found, so the control is never empty without an
 * explanation. Each outcome asks something different of the reader: start the
 * server, load a Model, or fall back to typing an identifier.
 */
function describe(
  answer: DiscoveryAnswer | null,
  endpointName: string,
  showManual: boolean,
): string {
  if (answer === null) return `Asking ${endpointName} which Models it has...`;

  if (answer.status === "found") {
    const count = answer.models.length;
    return `${endpointName} reports ${count} Model${count === 1 ? "" : "s"}.`;
  }

  // Every outcome below leaves the typed-identifier field in reach, which is
  // what keeps an Endpoint that cannot be discovered usable.
  const fallback = showManual ? " Type an identifier below." : "";

  if (answer.status === "empty") {
    return `${endpointName} reports no Models. Load one with its own tooling, then press Refresh.${fallback}`;
  }

  if (answer.status === "refused") {
    return `${answer.message}${fallback}`;
  }

  const detail = answer.message ? ` ${answer.message}` : "";

  if (answer.status === "unreachable") {
    return `Could not reach ${endpointName}. Check that it is running, then press Refresh.${detail}${fallback}`;
  }

  return `${endpointName} cannot be asked which Models it has.${detail}${fallback}`;
}