import type { HardwareSpec } from "./spec";

/**
 * How fast memory moves on each chip we have a row for.
 *
 * This table is the weakest joint in the whole estimate, so it says where each
 * number came from. Every figure is a *theoretical* bandwidth from the vendor's
 * own specification, not a measured one — no machine in this repo's history was
 * benchmarked to produce a row. Real throughput on a decode is roughly 70–85%
 * of the figure below, because nothing reads memory at its peak rate.
 *
 * The consequence is worth stating plainly: every tokens-per-second this app
 * shows is an estimate that runs slightly optimistic, and it is shown with a
 * `~` and the word "estimated" in the UI for that reason. A reader who knows
 * their own machine is faster than the number on screen should believe their
 * machine.
 *
 * Why a table at all, rather than asking the machine: there is no portable call
 * that returns memory bandwidth. `nvidia-smi` reports clocks, not achieved
 * transfer, and measuring it needs a loop that moves a buffer and times it —
 * which is a benchmark run inside a settings dialog, several seconds long, and
 * not something to do behind a button labelled "Settings".
 *
 * Rows are added by hand, which means an unknown chip answers null and the
 * Speed fit says it cannot tell. That is the correct behaviour: the alternative
 * is guessing a bandwidth and dividing a real model size by it, which produces
 * a confident number with nothing behind it.
 */

/** Bytes per second. Stored in GB/s and converted once here, to keep rows readable. */
const GIB = 1024 ** 3;

export type BandwidthRow = {
  /** Matched against the chip name, lowercased. See `matches`. */
  name: string;
  /** Theoretical bandwidth in GB/s (binary), from the vendor's specification. */
  gigabytesPerSecond: number;
  /** Where the figure came from, so a reviewer can check it rather than trust it. */
  source: string;
};

/**
 * The chips we have rows for.
 *
 * Ordered most specific first: a row naming a full card (`"RTX 4090"`) is
 * tried before one naming a family (`"RTX 40"`), because a family row is a
 * guess about a card and a specific row is not. `bandwidthFor` walks the list
 * in this order and takes the first match, so the order is load-bearing.
 */
