"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { rememberModel, type ModelSelection } from "@/lib/models/selection";
import {
  ENDPOINT_STORAGE_KEY,
  MODEL_CHOICES_STORAGE_KEY,
  parseChosenEndpoint,
  parseModelChoices,
  storedValue,
  writeChosenEndpoint,
  writeModelChoices,
} from "@/lib/selection/store";

/**
 * The Endpoint in use, and the Model chosen in each Endpoint, kept between visits.
 *
 * Setting this app up is not free. A Cloud Endpoint needs a Credential typed in
 * before it can be used at all, and the Model someone compared and settled on
 * for the work in hand is a decision that cost something to arrive at. Asking
 * for either again on every visit puts the re-configuration between the reader
 * and the first Turn, which is the difference between opening the app and
 * starting work in it.
 *
 * Read through `useSyncExternalStore` rather than out of storage during render.
 * The server cannot know what was stored, so it renders the Endpoint the app
 * opens on; a value read during the hydration render would disagree with it and
 * cost a hydration error, and a correction applied afterwards in an effect is a
 * visible jump from one Endpoint to another. `useSyncExternalStore` is built for
 * exactly this — the server snapshot for the render that has to match the
 * server, the stored one afterwards.
 *
 * What is held is the stored string rather than anything derived from it. That
 * is what keeps the snapshot a value React can compare, rather than a map parsed
 * afresh on every render and handed to the picker as a new selection each time.
 *
 * The choice is kept in memory as well as in storage, and memory is what the
 * interface draws from. That is what makes a reader who has blocked storage get
 * their choice for this visit rather than none of it: the write fails quietly
 * and the change is still in force. It also means clearing this site's data
 * leaves the app on what it was last told until it is reloaded, which is the
 * same bargain a reader has with a Theme that has already been applied to the
 * page.
 */

/**
 * The stored value of `localStorage`, or nothing when storage cannot be reached
 * at all.
 *
 * Reading the `localStorage` *property* is itself the operation that throws in a
 * browser with storage blocked — it is not a safe way to obtain a Storage to ask
 * later. So the access is guarded here and `lib/selection/store.ts` stays free
 * of any reference to `window`.
 */
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** What the reader last chose, exactly as stored. */
type Remembered = {
  endpoint: string | null;
  models: string | null;
};

/**
 * The remembered choice, read once per mount.
 *
 * Once, because a `Storage` handed in here is the browser's and the answer does
 * not change underfoot: every later change arrives by the event below instead.
 */
function readFromStorage(): Remembered {
  return {
    endpoint: storedValue(safeStorage(), ENDPOINT_STORAGE_KEY),
    models: storedValue(safeStorage(), MODEL_CHOICES_STORAGE_KEY),
  };
}

/**
 * What the server rendered, and what the reader is left with before hydration.
 *
 * Nothing stored, because the server has no way to know: it renders the Endpoint
 * the app opens on, and the stored choice is adopted once the client takes over.
 */
function nothingStored(): null {
  return null;
}

/** Announces a change made here, which no other route would deliver. */
function announce(key: string, newValue: string): void {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}

export type UseSelection = {
  /** The Endpoint the Conversation is held with: the one remembered, or the one the app opens on. */
  endpointId: string;
  /** The Model chosen in each Endpoint, as last remembered. */
  models: ModelSelection;
  /** Chooses the Endpoint, and keeps it for next time. */
  chooseEndpoint: (endpointId: string) => void;
  /** Chooses the Model in one Endpoint, leaving the other Endpoints' choices alone. */
  chooseModel: (endpointId: string, modelId: string) => void;
};

/**
 * Holds the Endpoint and the Model choices, keeping them between visits.
 *
 * `defaultEndpointId` is the Endpoint the app opens on, handed in by the page
 * that chose it. It is what is used when nothing usable has been remembered, so
 * the choice of default stays where it was made rather than being repeated here.
 *
 * `declaredIds` are the Endpoints the reader added, as the server reported them.
 * They exist here for one reason: a stored id is checked against the Registry
 * before it is believed, and an Endpoint the reader declared is not in the
 * Registry — it is in a file only the server can read. Passing the ids in keeps
 * the check honest without this module having to read anything, and keeps a
 * remembered custom Endpoint from being discarded as unknown on the next visit.
 */
export function useSelection(
  defaultEndpointId: string,
  declaredIds: readonly string[] = [],
): UseSelection {
  const [remembered, setRemembered] = useState<Remembered>(readFromStorage);

  // Rebuilt only when the set of declared Endpoints actually changes, so a
  // re-render with the same ids does not hand `parseChosenEndpoint` a new Set
  // and re-resolve the choice underneath the interface.
  const known = useMemo(() => new Set(declaredIds), [declaredIds]);

  /**
   * Told whenever the stored choice changes, from this window or another.
   *
   * A `storage` event only reaches windows that did *not* make the change, so a
   * choice made here dispatches one for itself. Both directions therefore arrive
   * by the same route, and there is one way for the interface to be told rather
   * than two that could disagree.
   *
   * The event carries the new value rather than being read back out of storage,
   * which is what makes it usable for a change this window made: storage may
   * have refused the write that caused it.
   */
  const subscribe = useCallback((onChange: () => void) => {
    function adopted(event: StorageEvent) {
      // A null key is another window clearing storage outright, which moves both
      // of these at once. Adopting it is what stops the interface going on with
      // choices the reader believes they have just erased.
      if (event.key === null) {
        setRemembered({ endpoint: null, models: null });
      } else if (event.key === ENDPOINT_STORAGE_KEY) {
        setRemembered((current) => ({ ...current, endpoint: event.newValue }));
      } else if (event.key === MODEL_CHOICES_STORAGE_KEY) {
        setRemembered((current) => ({ ...current, models: event.newValue }));
      } else {
        // Some other preference, of this app or of another on this origin —
        // including `REGISTRY_CHANGED_KEY`, which changes what Endpoints exist
        // rather than what the reader chose. `useRegistry` listens for that one.
        return;
      }

      onChange();
    }

    window.addEventListener("storage", adopted);
    return () => window.removeEventListener("storage", adopted);
  }, []);

  const storedEndpoint = useSyncExternalStore(subscribe, () => remembered.endpoint, nothingStored);
  const storedModels = useSyncExternalStore(subscribe, () => remembered.models, nothingStored);

  const endpointId = parseChosenEndpoint(storedEndpoint, defaultEndpointId, known);

  // Parsed once per stored value rather than once per render, so the map the
  // interface draws from is the same object for as long as the choice has not
  // changed.
  const models = useMemo(() => parseModelChoices(storedModels), [storedModels]);

  const chooseEndpoint = useCallback((next: string) => {
    const written = writeChosenEndpoint(safeStorage(), next);
    if (written === null) return;

    announce(ENDPOINT_STORAGE_KEY, written);
  }, []);

  const chooseModel = useCallback((endpointId: string, modelId: string) => {
    const next = rememberModel(models, endpointId, modelId);

    // `rememberModel` hands back the map it was given when there is nothing to
    // remember — a blank Model — so this is also what keeps an empty one from
    // being written over a choice already made.
    if (next === models) return;

    const written = writeModelChoices(safeStorage(), next);
    if (written === null) return;

    announce(MODEL_CHOICES_STORAGE_KEY, written);
  }, [models]);

  return { endpointId, models, chooseEndpoint, chooseModel };
}
