"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Chevron,
  optionId,
  searchKeys,
  Tick,
  usePickerPopup,
  type Popup,
  type PopupRefs,
} from "@/components/picker-popup";
import { requestModels, type DiscoveryAnswer } from "@/lib/models/request";

/**
 * Choosing a Model: pick from what an Endpoint reports it has, or type an
 * identifier when it cannot be asked.
 *
 * Discovery runs against the app's own server, which proxies to the Endpoint —
 * the browser never contacts an Endpoint directly, so no Credential is ever in
 * a request it constructs.
 *
 * **The same searchable panel the Endpoint picker uses**, from `picker-popup.tsx`,
 * and for the same reason. An LM Studio or vLLM box can hold a hundred Models, and
 * they come back as bare identifiers with no human names attached —
 * `qwen3.5-4b-mlx`, `ornith-1.5-9b-uncensored-mlx` — so the one thing a reader can
 * search on is the string itself. A menu of them, unfilterable, is the same
 * hundred-names problem the Endpoint list had, and a shorter one.
 *
 * **The typed-identifier field is not an option in that list.** It was, and as an
 * option it was the least like the others by a wide margin: choosing it replaced
 * the control rather than choosing from it, so walking the list with the arrows
 * could land on an action rather than a Model. It is now a separate control below
 * the table, present whenever discovery did not work *and* whenever the reader
 * asks for it, so the answer to "what if the Endpoint has a Model this list does
 * not show" is always on screen and never in the middle of a walk.
 */

/** A Model identifier is a machine string, so the panel sets it in the mono register too. */
const ROW = "flex items-center gap-2 px-3 py-1.5 font-mono";
const NAME = "min-w-0 flex-1 truncate";
const MARK = "w-4 shrink-0";

/**
 * How narrow the panel may be.
 *
 * Narrower than the Endpoint panel's because it holds one column: a Model
 * identifier is the only thing in a row, so there is nothing to give width to
 * except the string — and `text-embedding-nomic-embed-text-v1.5` is already long
 * enough that a wider panel would not fit any more of it on a narrow window.
 */
const MIN_WIDTH_PX = 280;

/** An answer, tagged with the Endpoint and the run that produced it. */
type Answered = {
  endpointId: string;
  /** Distinguishes re-runs, so pressing Refresh shows as asking again. */
  run: number;
  answer: DiscoveryAnswer;
};

export type ModelPickerProps = {
  endpointId: string;
  /** The Model currently in use, whether picked, typed, or declared by default. */
  modelId: string;
  /** Called with the identifier to use, already trimmed. */
  onSelect: (modelId: string) => void;
  /** How the Endpoint is named in messages, so it reads as this Endpoint and not another. */
  endpointName: string;
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

  /** A fresh empty list per render is what the condition above would otherwise hand the memo below. */
const NO_MODELS: string[] = [];

const discovered = current?.status === "found" ? current.models : NO_MODELS;

  const showManual = manualFor === endpointId || discovered.length === 0;

  /**
   * What the table can offer.
   *
   * **A Model chosen by hand and absent from the list is offered anyway**, and
   * always first. It was an `<option>` bolted onto the top of the old list for the
   * same reason and this keeps it: a reader who has a Model working and then
   * restarts their Ollama must not find the control silently showing some other
   * Model, because the one they are using stopped being reported for a moment.
   */
  const offered = useMemo(() => {
    const typed = modelId.trim();
    return typed !== "" && !discovered.includes(typed) ? [typed, ...discovered] : discovered;
  }, [discovered, modelId]);

  const [popup, { triggerRef, searchRef, activeRowRef }] = usePickerPopup({
    items: offered,
    // Case-insensitive over the identifier alone, which is the whole of what an
    // Endpoint reports: `qwen3.5-4b-mlx` and `text-embedding-nomic-embed-text-v1.5`
    // have no other text to search. `-` and `_` are treated as one character so
    // that `qwen3.5_4b` finds `qwen3.5-4b-mlx`, which is how the same Model is
    // written by two different tools.
    matches: (identifier: string, wanted: string) =>
      identifier.toLowerCase().replaceAll("_", "-").includes(wanted.replaceAll("_", "-")),
    minWidthPx: MIN_WIDTH_PX,
  });

  const refresh = useCallback(() => setRun((previous) => previous + 1), []);

  const choose = useCallback(
    (identifier: string) => {
      onSelect(identifier);
      popup.hide(true);
    },
    [onSelect, popup],
  );

  function submitManual() {
    const identifier = modelId.trim();
    if (identifier.length > 0) onSelect(identifier);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* The mono register, and an `id` rather than a `<label for>`: which
            control it names depends on what discovery answered. A label pointing at
            one of the two would leave the other unnamed, and a screen reader
            meeting a control called only "Model identifier" has no way to know
            which field of Settings it is in. */}
        <span id="model-picker-label" className="hm-label w-16 shrink-0">
          Model
        </span>

        {/* A Model identifier is a machine string — `llama3.2:3b-instruct-q4_K_M`,
            `anthropic/claude-opus-4` — so the control holding it is set in the
            mono register too. An identifier rendered in the body face is harder to
            read character by character, which is how it has to be read. */}
        {showManual ? (
          <input
            id="model-picker"
            aria-labelledby="model-picker-label"
            value={modelId}
            onChange={(event) => onSelect(event.target.value)}
            onBlur={submitManual}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitManual();
            }}
            placeholder="Model identifier"
            aria-describedby="model-discovery-message"
            spellCheck={false}
            autoComplete="off"
            className="hm-field flex-1 font-mono"
          />
        ) : (
          <button
            ref={triggerRef}
            type="button"
            aria-labelledby="model-picker-label model-picker-shown"
            aria-haspopup="listbox"
            aria-expanded={popup.open}
            aria-controls={popup.open ? popup.listId : undefined}
            // The reader who already has a working Model cannot type another one
            // from here, so this is the control that asks for it.
            onClick={popup.toggle}
            data-chosen={modelId}
            className="hm-field flex cursor-pointer items-center justify-between gap-2 text-left font-mono"
          >
            <span id="model-picker-shown" className={NAME}>
              {modelId}
            </span>
            <Chevron />
          </button>
        )}

        {/* Re-runs discovery on demand, so a Model loaded a moment ago appears
            without restarting anything.
            Full height, not the small variant: it sits in the same row as the
            field beside it, and a 30px button next to a 36px field is the
            untuned-row tell. */}
        <button
          type="button"
          onClick={refresh}
          disabled={current === null}
          className="hm-btn hm-btn--quiet shrink-0"
        >
          {current === null ? "Asking..." : "Refresh"}
        </button>
      </div>

      {popup.layer(
        <ModelPanel
          popup={popup}
          refs={{ searchRef, activeRowRef }}
          modelId={modelId}
          onChoose={choose}
          onTypeInstead={() => {
            popup.hide(false);
            setManualFor(endpointId);
          }}
        />,
      )}

      <p id="model-discovery-message" role="status" className="hm-status">
        {describe(current, endpointName, showManual)}
      </p>

      {/* The escape hatch, and it sits here rather than in the list. Choosing it
          used to be the last option in a menu, which meant the arrows could walk
          onto an action that replaced the control rather than one that chose from
          it — and it is the answer to a question the list itself cannot answer,
          which is not a thing to hide in the middle of a walk. */}
      {!showManual && (
        <button
          type="button"
          onClick={() => setManualFor(endpointId)}
          className="hm-btn hm-btn--quiet hm-btn--sm self-start"
        >
          Type an identifier instead
        </button>
      )}
    </div>
  );
}

