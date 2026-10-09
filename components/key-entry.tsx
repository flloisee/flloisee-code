"use client";

import { useState } from "react";

import { submitCredential, type KeyEntryAnswer } from "@/lib/endpoints/key-entry";
import { findEndpoint } from "@/lib/endpoints/registry";

/**
 * Key Entry: supplying a Cloud Endpoint's Credential through the interface.
 *
 * The Credential is typed here, sent once to the app's own server, and never
 * held anywhere else. There is deliberately no state anywhere in this component
 * that a stored value could be written into — the field holds what was typed and
 * is emptied the moment it has been sent, so the only copy of a Credential that
 * ever exists in the browser is the one being typed.
 */

export type KeyEntryProps = {
  /** The Endpoint the Credential is for, named by id from the Registry. */
  endpointId: string;
  /** Called after a Credential is stored, so the Registry is read again. */
  onStored: () => void;
};

export function KeyEntry({ endpointId, onStored }: KeyEntryProps) {
  const [open, setOpen] = useState(false);

  const endpoint = findEndpoint(endpointId);

  // A Local Endpoint has no Credential, so there is nothing to enter for it and
  // no button to offer. Checked here rather than inside the dialog, so the
  // Registry is consulted once and the dialog is never mounted for an Endpoint
  // that could not use it.
  if (endpoint === undefined || endpoint.credentialEnvVar === undefined) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md border border-black/[.08] px-2 py-1 text-xs dark:border-white/[.15]"
      >
        Enter Credential
      </button>

      {open && (
        <KeyEntryDialog
          endpointName={endpoint.name}
          envVar={endpoint.credentialEnvVar}
          onClose={() => setOpen(false)}
          onStored={onStored}
        />
      )}
    </>
  );
}

/**
 * The dialog itself, split out so that closing it discards the field.
 *
 * Not a detail: the Credential lives in state for as long as the dialog is open,
 * and mounting and unmounting it means the state is discarded with it rather than
 * left behind in a parent that outlives the dialog. It also takes the variable
 * name rather than looking it up, so the one thing it writes under is a value
 * that has already been narrowed to a declared name.
 */
function KeyEntryDialog({
  endpointName,
  envVar,
  onClose,
  onStored,
}: {
  endpointName: string;
  /** The Catalog-declared name the Credential is stored under. */
  envVar: string;
  onClose: () => void;
  onStored: () => void;
}) {
  const [credential, setCredential] = useState("");
  const [answer, setAnswer] = useState<KeyEntryAnswer | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (sending || credential.length === 0) return;

    setSending(true);
    const outcome = await submitCredential({ envVar, credential });

    // Emptied before the answer is shown, and before anything can re-render the
    // dialog: once the Credential has been sent it has no further business being
    // in the browser, whether or not it was accepted.
    setCredential("");
    setAnswer(outcome);
    setSending(false);

    // The Environment changed underneath the server, so the Registry is stale.
    // Reading it again is what makes the Endpoint show as Configured without a
    // restart — the whole point of the round trip.
    if (outcome.status !== "refused") onStored();
  }

  // Width and height, not size. `w-full` against a `max-w-md` means the dialog
  // takes a narrow window rather than being cut off by it — it sits beside a
  // terminal often enough that "it fits whatever width is left" is the layout
  // rather than a refinement of it. The scroll bounds handle the other half: a
  // window shorter than the dialog scrolls it, so the field and Save are both
  // still reachable instead of sitting below the fold.
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-entry-heading"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 text-foreground shadow-lg dark:bg-zinc-900"
      >
        <h2 id="key-entry-heading" className="text-sm font-semibold">
          Credential for {endpointName}
        </h2>

        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <label className="text-xs font-medium text-zinc-500" htmlFor="key-entry-credential">
            Credential for {envVar}
          </label>

          {/* `type="password"` so a Credential is not shown over a shoulder, and
              `autoComplete="off"` so nothing pre-fills it from what the browser
              has remembered. The value here is only ever what was typed. */}
          <input
            id="key-entry-credential"
            type="password"
            value={credential}
            autoComplete="off"
            spellCheck={false}
            disabled={sending}
            onChange={(event) => setCredential(event.target.value)}
            className="rounded-md border border-black/[.1] bg-transparent px-2 py-1.5 font-mono text-sm outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
          />

          <KeyEntryMessage answer={answer} />

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-black/[.08] px-3 py-1.5 text-sm dark:border-white/[.15]"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={sending || credential.length === 0}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40"
            >
              {sending ? "Storing..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Says what the save did, including the two outcomes that are not a success.
 *
 * Both come off the route's `applied: false`, and both are "written but not in
 * use" — so both must avoid the stored wording, which would be the one message
 * that sends someone off to send a message and fail.
 *
 * `shadowedByShell` means a value exported in the shell is serving instead. The
 * file was written, so the Credential *is* stored, but until that export goes
 * the Endpoint is being called with something the reader did not just type, and
 * the fix is in their shell.
 *
 * `notApplied` means the environment is serving nothing at all for that name.
 * The file is correct and nothing is shadowing it; the process simply has not
 * picked it up, so the advice is to restart rather than to go hunting a shell.
 */
function KeyEntryMessage({ answer }: { answer: KeyEntryAnswer | null }) {
  if (answer === null) return null;

  if (answer.status === "stored") {
    return (
      <p role="status" className="text-xs text-green-700 dark:text-green-500">
        Stored in {answer.envVar}. It is in use now — no restart needed.
      </p>
    );
  }

  if (answer.status === "notApplied") {
    // Stored, and nothing is serving a different value — the environment simply
    // does not have this name yet. A warning rather than an alert: nothing is
    // wrong with the Credential, and the fix is not something in the reader's
    // shell either.
    return (
      <p role="alert" className="text-xs text-amber-700 dark:text-amber-500">
        {answer.envVar} is written to the environment file, but this process is not carrying it
        yet, so the Endpoint is still not Configured. Restart the dev server and enter it again.
      </p>
    );
  }

  if (answer.status === "shadowed") {
    return (
      <p role="alert" className="text-xs text-amber-700 dark:text-amber-500">
        {answer.envVar} was written to the environment file, but a value exported in your shell is
        the one being used, and it is not this Credential. Unset {answer.envVar} in the shell and
        restart it; until then this Endpoint keeps being called with the old value.
      </p>
    );
  }

  return (
    <p role="alert" className="text-xs text-red-600">
      {answer.message}
    </p>
  );
}
