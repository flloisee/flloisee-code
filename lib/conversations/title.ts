/**
 * What a saved Conversation is called in the list.
 *
 * A Conversation is named after the message that opened it, so the reader
 * recognises it by what they asked rather than by when they asked it. The name
 * is derived once, when the Conversation gets its first Turn, and stored
 * alongside it: recomputing it on every render would silently undo a rename,
 * and a Conversation whose Turns were edited or pruned would change name under
 * the reader.
 *
 * Pure and immutable, so the naming rule is exercised without a browser or a
 * store — the same reason the Model choice is kept apart from the interface
 * that holds it.
 */

/** The longest a derived name is. Long enough to identify a question, short enough to scan. */
export const TITLE_MAX = 30;

/** Shown for a Conversation with no Turn yet, and so nothing to derive a name from. */
export const UNTITLED = "New Conversation";

/** How much of the cut name a word boundary has to leave to be worth taking. */
const BOUNDARY_FLOOR = 0.6;

/** Trailing marks that would dangle after a cut, e.g. "what is this?" -> "what is this…". */
const DANGLING = /[\s.,;:!?()[\]{}"'`—–-]+$/u;

/**
 * Drops a trailing high surrogate, if the cut left one.
 *
 * `slice` counts code units, and an emoji or an astral-plane CJK character is
 * two of them, so a cut landing between the halves of a pair strands the half
 * that opened it. That half is not a character at all — it renders as a
 * replacement box — so it is worth a code unit of the budget to not put one in
 * the list.
 *
 * Only the *high* half is the damage. A trailing low half is the ordinary
 * second unit of a pair that is already whole, and dropping it would delete a
 * character the reader typed — which is the same visual bug pointed the other
 * way, and the reason this checks one end of the range and not both.
 */
function withoutSplitSurrogate(cut: string): string {
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * The name for a Conversation opened by `text`.
 *
 * A message typed across several lines is one sentence to the reader, so
 * newlines and runs of spaces collapse to single spaces before anything is
 * counted — otherwise a name would be cut short by a line break the reader
 * never sees as a break.
 *
 * The cut prefers a word boundary, because a name ending mid-word ("how do I
 * confi…") reads as damage to a word rather than as a summary. It is not
 * taken unconditionally: one long unbroken string has no boundary to find, and
 * chasing the last space in it would leave almost nothing. So the boundary is
 * only taken when it still leaves `BOUNDARY_FLOOR` of the name, and otherwise
 * the cut falls where it falls.
 */
export function titleFrom(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return UNTITLED;
  if (collapsed.length <= TITLE_MAX) return collapsed;

  const slice = collapsed.slice(0, TITLE_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const atBoundary = lastSpace >= Math.floor(TITLE_MAX * BOUNDARY_FLOOR);

  const body = withoutSplitSurrogate(atBoundary ? slice.slice(0, lastSpace) : slice);

  return body.replace(DANGLING, "") + "…";
}
