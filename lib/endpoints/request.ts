import { z } from "zod";

import type { EndpointStatus } from "./status";

/**
 * Asking the app's own server what the Registry holds.
 *
 * Which Endpoints are Configured is known only where the environment is, so the
 * question goes to the app's server rather than being answered in the browser.
 * Only variable names and booleans come back — a Credential value never leaves
 * the server.
 */

const registryResponseSchema = z.object({
  endpoints: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      credentialEnvVar: z.string().nullable(),
      configured: z.boolean(),
    }),
  ),
});

/** What the Registry route left the interface with. */
export type EndpointAnswer = {
  statuses: readonly EndpointStatus[];
  /** Why the list could not be read, in words the reader can act on. */
  trouble: string | null;
};

/**
 * Reads one answer from the Registry Route Handler.
 *
 * An answer in an unexpected shape is reported rather than rendered: half a list
 * of Endpoints would look like an app offering only the ones that happened to
 * parse.
 */
export function readEndpointStatuses({ status, body }: { status: number; body: unknown }): EndpointAnswer {
  const parsed = registryResponseSchema.safeParse(body);

  if (status !== 200 || !parsed.success) {
    return {
      statuses: [],
      trouble: "Could not read the Endpoint list from the app.",
    };
  }

  return {
    statuses: parsed.data.endpoints.map((entry) => ({
      id: entry.id,
      name: entry.name,
      // A Local Endpoint has no variable; it is not set to an empty one.
      credentialEnvVar: entry.credentialEnvVar,
      configured: entry.configured,
    })),
    trouble: null,
  };
}

/** Asks the app which Endpoints it offers and which are Configured. */
export async function requestEndpoints(): Promise<EndpointAnswer> {
  let response: Response;

  try {
    response = await fetch("/api/endpoints", { method: "POST" });
  } catch {
    return readEndpointStatuses({ status: 0, body: null });
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A proxy or an error page answering in place of the route is not an Endpoint.
  }

  return readEndpointStatuses({ status: response.status, body });
}