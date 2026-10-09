import { z } from "zod";

import { readRouteError, readRouteJSON } from "@/lib/http/route-answer";
import type { Accelerator, HardwareSpec } from "./spec";

/**
 * Asking the hardware Route Handler from the interface.
 *
 * The shape is read through a schema even though the answer comes from the
 * app's own server, and that is not defensiveness for its own sake: the
 * component below renders the accelerator's `memoryBytes` straight into an
 * "N GB" string, and a malformed answer there would put `NaN GB` in front of a
 * reader. Parsing it is the difference between a wrong-looking thing and a
 * working thing.
 */

const acceleratorSchema = z.object({
  name: z.string(),
  kind: z.enum(["apple", "nvidia", "amd", "intel"]),
  memoryBytes: z.number().nullable(),
  cores: z.number().nullable(),
});

const hardwareSchema = z.object({
  platform: z.string(),
  cpu: z.string().nullable(),
  cores: z.number().nullable(),
  memoryBytes: z.number().nullable(),
  accelerator: acceleratorSchema.nullable(),
});

/** What the hardware route leaves the interface with, including "we could not tell". */
export type HardwareAnswer =
  | { status: "found"; spec: HardwareSpec }
  | { status: "unavailable"; message: string };

/** Reads one answer from the hardware Route Handler. */
export function readHardwareAnswer({
  status,
  body,
}: {
  status: number;
  body: unknown;
}): HardwareAnswer {
  if (status === 0) {
    return { status: "unavailable", message: "Could not reach the app's hardware route." };
  }

  if (status !== 200) {
    return { status: "unavailable", message: readRouteError(body) ?? "The app could not read this machine." };
  }

  const parsed = hardwareSchema.safeParse(body);

  if (!parsed.success) {
    return { status: "unavailable", message: "The hardware route answered in an unexpected form." };
  }

  return { status: "found", spec: parsed.data as HardwareSpec };
}

/** Asks the app what machine it is running on. */
export async function requestHardware(): Promise<HardwareAnswer> {
  let response: Response;

  try {
    // No body beyond the strict empty object the route's schema requires.
    response = await fetch("/api/hardware", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } catch {
    return readHardwareAnswer({ status: 0, body: null });
  }

  return readHardwareAnswer({ status: response.status, body: await readRouteJSON(response) });
}

/**
 * The one-line description of a machine, in the reader's words.
 *
 * A specification sheet is the wrong shape here. A reader opening Settings is
 * asking "can this thing run what I want to run", and they want the chip and
 * the memory that decide that — not the platform string and the core count
 * that did not decide anything. So the accelerator is named first when there is
 * one, and the CPU only when there is not.
 */
export function describeMachine(spec: HardwareSpec): string {
  const parts: string[] = [];

  const accelerator = spec.accelerator;
  if (accelerator !== null) {
    parts.push(accelerator.name);

    if (accelerator.cores !== null) parts.push(`${accelerator.cores} GPU cores`);
    if (accelerator.memoryBytes !== null) parts.push(`${gib(accelerator.memoryBytes)} VRAM`);
    // Apple Silicon's memory is the machine's, and saying so is more useful to
    // a reader than repeating the RAM figure they would recognise anyway.
    else if (spec.memoryBytes !== null) parts.push(`${gib(spec.memoryBytes)} unified memory`);
  } else if (spec.cpu !== null) {
    parts.push(spec.cpu);
    if (spec.cores !== null) parts.push(`${spec.cores} cores`);
    if (spec.memoryBytes !== null) parts.push(`${gib(spec.memoryBytes)} memory`);
  }

  return parts.join(" · ");
}

/** Bytes as the reader would say them. */
function gib(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} GB`;
}

export type { Accelerator };