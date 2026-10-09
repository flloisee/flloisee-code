"use client";

import { useState } from "react";

import { Modal } from "@/components/modal";
import {
  declareEndpointFromInterface,
  declaringIsAvailable,
  forgetEndpointFromInterface,
  type CredentialAnswer,
  type DeclareAnswer,
} from "@/lib/endpoints/declare-request";
import type { EndpointStatus } from "@/lib/endpoints/status";

/**
 * Declaring an Endpoint the app does not already know: a server on the reader's
 * own network that the Catalog has no entry for.
 *
 * A button and a dialog rather than a field among the Endpoint picker's options,
 * for two reasons. A base URL typed into the picker would sit in a control whose
 * whole job is choosing from a list, and it would be one keystroke from looking
 * like the list is editable. And an Endpoint declared this way is the reader's
 * own — it is offered under "Added by you" and nowhere else — so the act of
 * creating one belongs beside that group rather than inside the Catalog's.
 *
 * Mounted only while open, so the Credential in the field is discarded when the
 * dialog closes rather than sitting in a parent that outlives it. Nothing this
 * component holds could hold a stored Credential: the field holds what was
 * typed, and it is emptied the moment it has been sent.
 */

export type DeclareEndpointProps = {
  /**
   * The Endpoints the reader has already declared, so each can be offered for
   * removal here rather than in the picker — where a `<select>` has no room for
   * a control beside it.
   */
  declared: readonly EndpointStatus[];
  /**
   * Called after something is written and the dialog has nothing left to say, so
   * the Registry is read again and the dialog closes.
   *
   * That is the declaration of an Endpoint needing no Credential, and a removal:
   * in both the outcome is the picker behind this dialog changing, which is the
   * whole thing the reader asked for.
   */
  onChanged: () => void;
  /**
   * Called after a Credential is written, which does not close the dialog.
   *
   * Kept separate because a shadowed or not-yet-applied key is invisible in the
   * picker either way — the Endpoint looks the same Configured or not. Closing
   * here would be the one case where the interface reported an outcome nobody
   * could read.
   */
  onStored: () => void;
};

export function DeclareEndpoint({ declared, onChanged, onStored }: DeclareEndpointProps) {
  const [open, setOpen] = useState(false);

  // The route answers 404 outside development, so an interface offering this
  // everywhere would be offering a button that can only fail. Checked here, the
  // one place that decides, rather than in Settings.
  if (!declaringIsAvailable()) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hm-btn hm-btn--quiet hm-btn--sm self-start"
      >
        Add your own Endpoint
      </button>

      {open && (
        <DeclareEndpointDialog
          declared={declared}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
          onStored={onStored ?? onChanged}
        />
      )}
    </>
  );
}

/**
 * The dialog itself, split out so closing it unmounts it.
 *
 * Three fields and nothing else, in the order they are needed: what to call it,
 * where it is, and what it needs to authenticate. The Model list sits last
 * because it is the longest and the least often edited — one Model is the
 * ordinary answer, and Model Discovery replaces the list the moment the Endpoint
 * answers.
 */
