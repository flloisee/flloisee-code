import { z } from "zod";

/**
 * Asking the discovery Route Handler from the interface.
 *
 * This goes to the app's own server rather than to the Endpoint: every Request
 * is proxied, so no Credential is ever in a request the browser constructs.
 */

const discoveryResponseSchema = z.object({
  result: z.discriminatedUnion("status", [
    z.object({ status: z.literal("found"), models: z.array(z.string()) }),
    z.object({ status: z.literal("empty") }),
    z.object({ status: z.literal("unavailable") }),
    z.object({ status: z.literal("unreachable") }),
  ]),
});

/**
 * What discovery leaves the interface with.
 *
 * The Endpoint's own outcomes carry an optional explanation: the route that
 * proxied the Request knows things the bare status does not — which environment
 * variable to set, or that the answer was not a listing at all.
 */
export type DiscoveryAnswer =
  | { status: "found"; models: string[] }
  | { status: "empty"; message?: string }
  | { status: "unavailable"; message?: string }
  | { status: "unreachable"; message?: string }
  /** Discovery was never attempted, because the route refused the Endpoint. */
  | { status: "refused"; message: string };

/**
 * Reads one answer from the discovery Route Handler.
 *
 * Every outcome is kept rather than collapsed into "no models", because an
 * Endpoint with nothing loaded, one that cannot be asked, and one that is not
 * running each ask something different of the reader — and an empty control
 * with no explanation is the failure this avoids.
 *
 * `status` is the HTTP status, or 0 when the route itself could not be reached.
 */
export function readDiscoveryAnswer({
  status,
  body,
}: {
  status: number;
  body: unknown;
}): DiscoveryAnswer {
  if (status === 0) {
    return { status: "unreachable", message: "Could not reach the app's Model Discovery route." };
  }

  if (status !== 200) {
    const message = readError(body);
    // The route named the environment variable to set, or the unknown Endpoint.
    // Its wording is deliberate, so it is shown rather than replaced.
    return { status: "refused", message: message ?? "The app refused to ask that Endpoint." };
  }

  const parsed = discoveryResponseSchema.safeParse(body);

  if (!parsed.success) {
    return {
      status: "unavailable",
      message: "The app's Model Discovery route answered in an unexpected form.",
    };
  }

  return parsed.data.result;
}

/** Asks the app to discover the Models an Endpoint currently offers. */
export async function requestModels(endpointId: string): Promise<DiscoveryAnswer> {
  let response: Response;

  try {
    response = await fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpointId }),
    });
  } catch {
    return readDiscoveryAnswer({ status: 0, body: null });
  }

  return readDiscoveryAnswer({ status: response.status, body: await readBody(response) });
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // A proxy or an error page answering in place of the route is not something
    // to render as an Endpoint's Model list.
    return null;
  }
}

function readError(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const error = (body as Record<string, unknown>).error;
  return typeof error === "string" && error.length > 0 ? error : undefined;
}