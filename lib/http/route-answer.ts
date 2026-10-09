/**
 * Reading what one of this app's Route Handlers answered.
 *
 * Two questions, asked identically by both the Key Entry and Model Discovery
 * requests: what did the route say, and is this body JSON at all. They had a
 * copy each, and two copies of the same parsing drift into disagreeing — one
 * route accepting an error the other would discard — so they live here once.
 *
 * Both are written to be total: they answer rather than throw. A request to a
 * route that never ran, or that a proxy answered in its place, is a thing that
 * happens on a local machine serving this app, and throwing while reporting it
 * would turn a routing problem into an unhandled rejection.
 */

/**
 * The body as parsed JSON, or `null` when it is not JSON.
 *
 * A proxy or an error page answering instead of the route is not an outcome of
 * this app's own, and its bytes are not worth parsing for one.
 */
export async function readRouteJSON(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * The message a refused route wrote, or `undefined` when there is none.
 *
 * The route's wording is deliberate — it names what was refused and why — so it
 * is passed up rather than replaced. An empty message is treated as none: a
 * blank alert looks like the app had something to say and failed to say it.
 */
export function readRouteError(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const error = (body as Record<string, unknown>).error;
  return typeof error === "string" && error.length > 0 ? error : undefined;
}