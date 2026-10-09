/**
 * Reading quantised weights out of a repository's file listing.
 *
 * This module is where a wrong answer becomes a confidently wrong number, and
 * three separate traps live here. All three were found by running against the
 * real Hub rather than by reading its documentation, and each produced a
 * plausible-looking figure rather than an obvious failure.
 *
 * **A `.gguf` file in the folder is not necessarily the Model.** Repositories
 * for multimodal and multi-token-prediction architectures carry auxiliary
 * weights beside the language model: a projector (`mmproj`), a prediction head
 * (`MTP`), audio and vision towers, tokenizers. They are small — a projector for
 * a 27B model is around 600 MB against the model's own 6 GB — so a rule that
 * takes "the smallest model-looking file" picks one of those and reports a 27B
 * model as running at 153 tokens a second, because it measured half a gigabyte
 * of vision weights. They are excluded below, by name, before anything else
 * looks at the file.
 *
 * **A Model is often several files.** A 9B model is commonly published as
 * `00001-of-00004.gguf` through `00004-of-00004.gguf`. Reading one file reports
 * a quarter of the Model and marks it as comfortably fitting when it is not, so
 * shards are summed by quantisation.
 *
 * **Low-bit quantisations are fast because they are nearly meaningless.** A 2-bit
 * quant of a large Model decodes quickly — the arithmetic is on fewer bits —
 * and produces close to noise. Ranking candidates by tokens per second therefore
 * selects the worst files on the Hub unless a floor is imposed, and the floor
 * below is the reason `QUANT_FLOOR_BITS` exists.
 */

/** A quantisation and the bytes it occupies across every file it spans. */
export type QuantSize = {
  /** As the repository spells it, e.g. "Q4_K_M". */
  quant: string;
  /** Bytes on disk, summed across shards. */
  bytes: number;
  /** How many files it was spread across, so a one-file Model reads differently. */
  files: number;
};

/**
 * Filenames that are never the language model.
 *
 * Matched against the whole path, case-insensitively, and deliberately as
 * substrings rather than whole words: repositories spell these a dozen ways
 * (`mmproj`, `mm-proj`, `-MTP`, `_mmproj`), and a rule that only catches some
 * spellings is a rule that silently mis-sizes a model whenever the author chose
 * an unusual one.
 *
 * `-cv-` and `_cv_` catch Gemma's vision towers. `draft` and `eagle` catch
 * speculative-decoding models, which are auxiliary to the Model that runs.
 */
const NOT_THE_MODEL =
  /mmproj|mm-proj|projector|projector|-mtp|mtp-|_mtp|vision|audio|embed|tokenizer|adapter|guidance|draft|eagle|speculat|\bmm\b/i;

/**
 * Quantisations and roughly how many bits each spends per weight.
 *
 * Bits per weight rather than bytes per file is the useful ordering: it says how
 * much of a Model survives the quantisation, which is the question being asked
 * when picking one to recommend. The numbers are the ones llama.cpp's own
 * quantisation docs give, and they are the basis for both "which is the best
 * one that still fits" and the floor below.
 */
const QUANT_BITS: Readonly<Record<string, number>> = {
  // Ternary, 2-bit and 3-bit. Listed so they are *recognised* rather than
  // misread as a neighbouring quantisation — a Q3_K_M file that went
  // unrecognised would be skipped, which loses a candidate, whereas one read as
  // something else would be sized wrongly. Never recommended; see the floor.
  TQ1_0: 1.69, TQ2_0: 2.06,
  IQ1_S: 1.56, IQ1_M: 1.75,
  IQ2_XXS: 2.06, IQ2_XS: 2.31, IQ2_S: 2.5, IQ2_M: 2.7,
  IQ3_XXS: 3.02, IQ3_S: 3.3, IQ3_M: 3.66,
  Q3_K_S: 3.5, Q3_K_M: 3.91, Q3_K_L: 4.27,
  // The useful range. This is where a Model is still a Model.
  IQ4_XS: 4.25, IQ4_NL: 4.5,
  Q4_0: 4.5, Q4_1: 4.5, Q4_K_S: 4.58, Q4_K_M: 4.85, Q4_K_L: 5.0,
  Q5_0: 5.5, Q5_K_S: 5.5, Q5_K_M: 5.67, Q5_K_L: 5.77,
  Q6_K: 6.59, Q6_0: 6.56,
  Q8_0: 8.5, Q8_1: 8.5,
  // Full precision, for the many repositories that publish nothing else.
  F16: 16, F32: 32, BF16: 16,
};

