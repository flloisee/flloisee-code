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
      // Required rather than defaulted. An answer missing the grouping would
      // otherwise parse and land every Endpoint in "Cloud (Others)", and a
      // reader would see one undifferentiated list and conclude the Registry has
      // no recommendations — which is the opposite of what an older build said.
      group: z.enum(["declared", "local", "recommended", "others"]),
      // Required rather than defaulted: the interface has to name the chosen
      // Endpoint's starting Model and cannot work it out itself. An answer
      // without it would leave the Model field empty for every Endpoint.
      defaultModelId: z.string(),
    }),
  ),
  // Required rather than defaulted, and nullable rather than absent, for the
  // reason the array's own field is: an answer from a build that never heard of
  // `.endpoints.json` must not be read as "the file is fine".
  declaredTrouble: z.string().nullable(),
});

/** What the Registry route left the interface with. */
export type EndpointAnswer = {
  statuses: readonly EndpointStatus[];
  /** Why the list could not be read, in words the reader can act on. */
  trouble: string | null;
  /**
   * Set when the reader's own Endpoints could not be read.
   *
   * Separate from `trouble` because it is not the same failure: the built-in
   * Endpoints are all listed and usable, and only the ones the reader added are
   * missing. Reporting it as a failed list would suggest the whole Registry is
   * gone and send them looking for a problem that is not there.
   */
  declaredTrouble: string | null;
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
      declaredTrouble: null,
    };
  }

  return {
    statuses: parsed.data.endpoints.map((entry) => ({
      id: entry.id,
      name: entry.name,
      // A Local Endpoint has no variable; it is not set to an empty one.
      credentialEnvVar: entry.credentialEnvVar,
      configured: entry.configured,
      group: entry.group,
      defaultModelId: entry.defaultModelId,
    })),
    trouble: null,
    declaredTrouble: parsed.data.declaredTrouble,
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