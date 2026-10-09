/**
 * Which Endpoint and Model the reader last chose, kept between visits.
 *
 * Setting this app up is not free. A Cloud Endpoint needs a Credential typed in
 * before it can be used at all, and the Model someone compared and settled on
 * for the work in hand is a decision that cost something to arrive at. Asking
 * for either again on every visit puts the re-configuration between the reader
 * and the first Turn, which is the difference between opening the app and
 * starting work in it.
 *
 * Two values, kept in two slots rather than one, and for a reason rather than
 * by accident: the Endpoint is a single id that has to be checked against the
 * Registry before it can be used, while the Model choices are a map that does
 * not. Storage outlives the version that wrote it and the Catalog is edited by
 * hand, so an id read back here can name an Endpoint this build no longer
 * offers. Held apart, that costs the reader one choice rather than both of
 * theirs.
 *
 * Nothing coming back out is trusted to be the shape it was written as, for
 * the same reason `lib/theme.ts` treats it as untrusted: this is name-and-value
 * storage, readable and editable by hand and shared across versions of the app.
 * An unusable value resolves to the default rather than to nothing, because
 * "opens on Ollama again" is an annoyance and "opens on nothing" is an app that
 * cannot be used.
 *
 * The reads here are pure functions over a Storage that is handed to them
 * rather than reached for, and the parsing is split out from the reading so the
 * same shapes can be checked without a browser in the room. Nothing in this
 * module may throw: a reader who has blocked storage has said something about
 * the next visit, not about this one.
 */

import { findEndpoint } from "@/lib/endpoints/registry";
import type { ModelSelection } from "@/lib/models/selection";

/** Where the chosen Endpoint is kept between visits. */
export const ENDPOINT_STORAGE_KEY = "multi-endpoint-chat.endpoint";

/** Where the Model chosen in each Endpoint is kept between visits. */
export const MODEL_CHOICES_STORAGE_KEY = "multi-endpoint-chat.models";

/**
 * How much of a stored Model map is read before it is refused outright.
 *
 * The map is one short Model identifier per Endpoint — a couple of hundred
 * entries would already be far more Endpoints than the Registry holds — and it
 * is parsed on a read the interface does on every visit. Past this size the
 * value is not something the app wrote, and paying to parse it would be
 * responding to hand-edited storage at the interface's expense.
 */
const MAX_STORED_MODEL_CHOICES = 64 * 1024;

/**
 * Reads one value, treating storage as unreachable rather than as empty.
 *
 * The whole read is inside the `try` because a browser with storage blocked
 * throws on the *access*, not only on the call — and because a `Storage` handed
 * in by a test, or by a caller holding a reference it obtained some other way,
 * may be a stand-in that throws too. `null` means "nothing usable here", which
 * every caller already has a defined answer for.
 */
export function storedValue(
  storage: Pick<Storage, "getItem"> | null | undefined,
  key: string,
): string | null {
  if (!storage) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes one value, best effort.
 *
 * Never throws and never blocks the interface. The reader who just chose
 * something has asked for it to be in force now, and a browser that refuses to
 * keep it has cost them the next visit rather than this one.
 */
export function writeStoredValue(
  storage: Pick<Storage, "setItem"> | null | undefined,
  key: string,
  value: string,
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Deliberately empty: see above.
  }
}

/**
 * The Endpoint to open on, from a stored id.
 *
 * The Registry decides which Endpoints exist, so it is what settles whether a
 * stored id means anything here. An id it does not know resolves to `fallback`
 * rather than being carried through: an unchecked id would leave the
 * Conversation pointed at an Endpoint with no name and no starting Model, which
 * reads as a broken app rather than as a forgotten choice.
 */
export function parseChosenEndpoint(raw: string | null, fallback: string): string {
  if (raw === null) return fallback;

  const trimmed = raw.trim();

  return findEndpoint(trimmed) ? trimmed : fallback;
}

/**
 * The Model choices, from a stored map.
 *
 * Entries are kept as they are and only checked for being what was written: a
 * Model the reader picked that Model Discovery does not currently list is
 * still their choice, and one this Endpoint no longer recognises is reported by
 * name when it rejects the Request. Discarding it here instead would silently
 * move them onto a different Model than the one they chose.
 *
 * Built with `fromEntries` rather than assigned onto an object literal, because
 * a key of `__proto__` in hand-edited storage would otherwise set the prototype
 * of the map rather than become an entry in it.
 */
export function parseModelChoices(raw: string | null): ModelSelection {
  if (raw === null || raw.length === 0) return {};
  if (raw.length > MAX_STORED_MODEL_CHOICES) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Truncated by a quota that filled mid-write, or edited into something that
    // is not JSON. Either way there is no map to be had.
    return {};
  }

  // An array or a bare value parses without complaint and is not a map of
  // Endpoints to Models, so the shape is checked rather than assumed.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const kept: [string, string][] = [];

  for (const [endpointId, modelId] of Object.entries(parsed)) {
    // The same guard `rememberModel` applies when the choice is made, kept here
    // so a value that arrives from storage is held to it as well.
    if (typeof modelId !== "string") continue;
    if (endpointId.length === 0 || modelId.trim().length === 0) continue;

    kept.push([endpointId, modelId.trim()]);
  }

  return Object.fromEntries(kept);
}

/** The Endpoint the reader last chose, or the one the app opens on. */
export function readChosenEndpoint(
  storage: Pick<Storage, "getItem"> | null | undefined,
  fallback: string,
): string {
  return parseChosenEndpoint(storedValue(storage, ENDPOINT_STORAGE_KEY), fallback);
}

/** The Model chosen in each Endpoint, as last remembered. */
export function readModelChoices(
  storage: Pick<Storage, "getItem"> | null | undefined,
): ModelSelection {
  return parseModelChoices(storedValue(storage, MODEL_CHOICES_STORAGE_KEY));
}

/**
 * Keeps an Endpoint for next time, returning what was written.
 *
 * An empty Endpoint is not written and nothing is returned: it would be stored
 * in preference to a real one and then be the value every later visit has to
 * reject.
 *
 * The written value comes back rather than being read again, because a caller
 * that has to announce the change cannot get it back out of a browser that
 * refused the write — and the choice the reader just made still has to be the
 * one in force.
 */
export function writeChosenEndpoint(
  storage: Pick<Storage, "setItem"> | null | undefined,
  endpointId: string,
): string | null {
  const trimmed = endpointId.trim();
  if (trimmed.length === 0) return null;

  writeStoredValue(storage, ENDPOINT_STORAGE_KEY, trimmed);
  return trimmed;
}

/**
 * Keeps the Model choices for next time, returning what was written.
 *
 * Written as one value rather than one slot per Endpoint: the map is small, it
 * is always read whole, and a single write cannot leave half of it behind.
 */
export function writeModelChoices(
  storage: Pick<Storage, "setItem"> | null | undefined,
  choices: ModelSelection,
): string | null {
  const serialised = JSON.stringify(choices);

  writeStoredValue(storage, MODEL_CHOICES_STORAGE_KEY, serialised);
  return serialised;
}
