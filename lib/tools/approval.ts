import type { GenericToolApprovalFunction } from "ai";
import path from "node:path";

import type { ReadingRoot } from "@/lib/roots/reading-root";
import { mayRead } from "@/lib/roots/readable";
import { askedPath, type FileTools } from "@/lib/tools/file-tools";

/**
 * The context the SDK infers for a Tool set that declares none.
 *
 * `GenericToolApprovalFunction` takes three type parameters and this is the
 * second and third of them. No Tool here declares a `contextSchema`, so the
 * inference is the empty object in both positions — and it has to be written
 * explicitly, because leaving them off is not the same thing.
 *
 * Named rather than written inline so this rule is silenced once, next to the
 * reason, instead of on every use.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- what the SDK infers when no Tool declares a contextSchema.
type NoContext = {};

/**
 * Who decides about a read the Model asked for.
 *
 * Inside the Root there is nothing to decide and the SDK is told so by returning
 * nothing at all: no approval parts, no transcript rows, nothing for the reader
 * to click through on a Turn that is only answering a question about their own
 * code. Outside it, the read stops and the reader decides — which is the whole
 * of the feature's promise that a file they did not point at does not leave the
 * machine.
 *
 * **One function over the parsed input**, rather than one answer per Tool. The
 * question is "may this path be read", and a policy that switched on which Tool
 * reached for it would be answering "which Tool was used" instead: the same
 * path through `read_file` and through `search_files` would then get different
 * answers, and the one that drifted would be the one nobody remembered to
 * check. `askedPath` is what turns "the Model named no path at all" into the
 * Root, which is the same place it reaches by writing `.`.
 *
 * **Containment is `mayRead`'s answer, not a second one.** This decides what the
 * reader is asked; the Tools decide what is opened. Both ask `mayRead`, and
 * neither compares a path to a Root itself, so a rule that changed would change
 * in one place rather than in two that have to agree.
 *
 * **Only "outside" is a question for the reader.** Containment answers three
 * ways, and only one of them is about the boundary. A path the disk cannot
 * resolve is `unreadable` — a typo, or something deleted between two Turns — and
 * asking the reader to approve reading a file that does not exist would end the
 * Turn over a misspelling. Those paths run, and the Tool refuses them with a
 * sentence that tells the Model to call `list_files`, which is the answer the
 * Model can act on. Nothing is read either way: the path is not admitted, so
 * the Tool opens nothing.
 *
 * **Deterministic in the path, because the SDK asks again.** Approval is
 * re-evaluated on every replay of a history, so a policy that counted calls, or
 * remembered having asked, would put the same question to the reader a second
 * time for a decision they had already made. Nothing here is carried between
 * calls: the answer is a function of the Root, the Grants, and the path.
 */
export function readingApproval(
  reading: ReadingRoot,
): GenericToolApprovalFunction<FileTools, NoContext, NoContext> {
  return async ({ toolCall }) => {
    // Checked before anything else, and not for tidiness. `TypedToolCall` is a
    // union whose other member has an `input` of `unknown`, so narrowing on the
    // name alone leaves the input unreadable — and a Tool Call the SDK could not
    // resolve to one of ours has no path here to judge in the first place.
    if (toolCall.dynamic) return "not-applicable";

    const asked = askedPath(toolCall.input);
    const allowed = await mayRead(reading, asked);

    if (allowed.readable) {
      // A Grant is reported rather than passed over in silence. The read
      // happens, and the transcript says a decision was already made about this
      // path, so a file outside the Root does not arrive looking like one
      // inside it.
      if (allowed.under === "grant") return { type: "approved", reason: grantedSentence(reading, asked) };
      return undefined;
    }

    if (allowed.reason === "outside") {
      return { type: "user-approval", reason: outsideSentence(reading, asked) };
    }

    return undefined;
  };
}

/**
 * The path the reader is being shown, whole.
 *
 * `path.resolve` rather than the join `mayRead` makes internally, and only for
 * the sentence: this string is for a person to recognise, and `<root>/../../
 * .ssh/id_rsa` is a path nobody recognises. The decision has already been made
 * by the time this runs, so normalising here cannot widen anything — it never
 * touches what is read.
 */
function whole(reading: ReadingRoot, asked: string): string {
  return reading.root === null ? asked : path.resolve(reading.root, asked);
}

function outsideSentence(reading: ReadingRoot, asked: string): string {
  return `${whole(reading, asked)} is outside the folder you shared, so the Model is asking before reading it.`;
}

function grantedSentence(reading: ReadingRoot, asked: string): string {
  return `${whole(reading, asked)} is outside the folder you shared, and a Grant you have already given covers it.`;
}
