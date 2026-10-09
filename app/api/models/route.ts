import { z } from "zod";

import { findEndpoint } from "@/lib/endpoints/registry";
import { discoverModels } from "@/lib/models/discover";
import { resolveEndpoint } from "@/lib/endpoints/resolve";

/**
 * Model Discovery — a seam of its own, deliberately not part of the chat route.
 *
 * Discovery fails in different ways than generation does: a bad address, an
 * absent Credential, an Endpoint that does not support being asked. Routing it
 * through the chat endpoint would make every one of those look like a failure
 * to generate a Response.
 *
 * POST rather than GET, and the reason is not incidental: with Cache Components
 * enabled a GET Route Handler follows the prerender model of a page, so one
 * Endpoint's Models would be frozen at build time and served for every
 * Endpoint — a silent wrong answer rather than a visible failure. POST is not
 * prerendered at all.
 */

/** Discovery is a short local or third-party probe; it does not need a long ceiling. */
export const maxDuration = 30;

const discoveryRequestSchema = z.object({
  endpointId: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = discoveryRequestSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json(
      { error: "The request must name an Endpoint to ask." },
      { status: 400 },
    );
  }

  const { endpointId } = parsed.data;

  const endpoint = findEndpoint(endpointId);
  if (!endpoint) {
    return Response.json(
      { error: `Unknown Endpoint: ${endpointId}.` },
      { status: 400 },
    );
  }

  const resolution = resolveEndpoint(endpoint, process.env);
  if (!resolution.ok) {
    // Named distinctly from a chat failure: nothing was generated here, and
    // the fix is a Credential rather than a different Model.
    return Response.json(
      {
        error: `${endpoint.name} has no Credential, so it cannot be asked which Models it has. Set ${resolution.missingEnvVar} and try again.`,
      },
      { status: 400 },
    );
  }

  // Proxied like every other Request: a Cloud Endpoint is probed server-side
  // with the stored Credential, so probing never needs the key in the browser.
  const result = await discoverModels({
    baseURL: resolution.baseURL,
    ...(resolution.apiKey ? { apiKey: resolution.apiKey } : {}),
  });

  return Response.json({ endpointId, result });
}