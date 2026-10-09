import { bandwidthFor } from "./bandwidth";
import { usableMemoryBytes, type HardwareSpec } from "./spec";

/**
 * Estimating how fast this machine would speak.
 *
 * This is a roofline argument, not a measurement. Decoding one token on a
 * loaded model reads essentially every weight exactly once and does almost no
 * arithmetic, so the wall it hits is how fast memory can be read — not the
 * compute inside it. That makes tokens-per-second roughly:
 *
 *     bandwidth ÷ model size on disk
 *
 * and it makes the estimate good to within about a factor of two for a model
 * that fits in memory, which is the regime anyone cares about.
 *
 * The reason this is worth building at all, given the roughness: the ratio has
 * a cliff in it. A model that fits in VRAM is read from fast memory. A model
 * that does not is read partly from disk, which is one to two orders of
 * magnitude slower, and a conversation stops feeling like a conversation. That
 * step is worth knowing about even when the number itself is rough, and it is
 * why a "fits or not" verdict is the primary output here and the token rate is
 * the secondary one.
 */

/**
 * How much of a model must fit in memory for a decode to run at memory speed.
 *
 * The rest can spill to disk and still work, slowly. The part that must fit is
 * the weights that are actually resident at once, which for a fully-offloaded
 * model is all of them; leaving a small tail on the CPU costs a little and is
 * normal in practice, so the threshold is set where a model is comfortably
 * inside memory rather than exactly at the edge.
 */
const OFFLOAD_HEADROOM = 0.9;

/**
 * What happens to the estimate once a model stops fitting, expressed as a
 * fraction of the memory-bound rate.
 *
 * Disk reads are not merely slower than VRAM, they are a different order of
 * magnitude — an NVMe drive manages single-digit GB/s against a card's
 * hundreds — so a spilled model decodes at a small fraction of what the same
 * card would do with the same model in memory. A tenth of the rate is used
 * because it is a generous middle for a machine whose SSD is fast, and because
 * the verdict being wrong here only ever understates speed: a model shown as
 * slow that is actually quick wastes a reader's time, but not one shown as
 * quick that is actually slow.
 */
const SPILLED_FRACTION = 0.1;

/** The threshold the Speed fit is written against: a Response the reader waits on. */
export const COMFORTABLE_TOKENS_PER_SECOND = 50;

/**
 * Models that turn text into numbers rather than answering.
 *
 * An embedding model is on the Hub, is sized the same way, and would otherwise
 * be rated — which is worse than useless, because an embedding model genuinely
 * *is* fast. One of these on an M4 comes out above 700 tokens a second, which
 * clears the 50 bar with room to spare and reads as "the best thing on your
 * machine" for a Model that cannot hold a Conversation at all.
 *
 * So they are excluded before any arithmetic happens. The cost is that a Model
 * whose name merely contains one of these words is not rated either, which is
 * the safe direction to be wrong in: a missing badge against a Model that could
 * have talked, rather than a top speed on one that cannot.
 */
const NOT_CONVERSATIONAL = ["embedding", "embed", "nomic-embed", "bge-", "e5-", "gte-"];

/** Whether this Model answers, rather than turning text into numbers. */
export function isConversational(modelId: string): boolean {
  const lowered = modelId.toLowerCase();
  return !NOT_CONVERSATIONAL.some((marker) => lowered.includes(marker));
}

/**
 * What the app can say about running a model of this size on this machine.
 *
 * Deliberately not a number. `kind` is the verdict the UI leads with, because
 * "too large for this machine" is the fact a reader can act on, and the token
 * rate is a decoration on it that they should be able to distrust.
 */
export type SpeedEstimate =
  /**
   * The machine has a bandwidth row, so a rate can be estimated. `fits` is
   * null rather than boolean only when memory could not be established either,
   * which is rare but real — a chip with a bandwidth row and an unreadable
   * memory figure.
   */
  | { kind: "resident"; tokensPerSecond: number; fits: boolean | null }
  /** The model does not fit in memory; it would be read partly from disk. */
  | { kind: "spilled"; tokensPerSecond: number; fits: false }
  /** No bandwidth row for this machine's chip, so nothing can be said. */
  | { kind: "unknown-bandwidth"; tokensPerSecond: null; fits: null }
  /** No model size to divide, so nothing can be said. */
  | { kind: "unknown-size"; tokensPerSecond: null; fits: null };

/**
 * Estimates how fast this machine would run a model of this size.
 *
 * Both arguments may be absent, and each absence has its own answer: a machine
 * with no chip row is not a slow machine, it is an unknown one, and a model
 * whose size nobody could look up is not a small model. Both return a `kind`
 * that says so rather than a number that guesses.
 */
export function estimateSpeed(
  spec: HardwareSpec,
  modelBytes: number | null,
): SpeedEstimate {
  const bandwidth = bandwidthFor(spec);
  if (bandwidth === null) {
    return { kind: "unknown-bandwidth", tokensPerSecond: null, fits: null };
  }

  if (modelBytes === null || modelBytes <= 0) {
    return { kind: "unknown-size", tokensPerSecond: null, fits: null };
  }

  // Bandwidth divided by bytes gives bytes-per-byte-per-second, which is
  // tokens per second only because each token reads the whole model once.
  const residentRate = bandwidth / modelBytes;

  const memory = usableMemoryBytes(spec);
  if (memory === null) {
    // Memory could not be established but bandwidth could. The rate is still
    // real; whether the model fits is not knowable, so the verdict is null
    // rather than a guess in either direction.
    return { kind: "resident", tokensPerSecond: residentRate, fits: null };
  }

  const fits = modelBytes <= memory * OFFLOAD_HEADROOM;

  return fits
    ? { kind: "resident", tokensPerSecond: residentRate, fits: true }
    : { kind: "spilled", tokensPerSecond: residentRate * SPILLED_FRACTION, fits: false };
}

/**
 * Whether an estimate is fast enough to be worth choosing.
 *
 * Only a `resident` estimate can be, and only by a clear margin: the estimate
 * runs optimistic by construction (see `ACHIEVABLE_FRACTION`'s neighbours), so
 * a model sitting exactly on 50 is in truth below it. Doubling the bar for the
 * verdict keeps the estimate honest — it says "yes, comfortably" or "no".
 *
 * `fits: null` — the case where memory is unknown but bandwidth is not — is
 * treated as a "no". The reader is told the machine is fast enough for the
 * model but cannot be told whether the model fits, which is a question they
 * would have to answer before choosing it anyway.
 */
export function clearsComfortableSpeed(estimate: SpeedEstimate): boolean {
  if (estimate.kind !== "resident") return false;
  if (estimate.fits !== true) return false;
  return estimate.tokensPerSecond >= COMFORTABLE_TOKENS_PER_SECOND;
}