/**
 * The quality below which a Model is not recommended, whatever its speed.
 *
 * Four bits. Below that the weights have lost enough that output degrades badly
 * — 3-bit and 2-bit quantisations are measurably faster *because* they carry
 * less of the Model, so a list ranked purely on tokens per second is a list of
 * the least usable files on the Hub. This floor is what stops the feature
 * recommending one.
 */
export const QUANT_FLOOR_BITS = 4;

/**
 * The quality this app aims to recommend, and above which more bits are not
 * worth the download.
 *
 * Q4_K_M at 4.85 bits is the community default: the point where output quality
 * has largely stopped improving, and the smallest file that is genuinely a
 * Model rather than a fast approximation of one. Recommending above it costs the
 * reader half again the download — or a full-precision triple — for a difference
 * nobody would notice in a Conversation.
 */
const QUALITY_BAR = "Q4_K_M";

/**
 * The bits a quantisation spends per weight, or null when the name is not one
 * this app knows.
 *
 * Recognising every quantisation matters more than ranking them: a file whose
 * quantisation is unrecognised is skipped, which is a missing candidate, whereas
 * one misread as a neighbouring quantisation is a wrong size presented as fact.
 */
export function bitsFor(quant: string): number | null {
  return QUANT_BITS[quant.toUpperCase()] ?? null;
}

/**
 * The quantisation a filename names, or null.
 *
 * Longest name first, because the names overlap: `Q4_K_M` contains `Q4_K`, and
 * `IQ4_XS` contains `Q4`. Matching the short one first would read a K_M as the
 * plain K and report a file a few percent smaller than it is.
 */
const QUANT_NAMES = Object.keys(QUANT_BITS).sort((a, b) => b.length - a.length);

export function quantIn(name: string): string | null {
  const upper = name.toUpperCase();

  for (const quant of QUANT_NAMES) {
    // A boundary either side, so `Q4_K_M` is not found inside `XQ4_K_MY`, and
    // separators like `-` `_` `.` all count as boundaries.
    const at = upper.indexOf(quant);
    if (at < 0) continue;

    const before = upper[at - 1];
    const after = upper[at + quant.length];
    const cleanBefore = at === 0 || /[-_. ]/.test(before ?? "");
    const cleanAfter = after === undefined || /[-_. ]/.test(after ?? "");

    if (cleanBefore && cleanAfter) return quant;
  }

  return null;
}

/**
 * The shard a filename is part of, or null when it is a whole Model.
 *
 * `model-00001-of-00004.gguf` is shard 1 of 4, and so is
 * `model-00001-of-00004-Q4_K_M.gguf` — repositories put the quantisation either
 * side of the shard marker, and an anchor at the end of the name only catches
 * the first form. Missing the second means every sharded Model is reported as
 * four separate Models of a quarter its real size.
 */
function shardOf(name: string): { part: number; total: number } | null {
  const match = /-0*(\d+)-of-0*(\d+)/i.exec(name);
  if (match === null) return null;
  return { part: Number(match[1]), total: Number(match[2]) };
}

/**
 * Every quantisation in a repository's file listing, with its true size.
 *
 * `tree` is a Hugging Face file listing as JSON: `[{ path, size }]`. Anything
 * that is not a Model file, or that carries no size, is skipped.
 *
 * Shards are summed, and a shard set that is visibly incomplete is discarded
 * rather than half-counted. A repository listing three of four shards has its
 * size understated by a quarter, and understating a size is the one direction
 * that marks a Model as fitting when it does not.
 */
