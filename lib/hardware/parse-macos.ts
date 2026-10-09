import type { Accelerator } from "./spec";

/**
 * Reading the GPU out of `system_profiler SPDisplaysDataType -json`.
 *
 * This is the only thing on macOS that names a chip without asking a driver
 * whether it is alive: `sysctl` gives the SoC name, but nothing there says how
 * much of it is a GPU. `system_profiler` costs a second or two per call, which
 * is why `lib/hardware/probe.ts` runs it once and reads everything from the one
 * answer rather than asking twice.
 *
 * The shape it answers with varies by machine in a way worth recording, because
 * both cases appear in the wild and they are not the same fact:
 *
 *   - Apple Silicon:  "spdisplays_model": "Apple M4", and *no* VRAM field at
 *     all. There is no separate pool to report; the memory is the machine's.
 *   - Intel with a discrete card: "spdisplays_model": "NVIDIA GeForce RTX 4090",
 *     with "spdisplays_vram": "24 GB".
 *
 * So a missing VRAM is normal and must not be reported as a probe failure. The
 * parser returns null for the field rather than a guess.
 */

/** What one `SPDisplaysDataType` entry said. Only the fields we carry are named. */
type DisplayEntry = {
  spdisplays_model?: unknown;
  _name?: unknown;
  spdisplays_vram?: unknown;
  sppci_cores?: unknown;
};

/**
 * Pulls the accelerator out of the whole `system_profiler` answer.
 *
 * The first entry wins. On a machine with more than one display adapter this
 * discards the rest, which is a real limitation: two cards are two pools and
 * this reports the first. A local server picks a GPU too, and it picks the
 * first as well, so the answer matches what will actually happen — but a
 * multi-GPU box is misreported as a single-GPU one, and that is stated here
 * rather than discovered later.
 */
export function parseMacosAccelerator(json: string): Accelerator | null {
  const parsed: unknown = safeJson(json);
  if (typeof parsed !== "object" || parsed === null) return null;

  const entries = (parsed as Record<string, unknown>).SPDisplaysDataType;
  if (!Array.isArray(entries)) return null;

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const display = entry as DisplayEntry;

    const name = text(display.spdisplays_model) ?? text(display._name);
    if (name === null) continue;

    return {
      name,
      kind: kindOf(name),
      memoryBytes: parseVram(display.spdisplays_vram),
      cores: count(display.sppci_cores),
    };
  }

  return null;
}

/**
 * Which sort of chip it names.
 *
 * Guessed from the name because `system_profiler` has no field for it. This is
 * the one place the app infers rather than reads, and it is confined to a
 * four-way answer where a wrong guess costs a wrong bandwidth row at worst.
 */
function kindOf(name: string): Accelerator["kind"] {
  const lowered = name.toLowerCase();
  if (lowered.includes("nvidia") || lowered.includes("geforce") || lowered.includes("quadro") || lowered.includes("rtx")) return "nvidia";
  if (lowered.includes("amd") || lowered.includes("radeon")) return "amd";
  if (lowered.includes("intel")) return "intel";
  // An Apple Silicon GPU is named after the SoC and has no vendor in the
  // string, which is exactly why it falls through to the default.
  return "apple";
}

/**
 * "24 GB" to bytes, and the several other things a VRAM field is spelled as.
 *
 * Bare numbers appear on some Intel Macs where the field is already a byte
 * count. Anything without a unit is refused rather than assumed to be one or
 * the other — a wrong multiplier here is the difference between a Model
 * fitting and not.
 */
function parseVram(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;

  const match = /^([\d.]+)\s*([kmgt]?i?b)?$/i.exec(raw.trim());
  if (match === null) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = (match[2] ?? "").toLowerCase();
  const multiplier = /^[kmgt]i?b$/.test(unit) ? Math.pow(1024, "kmgt".indexOf(unit[0]) + 1) : 1;

  return Math.round(amount * multiplier);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * A core count as a positive integer, or null when it is not one.
 *
 * The field is a string in every captured answer — `"8"` rather than `8` —
 * because `system_profiler` prints its numbers for humans. Reading only a
 * `typeof === "number"` field here reported no GPU core count on every machine,
 * which is the kind of failure that looks like a machine without a GPU.
 */
function count(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}