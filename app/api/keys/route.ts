import { z } from "zod";

import { isDeclaredCredentialVar } from "@/lib/endpoints/registry";
import { canBeStoredVerbatim, saveAndReloadEnvValue } from "@/lib/env";

/**
 * Key Entry — the act of supplying a Cloud Endpoint's Credential.
 *
 * This is the app's only file writer, and the only place a Credential enters.
 * The route is bounded rather than trusted: each constraint closes a specific
 * way it could become an arbitrary-write endpoint, or a way a stored Credential
 * could be read back out.
 *
 * POST and nothing else: under Cache Components a GET Route Handler follows
 * the prerender model of a page, and a prerendered response here would answer
 * before the developer entered anything.
 */

/**
 * The request: a declared variable name, and the Credential to put in it.
 *
 * `.strict()` is the load-bearing part, not tidiness. A caller-supplied variable
 * name combined with a caller-supplied address would make this an
 * arbitrary-write endpoint pointed anywhere — the Credential for a known
 * provider, written wherever the caller chose to collect it. So the only fields
 * that exist are these two, and a request carrying anything else — an extra key
 * the caller expected to be honoured — is refused rather than quietly ignored.
 * Silently ignoring it would look, to the caller, like it had been.
 */
const keyEntrySchema = z
  .object({
    envVar: z.string().min(1),
    credential: z.string().min(1),
  })
  .strict();

const MALFORMED_REQUEST =
  "Key Entry takes the name of a declared variable and the Credential to store in it, " +
  'as { "envVar": ..., "credential": ... }.';

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      {
        error:
          "Key Entry runs only in development. A Credential is written to this machine's " +
          "environment file, and that capability is not part of a deployed build.",
      },
      { status: 404 },
    );
  }

  const parsed = keyEntrySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    const carriedAnUnexpectedField = parsed.error.issues.some(
      (issue) => issue.code === "unrecognized_keys",
    );

    return Response.json(
      {
        error: carriedAnUnexpectedField
          ? "Key Entry does not take a base URL or any other field alongside the " +
            "Credential. The Catalog supplies the address an Endpoint is reached at, so " +
            "that a caller who reached this route could not redirect where a Credential " +
            "is sent."
          : MALFORMED_REQUEST,
      },
      { status: 400 },
    );
  }

  const { envVar, credential } = parsed.data;

  // A Credential is opaque text, stored verbatim on one line. A few characters
  // would not survive that, and one that quietly changes on the way through the
  // file is worse than one that was never saved.
  if (!canBeStoredVerbatim(credential)) {
    return Response.json(
      {
        error:
          "A Credential is stored as one line of the environment file, and this one has a " +
          "character that would not survive it: a line break, a quote, or a dollar sign " +
          "(which is read as a reference to another variable). Nothing was written.",
      },
      { status: 400 },
    );
  }

  if (!isDeclaredCredentialVar(envVar)) {
    return Response.json(
      {
        error:
          "Key Entry stores a Credential only under a variable name the Catalog declares. " +
          `\`${envVar}\` is not one of them, and nothing was written.`,
      },
      { status: 400 },
    );
  }

  const outcome = await saveAndReloadEnvValue({
    name: envVar,
    value: credential,
    dir: process.cwd(),
  });

  return Response.json(outcome);
}