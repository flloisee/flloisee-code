/**
 * The vocabulary of a machine, as far as this app cares to describe one.
 *
 * Only three facts are asked for, because only three facts change an answer:
 * which chip it is, how much memory a model could sit in, and how much
 * memory bandwidth moves it. Everything else about a computer is irrelevant to
 * whether a Model will run on it.
 *
 * Note what is *not* here: a measured tokens-per-second. Nothing in this app
 * has run a Model to find out how fast the machine is, and `lib/hardware/
 * bandwidth.ts` is where the estimate's assumptions are stated. The type is
 * deliberately shaped so a reader of it cannot mistake the estimate for a
 * measurement — see `lib/hardware/speed.ts`.
 */

/** Which sort of accelerator a machine has, as far as the probe can tell. */
export type AcceleratorKind = "apple" | "nvidia" | "amd" | "intel";

/**
 * The chip a Model would actually be decoded on.
 *
 * Deliberately nullable fields rather than a "no accelerator" boolean per
 * fact: a machine with an Apple M4 reports no separate VRAM at all, because
 * its memory is unified, and that absence is not a failure to report. A type
 * that forced a number there would have us invent one.
 */
export type Accelerator = {
  /** As the machine itself names it, e.g. "Apple M4" or "NVIDIA GeForce RTX 4090". */
  name: string;
  kind: AcceleratorKind;
  /**
   * Bytes of memory a Model would live in, or null when the machine does not
   * keep a separate pool for it. Apple Silicon reports null here on purpose:
   * its GPU reads the same memory as the CPU, so there is no second number.
   */
  memoryBytes: number | null;
  /** How many of the machine's cores are in the accelerator, when it says. */
  cores: number | null;
};

/** What the probe could establish about this machine. */
export type HardwareSpec = {
  /** `process.platform`, so the parsers that were tried are recorded. */
  platform: NodeJS.Platform;
  /** The CPU as the machine names it, e.g. "Apple M4" or "AMD Ryzen 9 7950X". */
  cpu: string | null;
  /** Physical cores. Logical threads are not asked for: a Model does not decode on them. */
  cores: number | null;
  /** Total RAM in bytes. */
  memoryBytes: number | null;
  /**
   * The accelerator, or null when none was named. Null means "we did not find
   * one", not "this machine has none" — a box running a driver we have no
   * parser for reads exactly the same as a box with no GPU, and the two are
   * told apart by what the Settings section says about it rather than here.
   */
  accelerator: Accelerator | null;
};

/**
 * The memory a Model would be decoded from: the accelerator's own pool where it
 * has one, the machine's RAM where it does not.
 *
 * Apple Silicon is the case this exists for. Its GPU and CPU share one pool, so
 * asking the accelerator for its VRAM gets nothing back — which is why
 * `Accelerator.memoryBytes` is allowed to be null while the answer to "how much
 * memory is there" is not.
 */
export function usableMemoryBytes(spec: HardwareSpec): number | null {
  const own = spec.accelerator?.memoryBytes;
  if (own !== null && own !== undefined && own > 0) return own;
  return spec.memoryBytes;
}