/** The searched list, as the panel holds it. */
function ModelPanel({
  popup,
  refs,
  modelId,
  onChoose,
  onTypeInstead,
}: {
  popup: Popup<string>;
  /** Passed beside `popup` rather than inside it, so a render never reads a ref. */
  refs: Pick<PopupRefs, "searchRef" | "activeRowRef">;
  /** The Model in use, which is the row that carries the mark. */
  modelId: string;
  onChoose: (identifier: string) => void;
  onTypeInstead: () => void;
}) {
  // Destructured rather than read as `refs.searchRef` at each use. The two are the
  // same to React, but the second is a property of an object that carries refs,
  // and a render reading one is a render the `react-hooks/refs` rule cannot tell
  // apart from a render reading a ref's `current` — which is the mistake that
  // rule exists to catch. A plain local is unambiguous.
  const { searchRef, activeRowRef } = refs;
  const { shown, listId, activeId, query, setQuery, hide, goTo } = popup;

  return (
    <>
      <div className="shrink-0 border-b border-rule p-2">
        <input
          ref={searchRef}
          type="search"
          role="combobox"
          aria-label="Search Models"
          aria-expanded={true}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={searchKeys(popup, () => {
            if (popup.active !== undefined) onChoose(popup.active);
          })}
          placeholder="Search Models"
          autoComplete="off"
          spellCheck={false}
          className="hm-field font-mono"
        />
      </div>

      <ul
        id={listId}
        role="listbox"
        aria-label="Models"
        className="hm-scroll min-h-0 flex-1 overflow-y-auto py-1"
      >
        {shown.length === 0 ? (
          <li role="presentation" className="flex flex-col items-start gap-2 px-3 py-3">
            <p className="text-sm text-ink-2">
              No Model here is named like that. Clear the search, or type the identifier
              yourself.
            </p>
            {/* Said here as well as below, because this is where a reader who has
                just searched for a Model they know exists arrives. */}
            <button
              type="button"
              onClick={() => {
                hide(false);
                onTypeInstead();
              }}
              className="hm-btn hm-btn--sm shrink-0"
            >
              Type an identifier instead
            </button>
          </li>
        ) : (
          shown.map((identifier, index) => {
            const id = optionId(listId, index);
            const onIt = id === activeId;
            const inUse = identifier === modelId;

            return (
              <li
                key={identifier}
                id={id}
                role="option"
                aria-selected={inUse}
                // Structural hooks, on the reasoning `data-turn` records: a test
                // reading a row's text is pinned to the words it happens to be
                // drawn with, and a test reading a class is pinned to the styling.
                data-model={identifier}
                ref={onIt ? activeRowRef : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => goTo(index)}
                onClick={() => onChoose(identifier)}
                className={`${ROW} cursor-pointer text-sm ${
                  onIt ? "bg-paper-3 text-ink" : "text-ink-2 hover:bg-paper-2"
                }`}
              >
                <span className={`${MARK} text-accent`}>{inUse && <Tick />}</span>
                <span className={NAME}>{identifier}</span>
              </li>
            );
          })
        )}
      </ul>
    </>
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