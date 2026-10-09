import { z } from "zod";

import { readRouteError, readRouteJSON } from "@/lib/http/route-answer";

/**
 * Declaring an Endpoint from the interface.
 *
 * Carries one Credential one way: from the field the reader typed it into, to
 * the app's own server, which writes it to this machine's environment file. It
 * comes back as three facts about that write and never as a value — there is no
 * code path here that could hold one, so a response echoing a key would be a
 * parse failure rather than a leak.
 */

const declareResponseSchema = z.object({
  endpoint: z.object({
    id: z.string(),
    name: z.string(),
    baseURL: z.string(),
    defaultModelId: z.string(),
    knownModels: z.array(z.string()),
    credentialEnvVar: z.string().optional(),
  }),
  credential: z.discriminatedUnion("written", [
    z.object({ written: z.literal(true), envVar: z.string(), applied: z.boolean(), shadowedByShell: z.boolean() }),
    z.object({ written: z.literal(false), envVar: z.string().nullable(), reason: z.string() }),
  ]),
});

const forgetResponseSchema = z.object({ forgotten: z.string() });

/**
 * What declaring leaves the interface with.
 *
 * `declared` is the one that matters and it is not the only one: the Credential
 * can be written and not in use, which is the same pair of outcomes Key Entry
 * reports and for the same reason — a shell export shadows the file, and saying
 * "saved" for that would send the reader off to send a message and fail. They
 * are kept distinct here rather than collapsed, so the dialog can say what to do
 * about each.
 */
export type DeclareAnswer =
  | { status: "declared"; endpointName: string; defaultModelId: string; credential: CredentialAnswer }
  | { status: "refused"; message: string }
  | { status: "forgotten"; id: string };

/** What became of the Credential, which is never the Credential. */
export type CredentialAnswer =
  | { kind: "noneNeeded" }
  | { kind: "stored"; envVar: string }
  | { kind: "notApplied"; envVar: string }
  | { kind: "shadowed"; envVar: string }
  | { kind: "unusable" }
  | { kind: "notWritten"; envVar: string };

function readCredential(
  credential: z.infer<typeof declareResponseSchema>["credential"],
): CredentialAnswer {
  if (credential.written) {
    return credential.shadowedByShell
      ? { kind: "shadowed", envVar: credential.envVar }
      : credential.applied
        ? { kind: "stored", envVar: credential.envVar }
        : { kind: "notApplied", envVar: credential.envVar };
  }

  if (credential.envVar === null) return { kind: "noneNeeded" };
  return credential.reason === "unusable" ? { kind: "unusable" } : { kind: "notWritten", envVar: credential.envVar };
}

/** Whether the reader can declare an Endpoint at all, which is development only. */
export function declaringIsAvailable(): boolean {
  return process.env.NODE_ENV === "development";
}

function readAnswer({ status, body }: { status: number; body: unknown }): DeclareAnswer {
  if (status === 0) {
    return { status: "refused", message: "Could not reach the app's Endpoint declaration route." };
  }

  if (status === 404) {
    // The route's own wording: it explains that this is a development-only
    // capability, which is the one thing the reader cannot work out unaided.
    const message = readRouteError(body);
    return {
      status: "refused",
      message: message ?? "The app will not declare an Endpoint in this build.",
    };
  }

  if (status !== 200) {
    const message = readRouteError(body);
    return { status: "refused", message: message ?? "The app refused that Endpoint. Nothing was written." };
  }

  const parsed = declareResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { status: "refused", message: "The app's Endpoint declaration route answered in an unexpected form." };
  }

  return {
    status: "declared",
    endpointName: parsed.data.endpoint.name,
    defaultModelId: parsed.data.endpoint.defaultModelId,
    credential: readCredential(parsed.data.credential),
  };
}

/** Hands one Endpoint, and optionally its Credential, to the app's server. */
export async function declareEndpointFromInterface(input: {
  name: string;
  baseURL: string;
  models: readonly string[];
  credential?: string;
}): Promise<DeclareAnswer> {
  let response: Response;

  try {
    response = await fetch("/api/endpoints/declared", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "declare", ...input }),
    });
  } catch {
    return readAnswer({ status: 0, body: null });
  }

  return readAnswer({ status: response.status, body: await readRouteJSON(response) });
}

/** Takes a declared Endpoint, and the Credential stored for it, back off disk. */
export async function forgetEndpointFromInterface(id: string): Promise<DeclareAnswer> {
  let response: Response;

  try {
    response = await fetch("/api/endpoints/declared", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "forget", id }),
    });
  } catch {
    return readAnswer({ status: 0, body: null });
  }

  if (response.status === 200 && forgetResponseSchema.safeParse(await readRouteJSON(response)).success) {
    return { status: "forgotten", id };
  }

  return readAnswer({ status: response.status, body: null });
}