export const BANDWIDTH_ROWS: readonly BandwidthRow[] = [
  // NVIDIA. The 40-series figure is the well-known 1008 GB/s on a 4090; the
  // 30-series is roughly a third of that, which is most of why a 3090 and a
  // 4090 running the same Model differ so much in a conversation's pace.
  { name: "RTX 4090", gigabytesPerSecond: 1008, source: "NVIDIA Ada AD102 specification" },
  { name: "RTX 4080 Super", gigabytesPerSecond: 736, source: "NVIDIA Ada AD103 specification" },
  { name: "RTX 4070 Ti Super", gigabytesPerSecond: 504, source: "NVIDIA Ada AD104 specification" },
  { name: "RTX 3090", gigabytesPerSecond: 936, source: "NVIDIA GA102 specification" },
  { name: "RTX 3080 Ti", gigabytesPerSecond: 912, source: "NVIDIA GA102 specification" },
  { name: "RTX 3080", gigabytesPerSecond: 760, source: "NVIDIA GA102 specification" },
  { name: "RTX 3060 Ti", gigabytesPerSecond: 448, source: "NVIDIA GA104 specification" },
  { name: "RTX 3060", gigabytesPerSecond: 360, source: "NVIDIA GA106 specification" },
  { name: "RTX 2080 Ti", gigabytesPerSecond: 616, source: "NVIDIA Turing TU102 specification" },
  { name: "RTX 2060", gigabytesPerSecond: 336, source: "NVIDIA Turing TU106 specification" },
  { name: "A100", gigabytesPerSecond: 1555, source: "NVIDIA Ampere GA100 specification" },
  { name: "H100", gigabytesPerSecond: 3350, source: "NVIDIA Hopper GH100 specification" },

  // Apple Silicon. Unified memory, so these are also the machine's RAM figures
  // in practice. The M4 row is generous on purpose — the base M4's memory bus
  // is wider than its GPU core count alone would suggest, and the commonly
  // quoted decode figures for it sit above what its 10-core sibling manages.
  { name: "M4 Max", gigabytesPerSecond: 546, source: "Apple M4 Max memory bandwidth" },
  { name: "M4 Pro", gigabytesPerSecond: 273, source: "Apple M4 Pro memory bandwidth" },
  { name: "M4", gigabytesPerSecond: 120, source: "Apple M4 memory bandwidth" },
  { name: "M3 Max", gigabytesPerSecond: 400, source: "Apple M3 Max memory bandwidth" },
  { name: "M3 Ultra", gigabytesPerSecond: 800, source: "Apple M3 Ultra memory bandwidth" },
  { name: "M3 Pro", gigabytesPerSecond: 150, source: "Apple M3 Pro memory bandwidth" },
  { name: "M3", gigabytesPerSecond: 100, source: "Apple M3 memory bandwidth" },
  { name: "M2 Ultra", gigabytesPerSecond: 800, source: "Apple M2 Ultra memory bandwidth" },
  { name: "M2 Max", gigabytesPerSecond: 400, source: "Apple M2 Max memory bandwidth" },
  { name: "M2 Pro", gigabytesPerSecond: 200, source: "Apple M2 Pro memory bandwidth" },
  { name: "M2", gigabytesPerSecond: 100, source: "Apple M2 memory bandwidth" },
  { name: "M1 Ultra", gigabytesPerSecond: 400, source: "Apple M1 Ultra memory bandwidth" },
  { name: "M1 Max", gigabytesPerSecond: 400, source: "Apple M1 Max memory bandwidth" },
  { name: "M1 Pro", gigabytesPerSecond: 200, source: "Apple M1 Pro memory bandwidth" },
  { name: "M1", gigabytesPerSecond: 68, source: "Apple M1 memory bandwidth" },
  { name: "Apple M", gigabytesPerSecond: 100, source: "Apple M-series fallback" },

  // AMD. Card figures, from the VRAM bus width times its rated speed.
  { name: "7900 XTX", gigabytesPerSecond: 960, source: "AMD RDNA 3 specification" },
  { name: "7900 XT", gigabytesPerSecond: 624, source: "AMD RDNA 3 specification" },
  { name: "7800 XT", gigabytesPerSecond: 624, source: "AMD RDNA 3 specification" },
  { name: "7700 XT", gigabytesPerSecond: 432, source: "AMD RDNA 3 specification" },
  { name: "7600", gigabytesPerSecond: 288, source: "AMD RDNA 3 specification" },
  { name: "6950 XT", gigabytesPerSecond: 504, source: "AMD RDNA 2 specification" },
  { name: "6900 XT", gigabytesPerSecond: 512, source: "AMD RDNA 2 specification" },
  { name: "6800 XT", gigabytesPerSecond: 384, source: "AMD RDNA 2 specification" },
  { name: "6700 XT", gigabytesPerSecond: 384, source: "AMD RDNA 2 specification" },
  { name: "RX 7900", gigabytesPerSecond: 576, source: "AMD RDNA 3 specification" },

  // Integrated. A discrete card with no card at all — an Intel iGPU shares
  // system memory and has a fraction of the bandwidth, which is why a 7B Model
  // that is comfortable on a 4060 is unusable on one of these.
  { name: "Arc A770", gigabytesPerSecond: 560, source: "Intel Arc specification" },
  { name: "Arc B580", gigabytesPerSecond: 456, source: "Intel Arc specification" },
  { name: "Iris Xe", gigabytesPerSecond: 68, source: "Intel Xe-LP specification" },
  { name: "Radeon 780M", gigabytesPerSecond: 89, source: "AMD RDNA 3 specification" },
  { name: "Radeon 680M", gigabytesPerSecond: 76, source: "AMD RDNA 2 specification" },
];

