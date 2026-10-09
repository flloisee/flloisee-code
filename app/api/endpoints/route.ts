import { describeEndpoints } from "@/lib/endpoints/status";

/**
 * The Registry, as the interface needs to see it.
 *
 * POST rather than GET for the same reason Model Discovery is a POST: with Cache
 * Components enabled a GET Route Handler follows the prerender model of a page,
 * so the answer would be frozen at build time — every Endpoints' Configured state
 * decided before the reader set anything.
 */

/**
 * The Registry, with each Endpoint's Configured state.
 *
 * Declared with no parameter on purpose. Only the environment says whether a
 * Credential is present, and nothing sent by the browser can influence which
 * address an Endpoint uses — the Catalog decides that, and a request able to
 * name its own destination could redirect a Credential.
 */
export async function POST() {
  return Response.json({ endpoints: describeEndpoints(process.env) });
}