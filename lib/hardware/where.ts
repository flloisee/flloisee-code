import { networkInterfaces } from "node:os";

import { LOCAL_ENDPOINTS } from "@/lib/endpoints/registry";
import { readDeclaredEndpoints } from "@/lib/endpoints/custom";
import { RESERVED_ENDPOINT_IDS } from "@/lib/endpoints/registry";
import type { Endpoint } from "@/lib/endpoints/types";

/**
 * Whether the Models this app talks to actually run on this machine.
 *
 * The feature answers "what would run well here", and that question only means
 * something if *here* is where the Model runs. When it is, the answer is
 * straightforward. When it is not, the answer is worse than useless: the probe
 * reports the chips of whatever machine is serving the app, the estimate is
 * computed from those, and a reader is told their hardware cannot manage
 * anything but a 0.6B model when in fact their own machine runs a 4B at a
 * perfectly usable pace.
 *
 * The arrangements, and what is true of each:
 *
 *   the app and the Models on one machine      → the specs are about the reader
 *   the app on the reader's machine, Ollama on
 *     another machine across the LAN           → the specs describe the wrong box
 *
 * The second is the one that misleads, and it is worth guarding because it is a
 * *supported* arrangement rather than a hypothetical one: the README offers
 * declaring "a vLLM box, a llama.cpp server, anything speaking the
 * OpenAI-compatible format on their own network", so a reader with the app on
 * their laptop and the server on a box across the hall is following the
 * documentation exactly.
 *
 * What this does **not** catch is the app hosted on a platform where the only
 * Endpoints are Cloud ones. The Registry still carries the two hand-declared
 * Local Endpoints, both on loopback, so this reports "here" and the specs
 * describe the host. That case is out of scope for this app by a decision
 * recorded in the README — hosting would need an authentication story first —
 * so it is noted here rather than papered over. Detecting it would mean probing
 * whether a server is actually listening, which is a network request to
 * somewhere a reader did not name.
 *
 * Note this is not the same question as which Endpoint is selected, and
 * deliberately does not consult that. What the app should *recommend* and where
 * the Models actually *run* are separate concerns; a reader with Ollama and
 * OpenAI both configured should get recommendations regardless of which one the
 * composer is pointed at.
 */

/** Where the Models this app can reach actually run. */
export type Placement =
  /** Every Local Endpoint is on this machine, so the specs are about the reader. */
  | { at: "here" }
  /** At least one Local Endpoint is on another machine. */
  | { at: "elsewhere"; hosts: string[] };

/**
 * Works out where the Models run.
 *
 * Every Local Endpoint is resolved — the two declared in source and any the
 * reader has added to `.endpoints.json` — and each address compared against the
 * addresses this machine answers to.
 */
export async function whereModelsRun(directory: string): Promise<Placement> {
  const declared = await readDeclaredEndpoints(directory, RESERVED_ENDPOINT_IDS);

  const local: Endpoint[] = [...LOCAL_ENDPOINTS, ...declared.endpoints];

  // Declared Endpoints without a Credential variable are the reader's own
  // machines. One with a Credential is a service, wherever it runs, and says
  // nothing about where a Model would be decoded.
  const addresses = local
    .filter((endpoint) => !("credentialEnvVar" in endpoint && endpoint.credentialEnvVar !== undefined))
    .map((endpoint) => hostOf(endpoint.baseURL))
    .filter((host): host is string => host !== null);

  const mine = thisMachinesAddresses();

  const elsewhere = [...new Set(addresses)].filter((host) => !mine.has(host.toLowerCase()));

  // Every local address is this machine, so the specs are about the reader.
  if (elsewhere.length === 0) return { at: "here" };

  return { at: "elsewhere", hosts: elsewhere };
}

/**
 * The host part of an Endpoint's base URL.
 *
 * Returns null for anything that will not parse rather than a partial answer.
 * The addresses here come from source and from a file only this app writes, so
 * an unparseable one is a bug rather than a hostile input — but returning null
 * means it is skipped instead of being compared as though it were a hostname.
 */
function hostOf(baseURL: string): string | null {
  try {
    return new URL(baseURL).hostname;
  } catch {
    return null;
  }
}

/**
 * Every address this machine answers to, lowercased.
 *
 * Loopback and the unspecified address are included unconditionally: they are
 * how an Endpoint on this machine is nearly always written, and a reader who
 * declared `localhost` rather than a LAN address should not trip the guard.
 */
function thisMachinesAddresses(): ReadonlySet<string> {
  const addresses = new Set<string>(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"]);

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      addresses.add(entry.address.toLowerCase());
      // IPv6 arrives bracketed from a URL's hostname and bare from `os`, so
      // both spellings have to be in the set or a LAN Endpoint on this same
      // machine reads as belonging to another one.
      if (entry.family === "IPv6") addresses.add(`[${entry.address.toLowerCase()}]`);
    }
  }

  return addresses;
}

/**
 * What to say about the placement, in the reader's words.
 *
 * Returns null when the Models run here, which is the case with nothing to say
 * — the reader is not interested in a confirmation that their own machine is
 * their own machine, and a line saying so would be noise in the common case.
 */
export function explainPlacement(placement: Placement): string | null {
  if (placement.at === "here") return null;

  const where = placement.hosts.join(", ");

  return `Your Model server is at ${where}, which is not this machine. These specs describe the machine this app runs on, so fits are not shown.`;
}