export function readQuantSizes(tree: unknown): QuantSize[] {
  if (!Array.isArray(tree)) return [];

  /** quantisation -> { bytes, shards seen, shard totals expected } */
  const found = new Map<string, { bytes: number; parts: Set<number>; total: number | null }>();

  for (const entry of tree) {
    if (typeof entry !== "object" || entry === null) continue;

    const record = entry as Record<string, unknown>;
    const path = record.path;
    if (typeof path !== "string" || !path.toUpperCase().endsWith(".GGUF")) continue;

    const size = record.size;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) continue;

    if (NOT_THE_MODEL.test(path)) continue;

    const name = path.split("/").pop() ?? path;
    const quant = quantIn(name);
    if (quant === null) continue;

    const shard = shardOf(name);
    const slot = found.get(quant) ?? { bytes: 0, parts: new Set<number>(), total: null };

    slot.bytes += size;
    if (shard !== null) {
      slot.parts.add(shard.part);
      slot.total = shard.total;
    } else {
      slot.parts.add(1);
    }

    found.set(quant, slot);
  }

  const sizes: QuantSize[] = [];

  for (const [quant, slot] of found) {
    // Incomplete shards are dropped. Guessing the missing ones would understate
    // the size, and understating is how a Model that does not fit gets
    // recommended as though it did.
    if (slot.total !== null && slot.parts.size !== slot.total) continue;

    sizes.push({ quant, bytes: slot.bytes, files: slot.parts.size });
  }

  return sizes.sort((a, b) => a.bytes - b.bytes);
}

/**
 * The quantisation to recommend for a Model, given the bytes it may occupy.
 *
 * **The smallest one at or above Q4_K_M**, not the best one that fits. Those
 * are the same thing only when the budget is tight, and where they differ the
 * difference is large: with room to spare, "the best that fits" reaches for Q8_0
 * or BF16, which is the biggest download available for a gain in output quality
 * that is barely measurable. A live run on a 16 GB M4 offered a 2B model at
 * **BF16, 3.90 GB**, where Q4_K_M is under 1.3 GB — a triple-size download for
 * nothing a reader would notice. Recommending the small side of the quality bar
 * is what makes the number in the list worth acting on.
 *
 * When nothing at or above the bar fits — a Model too large for this machine at
 * any decent quality — the largest that does fit is taken instead, so a tight
 * budget still gets the best available rather than nothing. Either way nothing
 * below `QUANT_FLOOR_BITS` is offered: a 2-bit file decodes quickly because it
 * carries almost none of the Model, and returning it would be returning
 * something that answers in noise.
 *
 * `budgetBytes` is the most the Model is allowed to occupy, already computed
 * from the memory available and the speed the reader asked for. Returns null
 * when not even the floor quantisation fits, which is the honest answer: no
 * version of this Model runs at that speed on this machine.
 */
export function chooseQuant(
  sizes: readonly QuantSize[],
  budgetBytes: number,
): QuantSize | null {
  const usable = sizes.filter((size) => (bitsFor(size.quant) ?? 0) >= QUANT_FLOOR_BITS);

  if (usable.length === 0) return null;

  const bar = QUANT_BITS[QUALITY_BAR];

  // At or above the bar, the smallest — the standard default, and the point of
  // the whole rule. Budget-checked like every other branch: a quantisation that
  // does not fit is not a recommendation at any quality.
  const atBar = usable
    .filter((size) => (bitsFor(size.quant) ?? 0) >= bar && size.bytes <= budgetBytes)
    .sort((a, b) => a.bytes - b.bytes);

  if (atBar.length > 0) return atBar[0];

  // Below the bar, the largest that fits: the least compromise available when
  // the budget will not reach the standard.
  let best: QuantSize | null = null;
  for (const size of usable) {
    if (size.bytes > budgetBytes) continue;
    if (best === null || size.bytes > best.bytes) best = size;
  }

  return best;
}

/**
 * A first guess at a Model's size, for filtering candidates before spending a
 * request on measuring them exactly.
 *
 * Hugging Face's `gguf.total` is a **parameter count in bytes**, not the size of
 * any file: a Qwen3-8B reports 8.19 GB there while its Q4_K_M file is 5.03 GB.
 * It is exactly the right shape for a cheap prefilter — it over-states every
 * Model by roughly the quantisation ratio, so a Model that cannot possibly fit
 * is rejected without measuring, and one that survives is then measured for
 * real.
 *
 * False negatives are possible and accepted: a Model whose parameter count
 * suggests it is too large can still have a small enough 4-bit quantisation. The
 * prefilter uses the low end of the range so those survive to be measured.
 */
export function roughSizeBytes(parameterCountBytes: number): number {
  // `parameterCountBytes` is a count of parameters stored one byte each, so a
  // 4-bit quantisation of it is half as many bytes again. Dividing by eight
  // turns bits into bytes; the arithmetic is written out because getting it
  // wrong by a factor of eight would either reject every Model or admit them
  // all, and neither shows up as anything but a wrong list.
  return (parameterCountBytes * QUANT_FLOOR_BITS) / 8;
}