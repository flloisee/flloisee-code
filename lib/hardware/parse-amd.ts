import type { Accelerator } from "./spec";

/**
 * Reading the GPU out of `rocm-smi`.
 *
 * Written from the documented output rather than from a machine that has one:
 * this is the one parser here with no fixture captured off real hardware, and
 * it is lenient by construction because `rocm-smi`'s answer is a multi-section
 * CSV whose headings depend on the ROCm version. Where it fails it returns
 * null and the Settings section says no accelerator was found, which is a
 * truthful thing to tell someone — where it half-reads it would not be.
 *
 * So the parser looks for two things rather than taking fixed columns: a line
 * naming the card, and a line reporting memory total. Anything else is skipped.
 */

/**
 * The first accelerator rocm-smi names, or null.
 *
 * Named first rather than largest, for the same reason as the NVIDIA parser:
 * a local server selects a GPU by index and starts at zero.
 */
export function parseRocmRows(csv: string): Accelerator | null {
  let name: string | null = null;
  let memoryBytes: number | null = null;

  for (const raw of csv.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;

    // "card0,AMD Radeon RX 7900 XTX" — the card index, then its name. Guarded on
    // a card prefix so a heading line ("device,name") is not read as a name.
    const named = /^card\d+,\s*(.+)$/i.exec(line);
    if (name === null && named !== null) {
      const candidate = named[1].trim();
      if (candidate.length > 0) name = candidate;
      continue;
    }

    // A memory section reads its heading and then one row per card, e.g.
    //   "device,memory total (B),memory used (B)"
    //   "card0,25753026560,..."
    if (memoryBytes === null && /^card\d+,\s*(\d+)/i.test(line)) {
      const value = Number(/^card\d+,\s*(\d+)/i.exec(line)?.[1]);
      if (Number.isFinite(value) && value > 0) memoryBytes = value;
    }
  }

  if (name === null) return null;

  return { name, kind: "amd", memoryBytes, cores: null };
}

/** The query, kept beside the parser so the two cannot be argued apart. */
export const ROCM_QUERY = ["--showproductname", "--showmeminfo", "vram"] as const;