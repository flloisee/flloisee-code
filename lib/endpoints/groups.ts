/**
 * The three groups Endpoints are offered in, and what they are called.
 *
 * A leaf module on purpose. These are the group names the interface prints, and
 * the interface must be able to read them without dragging the Catalog with
 * them: `registry.ts` reaches the 187-entry Catalog, and a browser that had to
 * download all of it to learn three heading strings would be paying for a
 * provider list it never renders — the Registry route sends it the one Endpoint
 * it should show.
 *
 * Deciding *which* Endpoints fall in each group is the Registry's business, and
 * it sends the answer. Only the headings live here.
 */

/** Which of the three groups an Endpoint is offered under. */
export type EndpointGroup = "local" | "recommended" | "others";

/**
 * The headings, in the order they are offered.
 *
 * Local first because it is the only group usable with nothing set up, and
 * recommended before the rest because the point of grouping is that a reader
 * looking for Groq does not scroll past a hundred providers to reach it.
 */
export const ENDPOINT_GROUPS: readonly { kind: EndpointGroup; label: string }[] = [
  { kind: "local", label: "Local" },
  { kind: "recommended", label: "Cloud (Recommended)" },
  { kind: "others", label: "Cloud (Others)" },
];