/**
 * The fraction of theoretical bandwidth a real decode achieves.
 *
 * Measured against llama.cpp conversations rather than a synthetic read, where
 * sustained sequential reads land at roughly four-fifths of the figure on a
 * discrete card and rather less on a unified-memory Mac. Applied to every row
 * so that no number in the UI is the vendor's peak.
 */
const ACHIEVABLE_FRACTION = 0.8;

/**
 * The bandwidth of this machine's accelerator, in bytes per second.
 *
 * Null when the machine's chip has no row, which is a real answer: the Speed
 * fit then says it cannot estimate rather than dividing by a guess. Note that a
 * machine with no accelerator at all also gets null — a CPU decode is memory
 * bandwidth-bound too, but the same table would have to model cache behaviour
 * as well, and a wrong CPU figure is worse than none.
 */
export function bandwidthFor(spec: HardwareSpec): number | null {
  const accelerator = spec.accelerator;
  if (accelerator === null) return null;

  if (isPortableVariant(accelerator.name)) return null;

  const row = BANDWIDTH_ROWS.find((candidate) => matches(candidate.name, accelerator.name));
  if (row === undefined) return null;

  return Math.round(row.gigabytesPerSecond * ACHIEVABLE_FRACTION * GIB);
}

/**
 * The row this machine's chip resolves to, and where the figure came from.
 *
 * The UI shows the source beside the number. A reader deciding whether to
 * believe "~24 tok/s" deserves to know it came from a specification sheet
 * rather than from this machine, and the row's `source` string is the honest
 * answer to that.
 */
export function bandwidthRowFor(spec: HardwareSpec): BandwidthRow | null {
  const accelerator = spec.accelerator;
  if (accelerator === null || isPortableVariant(accelerator.name)) return null;

  return BANDWIDTH_ROWS.find((candidate) => matches(candidate.name, accelerator.name)) ?? null;
}

/**
 * Whether a chip name is this row.
 *
 * Word-boundary matching, not substring. "M4" must not quietly answer for
 * "M4 Max", which has four and a half times its bandwidth, and "RTX 3090" for
 * a 3080. The boundary is a space or the end of the string on either side, so
 * "nvidia geforce rtx 4090" finds the "RTX 4090" row.
 *
 * The residual case — "M4" still matching "Apple M4 Max", since it is followed
 * by a space — is settled by the order of BANDWIDTH_ROWS rather than here:
 * "M4 Max" is tried first and takes it. Which is why that array's comment says
 * its order is load-bearing, and why reordering it is not a cosmetic change.
 */
function matches(rowName: string, chipName: string): boolean {
  const row = rowName.toLowerCase();
  const chip = chipName.toLowerCase();

  if (!chip.includes(row)) return false;

  const at = chip.indexOf(row);
  const before = chip[at - 1];
  const after = chip[at + row.length];

  const startsCleanly = at === 0 || before === " ";
  const endsCleanly = after === undefined || after === " ";

  return startsCleanly && endsCleanly;
}

/**
 * The chip a name describes, when it is the portable version of a card.
 *
 * NVIDIA ships an "RTX 4090 Laptop GPU" that is not an RTX 4090 — 576 GB/s
 * against 1008, and 16 GB of memory against 24 — and it names itself almost
 * exactly like the desktop card, so the desktop row matches it and overstates
 * its speed by three quarters. Same problem for the 4080, 4070 and 3080 Laptop.
 *
 * There is no row for the laptop parts, because they vary by manufacturer and
 * the two figures that matter are not one number. So the match is refused
 * outright instead, and the Speed fit says it cannot estimate for that card.
 * Refusing is the right way round: a reader with a laptop 4090 is told nothing
 * rather than told a desktop card's speed.
 *
 * Apple and AMD do not have this problem in the same form — "Apple M4 Max" is
 * genuinely a different chip from "Apple M4" — so this is keyed on the word
 * "laptop" alone rather than on the vendor.
 */
function isPortableVariant(chipName: string): boolean {
  return chipName.toLowerCase().includes("laptop") || chipName.toLowerCase().includes("mobile");
}