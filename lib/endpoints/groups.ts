/**
 * The four groups Endpoints are offered in, and what they are called.
 *
 * A leaf module on purpose. These are the group names the interface prints, and
 * the interface must be able to read them without dragging the Catalog with
 * them: `registry.ts` reaches the 187-entry Catalog, and a browser that had to
 * download all of it to learn four heading strings would be paying for a
 * provider list it never renders — the Registry route sends it the one Endpoint
 * it should show.
 *
 * Deciding *which* Endpoints fall in each group is the Registry's business, and
 * it sends the answer. Only the headings live here.
 */

/** Which of the four groups an Endpoint is offered under. */
export type EndpointGroup = "declared" | "local" | "recommended" | "others";

/**
 * The headings, in the order they are offered.
 *
 * The reader's own Endpoints come first, because they are the ones they chose
 * deliberately and are the shortest list here — a reader who declared one server
 * should not scroll past a hundred providers to reach it.
 *
 * Local next because it is the only group usable with nothing set up, and
 * recommended before the rest because the point of grouping is that a reader
 * looking for Groq does not scroll past a hundred providers to reach it.
 *
 * **The recommended group is called "Cloud" and not "Cloud (Recommended)".** The
 * parenthesised tag said nothing the order had not already said — this group is
 * drawn first of the two, so "recommended" was a caption on the list rather than
 * information in it, and the picker now opens on a table with a search field
 * where the five sit at the top under a plain heading while a reader types. So
 * "Cloud (Others)" is the only heading that still carries a qualifier, and that is
 * how the two are told apart: one is the Cloud Endpoints this app puts first, the
 * other is everything else, and only the second needs saying.
 */
export const ENDPOINT_GROUPS: readonly { kind: EndpointGroup; label: string }[] = [
  { kind: "declared", label: "Added by you" },
  { kind: "local", label: "Local" },
  { kind: "recommended", label: "Cloud" },
  { kind: "others", label: "Cloud (Others)" },
];