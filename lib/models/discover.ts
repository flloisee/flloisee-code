import { parseModelIdentifiers } from "./parse";

/**
 * Model Discovery — asking an Endpoint which Models it currently offers.
 *
 * The SDK exposes no listing operation, so this is a plain fetch of the
 * Endpoint's conventional models path. Nothing in the model layer is stubbed
 * out: the request is the one a running Ollama would answer.
 *
 * Every outcome is distinguished rather than collapsed, because each one asks
 * a different thing of the reader. "Nothing loaded" means start a download,
 * "cannot be asked" means the Endpoint may not support discovery at all, and
 * "unreachable" means start the server.
 */

export type DiscoveryResult =
  | { status: "found"; models: string[] }
  /** The Endpoint answered and offers no Model. */
  | { status: "empty" }
  /** The Endpoint answered its models path with something unusable. */
  | { status: "unavailable" }
  /** The Endpoint could not be reached at all — usually not running. */
  | { status: "unreachable" };

export type DiscoveryRequest = {
  baseURL: string;
  /** Absent for a Local Endpoint, which needs no Credential. */
  credential?: string;
};

/** Discovery is on demand and against a local or third-party server, so it is not held open. */
const TIMEOUT_MS = 5_000;

export async function discoverModels({
  baseURL,
  credential,
}: DiscoveryRequest): Promise<DiscoveryResult> {
  let response: Response;

  try {
    response = await fetch(modelsURL(baseURL), {
      headers: {
        accept: "application/json",
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // The answer depends on what the Endpoint has loaded right now, so it is
      // never served from a cache.
      cache: "no-store",
    });
  } catch {
    // A refused connection, an unresolvable name, or a timeout all mean the same
    // thing to the reader: nothing is listening there.
    return { status: "unreachable" };
  }

  if (!response.ok) return { status: "unavailable" };

  let listing: unknown;
  try {
    listing = await response.json();
  } catch {
    // An Endpoint that answers its models path with HTML or plain text is not
    // offering to be discovered, which is a distinct state from offering nothing.
    return { status: "unavailable" };
  }

  const models = parseModelIdentifiers(listing);

  return models.length > 0 ? { status: "found", models } : { status: "empty" };
}

/** The conventional models listing, addressed relative to the Endpoint's base URL. */
function modelsURL(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/models`;
}