function DeclareEndpointDialog({
  declared,
  onClose,
  onChanged,
  onStored,
}: DeclareEndpointProps & {
  onClose: () => void;
  onChanged: () => void;
  onStored: () => void;
}) {
  const [name, setName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [credential, setCredential] = useState("");
  const [models, setModels] = useState<string[]>([""]);
  const [answer, setAnswer] = useState<DeclareAnswer | null>(null);
  const [sending, setSending] = useState(false);

  const ready =
    name.trim().length > 0 &&
    baseURL.trim().length > 0 &&
    models.some((model) => model.trim().length > 0);

  function setModelAt(index: number, value: string) {
    setModels((current) => current.map((model, at) => (at === index ? value : model)));
  }

  function addModel() {
    setModels((current) => [...current, ""]);
  }

  function removeModelAt(index: number) {
    // One row is never removed: a list of zero Models cannot be sent, and a
    // dialog with no way to type one is a dialog with nothing to do.
    if (models.length === 1) return;
    setModels((current) => current.filter((_, at) => at !== index));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sending || !ready) return;

    setSending(true);

    const outcome = await declareEndpointFromInterface({
      name: name.trim(),
      baseURL: baseURL.trim(),
      models: models.map((model) => model.trim()).filter((model) => model.length > 0),
      ...(credential.trim().length > 0 ? { credential: credential.trim() } : {}),
    });

    // Emptied before the answer is shown, and before anything can re-render the
    // dialog: once it has been sent it has no further business being in the
    // browser, whether or not it was accepted. The same rule Key Entry follows.
    setCredential("");
    setAnswer(outcome);
    setSending(false);

    // An Endpoint written on disk changes what the server offers, so the whole
    // interface is re-read — this is what makes the new Endpoint appear in the
    // picker, and carry its name and Model in the chat header, without a reload.
    //
    // A Credential gets its own call so the dialog can stay open and say what
    // became of it. A shadowed or not-yet-applied key is invisible in the list
    // either way, and closing here would be the one case where the interface
    // reported an outcome nobody could read.
    if (outcome.status === "declared") {
      if (outcome.credential.kind === "noneNeeded") {
        onChanged();
      } else {
        onStored();
      }
    }
  }

  async function handleForget(id: string) {
    if (sending) return;

    setSending(true);
    const outcome = await forgetEndpointFromInterface(id);

    if (outcome.status === "forgotten") {
      // A removal is not a message the reader needs to dismiss before the dialog
      // goes: the Endpoint they asked to remove is gone, which is the whole
      // answer, and the picker behind it now says so.
      onChanged();
      onClose();
    } else if (outcome.status === "refused") {
      setAnswer(outcome);
      setSending(false);
    }
  }

  return (
    <Modal labelledBy="declare-endpoint-heading" onClose={onClose}>
      <h2 id="declare-endpoint-heading" className="font-display text-md font-semibold text-ink">
        Add your own Endpoint
      </h2>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <p className="text-sm text-muted">
          For a server the app has no entry for — something running on your own machine or your
          own network. It is saved to this project&rsquo;s{" "}
          <code className="font-mono">.endpoints.json</code>, and any Credential you type is
          written to this machine&rsquo;s environment file rather than to that file.
        </p>

        <div className="flex flex-col gap-1">
          <label className="hm-label" htmlFor="declare-endpoint-name">
            Name
          </label>
          <input
            id="declare-endpoint-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={sending}
            autoComplete="off"
            spellCheck={false}
            placeholder="My server"
            className="hm-field"
          />
        </div>

        <div className="flex flex-col gap-1">
          {/* The mono register: this is a URL, and it has to be readable character
              by character to be right — which is how the app will report it back
              if the Endpoint cannot be reached. */}
          <label className="hm-label" htmlFor="declare-endpoint-url">
            Base URL
          </label>
          <input
            id="declare-endpoint-url"
            value={baseURL}
            onChange={(event) => setBaseURL(event.target.value)}
            disabled={sending}
            autoComplete="off"
            spellCheck={false}
            placeholder="http://localhost:8000/v1"
            aria-describedby="declare-endpoint-url-hint"
            className="hm-field font-mono"
          />
          <p id="declare-endpoint-url-hint" className="text-xs text-muted">
            The whole address, including the scheme and the port.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="hm-label" htmlFor="declare-endpoint-credential">
            Credential <span className="font-normal text-muted">(optional)</span>
          </label>
          {/* `type="password"` so it is not shown over a shoulder, and
              `autoComplete="off"` so nothing pre-fills it from what the browser
              has remembered. The value here is only ever what was typed. */}
          <input
            id="declare-endpoint-credential"
            type="password"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            disabled={sending}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={answer?.status === "refused" ? true : undefined}
            aria-describedby="declare-endpoint-credential-hint"
            className="hm-field font-mono"
          />
          <p id="declare-endpoint-credential-hint" className="text-xs text-muted">
            Leave this empty for a server on your own machine that needs no key.
          </p>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="hm-label">Models</legend>

          {models.map((model, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={model}
                onChange={(event) => setModelAt(index, event.target.value)}
                disabled={sending}
                autoComplete="off"
                spellCheck={false}
                aria-label={`Model ${index + 1}`}
                placeholder={index === 0 ? "llama3.2" : "another model"}
                className="hm-field flex-1 font-mono"
              />
              {models.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeModelAt(index)}
                  disabled={sending}
                  className="hm-btn hm-btn--quiet hm-btn--sm shrink-0"
                >
                  Remove
                </button>
              )}
            </div>
          ))}

          <p id="declare-endpoint-models-hint" className="text-xs text-muted">
            The first one is used until you pick another. The app asks the Endpoint which Models it
            has, so this only has to be right if it cannot answer.
          </p>

          <button
            type="button"
            onClick={addModel}
            disabled={sending}
            className="hm-btn hm-btn--quiet hm-btn--sm self-start"
          >
            Add another Model
          </button>
        </fieldset>

        <DeclareAnswerMessage answer={answer} />

        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="hm-btn">
            Close
          </button>
          <button type="submit" disabled={sending || !ready} className="hm-btn hm-btn--primary">
            {sending ? "Adding..." : "Add Endpoint"}
          </button>
        </div>
      </form>

      {declared.length > 0 && (
        <DeclaredEndpoints endpoints={declared} busy={sending} onForget={handleForget} />
      )}
    </Modal>
  );
}

