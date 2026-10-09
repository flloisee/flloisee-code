import type { Accelerator } from "./spec";

/**
 * Reading the GPU out of `nvidia-smi --query-gpu=... --format=csv,noheader,nounits`.
 *
 * CSV rather than JSON because `nvidia-smi` has no JSON output, and
 * `nounits` because the MiB it reports are the only unit every driver version
 * agrees on. The columns are asked for in one call and split positionally
 * rather than by header, since `noheader` is what makes the answer one clean
 * line per device.
 *
 * `nounits` reports MiB. That is the number NVIDIA's own docs use for VRAM, so
 * the conversion below is MiB to bytes and nothing else.
 */

/** The query, kept beside the parser so the two cannot be argued apart. */
export const NVIDIA_QUERY = [
  "--query-gpu=name,memory.total,memory.free",
  "--format=csv,noheader,nounits",
] as const;

/**
 * The first device's row, or null when there is no usable row.
 *
 * First, not largest. A local server loading a Model picks a GPU by index and
 * defaults to zero, so reporting device one describes what will actually be
 * used; summing across devices would report a pool nothing will draw from as
 * one. A multi-GPU box is therefore under-reported — which is the safe
 * direction, since a Model shown as too large here is merely slower than
 * advertised, never the reverse.
 */
export function parseNvidiaRow(csv: string): Accelerator | null {
  for (const line of csv.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const columns = trimmed.split(",").map((column) => column.trim());
    if (columns.length < 2) continue;

    const name = columns[0].length > 0 ? columns[0] : null;
    if (name === null) continue;

    // A row can name a GPU and report no memory — an X server with the driver
    // loaded but the card claimed by someone else reads like this. It is not
    // usable for sizing, so the row is skipped rather than half-read.
    const total = mebibytes(columns[1]);
    if (total === null) continue;

    return {
      name,
      kind: "nvidia",
      memoryBytes: total,
      cores: null,
    };
  }

  return null;
}

/**
 * A MiB column to bytes.
 *
 * Refuses anything it cannot read as a number rather than falling back to
 * zero, because zero would pass for "this GPU has no memory" and be believed.
 */
function mebibytes(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 1024 * 1024);
}