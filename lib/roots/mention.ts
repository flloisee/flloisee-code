/**
 * Which words in a message carry a reader's own `@`.
 *
 * **One answer, asked two ways.** The composer's menu asks where the mention
 * being typed is; the mirror drawn over the field asks where every mention in the
 * whole message is. They have to be the same answer, because a word the menu
 * declines to open over and a word drawn as though it named a file are two claims
 * about the same characters in the same sentence, and a reader holding both at
 * once has no way to tell which of them to believe.
 *
 * **What a mention is has nothing to do with whether it is a file.** `@` is a mark
 * a reader puts on a word, and whether that word names something on this disk is
 * `named-path`'s question and the server's. This only says which words carry the
 * mark, so the composer can draw it — which is why nothing here consults the Root,
 * the disk, or the shape of a path beyond where the mark ends.
 *
 * The two rules are both about not interrupting a sentence. An `@` has to start a
 * word, or `me@example.com` opens a menu over an address. And a mention ends at
 * the first whitespace after it, which is what makes the words behind it a name
 * being typed rather than the rest of a message that happens to begin with a
 * character.
 */

/** A mention's place in the message, and what has been written since its `@`. */
export type Mention = { start: number; query: string };

/**
 * A mention as a range, for drawing rather than for typing.
 *
 * Both ends are offsets into the message, and the run covers the `@` itself: the
 * mark is part of what the reader wrote, and a name drawn without the character
 * that named it would be a path that looks picked and is not.
 */
export type MentionRun = { start: number; end: number };

/**
 * The `@` the caret is inside, if it is inside one.
 *
 * Asked at a caret rather than over the whole message, because the menu is a
 * question about where the reader is: an `@` further up the sentence is not what
 * they are typing into, and offering a list for it would answer a question they
 * did not ask.
 */
export function mentionAt(text: string, caret: number): Mention | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;

  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  if (/\s/.test(before.slice(at + 1))) return null;

  return { start: at, query: before.slice(at + 1) };
}

/**
 * Every mention in the message, in the order they appear.
 *
 * Asked of {@link mentionAt} rather than of a second pair of rules, because the
 * pair is the whole of what a mention is and two copies of it would be two answers
 * to keep in step. The caret asked for is the last character of the name the `@`
 * opens, which is the one the menu would open over for the same word: a mention
 * ends at the first whitespace, so that is the end of it whether or not the reader
 * has finished typing it.
 *
 * **The comparison against `mention.start` is what refuses the awkward cases.**
 * `@` inside a word — the `@` of `me@example.com` — is found by neither this pass
 * nor the menu, and two `@`s in one word fail it too, because the `@` that ends
 * the word is not the one the word began with.
 *
 * A bare `@` is left out. There is nothing behind it yet to be heavy about, and
 * the menu is already open over the word it is sitting in.
 *
 * **A run is the whole word, trailing punctuation and all.** A reader who has just
 * picked a name cannot get a full stop after it without deleting the space the
 * pick left, so trimming the stops off the end of a run would be tidying a case
 * that does not come up, at the price of a second copy of the punctuation list
 * `named-path` already keeps.
 */
export function mentionRuns(text: string): MentionRun[] {
  const runs: MentionRun[] = [];

  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const gap = text.slice(at + 1).search(/\s/);
    const end = gap === -1 ? text.length : at + 1 + gap;

    if (mentionAt(text, end)?.start !== at) continue;
    if (end === at + 1) continue;

    runs.push({ start: at, end });
  }

  return runs;
}