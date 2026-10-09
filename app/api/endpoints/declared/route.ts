import { z } from "zod";

import { credentialVarFor, declareEndpoint, forgetEndpoint } from "@/lib/endpoints/custom";
import { RESERVED_ENDPOINT_IDS } from "@/lib/endpoints/registry";

/**
 * Declaring an Endpoint of one's own, and forgetting it again.
 *
 * **This route is where the app's old guardrail moved, not where it went.** Until
 * now the base URL of every Endpoint was fixed in source, which is why
 * `POST /api/keys` could refuse any body carrying an address: a caller naming its
 * own destination next to a known provider's Credential would be a way to collect
 * that key elsewhere. That is still refused, still there, and `/api/keys` is
 * unchanged.
 *
 * What this route adds is an address the reader chose, stored on the server in
 * `.endpoints.json` and read back on the next Request. The Credential that goes
 * with it is one the reader typed on this machine, written to this machine's
 * environment file, and sent to the address they named. There is no existing
 * secret to redirect.
 *
 * The bounds that remain, each closing a specific way this could become worse
 * than the feature:
 *
 * - **Development only**, answering 404 otherwise, as `/api/keys` does. The
 *   ability to make the server write a file and reach an arbitrary address is not
 *   part of a deployed build.
 * - **A strict schema.** Four fields, nothing else, so a request carrying a key
 *   the caller expected to be honoured is refused rather than ignored — silence
 *   would look, to the caller, like it had been.
 * - **A checked base URL** (`normaliseBaseURL`): http or https only, no embedded
 *   credentials, no empty host.
 * - **The Credential is written here and only here.** It never passes through
 *   `/api/keys`, never goes in this file, and never comes back out in a response.
 *
 * POST rather than GET, for the reason every route here is POST: with Cache
 * Components enabled a GET Route Handler follows the prerender model of a page.
 */

/**
 * What one declaration is.
 *
 * `models` is a list rather than one Model because an Endpoint serves several,
 * and the reader is the only one who knows which — an Endpoint that cannot be
 * asked by Model Discovery has no other way to say. The first is the default.
 *
 * `credential` is optional and absent means none is needed, which is the ordinary
 * case for a server on the reader's own machine. An empty string is treated the
 * same way rather than as a failed Credential, because a password field left
 * blank is a blank field and not a zero-length secret.
 */
const declareSchema = z
  .object({
    name: z.string().min(1),
    baseURL: z.string().min(1),
    models: z.array(z.string()).min(1),
    credential: z.string().optional(),
  })
  .strict();

const forgetSchema = z
  .object({
    action: z.literal("forget"),
    id: z.string().min(1),
  })
  .strict();

const requestSchema = z.discriminatedUnion("action", [
  declareSchema.extend({ action: z.literal("declare") }),
  forgetSchema,
]);

const MALFORMED_REQUEST =
  'Declaring an Endpoint takes { "action": "declare", "name", "baseURL", "models", "credential"? }, ' +
  'and forgetting one takes { "action": "forget", "id" }.';

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      {
        error:
          "Declaring an Endpoint runs only in development. It writes to this machine's files " +
          "and decides where requests are sent, and that capability is not part of a deployed build.",
      },
      { status: 404 },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    const carriedAnUnexpectedField = parsed.error.issues.some(
      (issue) => issue.code === "unrecognized_keys",
    );

    return Response.json(
      {
        error: carriedAnUnexpectedField
          ? "This route takes only the fields it lists. A Credential is written to this " +
            "machine's environment file and never stored here, so there is no field for it " +
            "beyond the one you typed it into."
          : MALFORMED_REQUEST,
      },
      { status: 400 },
    );
  }

  const dir = process.cwd();

  if (parsed.data.action === "forget") {
    await forgetEndpoint({ dir, id: parsed.data.id, reserved: RESERVED_ENDPOINT_IDS });
    return Response.json({ forgotten: parsed.data.id });
  }

  const { name, baseURL, models, credential } = parsed.data;

  const outcome = await declareEndpoint({
    dir,
    name,
    baseURL,
    models,
    ...(credential !== undefined ? { credential } : {}),
    reserved: RESERVED_ENDPOINT_IDS,
  });

  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 400 });
  }

  const { endpoint, credential: stored } = outcome;

  /**
   * The Credential is reported as three facts and never as a value.
   *
   * `notNeeded` is the common case and is a success, not an absence: a server on
   * the reader's own machine needs no key, and an answer that looked like a
   * failure would make the ordinary path read as the broken one.
   */
  return Response.json({
    endpoint: {
      id: endpoint.id,
      name: endpoint.name,
      baseURL: endpoint.baseURL,
      defaultModelId: endpoint.defaultModelId,
      knownModels: endpoint.knownModels,
      ...(endpoint.credentialEnvVar !== undefined
        ? { credentialEnvVar: credentialVarFor(endpoint.id) }
        : {}),
    },
    credential: stored,
  });
}