/**
 * The Endpoints the reader has added, and the one way to take them off.
 *
 * Here rather than in the picker because a `<select>` has nowhere to put a
 * control per row, and because removing an Endpoint is a rarer and more
 * deliberate act than choosing one — it deletes a file entry and a stored
 * Credential, so it is not the sort of thing to hide behind a dropdown.
 *
 * Every row states what removing it takes with it, because a Credential stored
 * in a file the reader cannot see from here would otherwise be a secret they
 * did not know they were deleting.
 */
function DeclaredEndpoints({
  endpoints,
  busy,
  onForget,
}: {
  endpoints: readonly EndpointStatus[];
  busy: boolean;
  onForget: (id: string) => void;
}) {
  return (
    <div className="mt-5 border-t border-rule pt-4">
      <span className="hm-label">Yours</span>

      <ul className="mt-2 flex flex-col gap-2">
        {endpoints.map((endpoint) => (
          <li key={endpoint.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm text-ink">{endpoint.name}</span>
              <p className="mt-0.5 text-xs text-muted">
                {endpoint.credentialEnvVar === null
                  ? "Needs no Credential."
                  : `Credential stored in ${endpoint.credentialEnvVar}.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onForget(endpoint.id)}
              disabled={busy}
              className="hm-btn hm-btn--sm text-error shrink-0"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the declaration did, in words worth acting on.
 *
 * The Credential outcomes are the same distinctions Key Entry makes, for the same
 * reasons: a Credential written to the file and a Credential the process is
 * serving are two different facts, and reporting the first as the second would
 * send the reader off to send a message and fail.
 *
 * `noneNeeded` is deliberately a success and not a silence. A server on the
 * reader's own machine needing no key is the ordinary case for this dialog, and
 * an answer that read as an absence would make the common path look like the one
 * that went wrong.
 */
function DeclareAnswerMessage({ answer }: { answer: DeclareAnswer | null }) {
  if (answer === null) return null;

  if (answer.status === "declared") {
    return (
      <p role="status" className="hm-status hm-status--ok">
        {`${answer.endpointName} added, using ${answer.defaultModelId}. ${whatAboutCredential(answer.credential)}`}
      </p>
    );
  }

  // A removal closes the dialog rather than being reported here, so this only
  // ever has a message when there is something to refuse.
  if (answer.status === "forgotten") return null;

  return (
    <p role="alert" className="hm-status hm-status--error">
      {answer.message}
    </p>
  );
}

function whatAboutCredential(credential: CredentialAnswer): string {
  if (credential.kind === "noneNeeded") return "It needs no Credential.";

  if (credential.kind === "stored") return `Its Credential is in use now, from ${credential.envVar}.`;

  if (credential.kind === "notApplied") {
    return `Its Credential is in ${credential.envVar}, but this process is not carrying it yet. ` +
      "Restart the dev server and add the Endpoint again.";
  }

  if (credential.kind === "shadowed") {
    return `Its Credential is in ${credential.envVar}, but a value exported in your shell is the one ` +
      `being used. Unset ${credential.envVar} and restart it.`;
  }

  if (credential.kind === "unusable") {
    return "The Endpoint was added, but its Credential has a character that cannot be stored, " +
      "so none was written. Add it again without one.";
  }

  return `The Endpoint was added, but its Credential could not be written to ${credential.envVar}. ` +
    "Add it again to try.";
}
