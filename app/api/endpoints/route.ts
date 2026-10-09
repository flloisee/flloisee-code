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
 * address a Catalog Endpoint uses — those addresses are in source and no route
 * writes to them. A declared Endpoint's address is read from `.endpoints.json`
 * here, by the server, rather than taken from the request; see
 * `lib/endpoints/custom.ts`.
 */
export async function POST() {
  const { statuses, declaredTrouble } = await describeEndpoints(process.env, process.cwd());

  return Response.json({ endpoints: statuses, declaredTrouble });
}