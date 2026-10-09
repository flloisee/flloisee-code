import { execFile } from "node:child_process";
import { cpus, totalmem } from "node:os";

import { parseMacosAccelerator } from "./parse-macos";
import { parseNvidiaRow, NVIDIA_QUERY } from "./parse-nvidia";
import { parseRocmRows, ROCM_QUERY } from "./parse-amd";
import type { Accelerator, HardwareSpec } from "./spec";

/**
 * Asking this machine what it is.
 *
 * Server-only, and it has to be: the browser cannot see the GPU, and neither
 * can Node on its own. Everything below shells out, and the shape of that is
 * the security-relevant part of this file.
 *
 * `execFile` with a fixed argument vector, never a shell string. Nothing from
 * a request, a query parameter, or an Endpoint is ever concatenated into an
 * argv, so there is no path here by which a caller chooses what runs. This is
 * the same invariant as "no base URL comes from a request", reached from the
 * other side: not merely that the *target* is fixed, but that the *command* is.
 *
 * Nothing here is fatal. A machine whose tools are missing, whose drivers are
 * unhappy, or whose `system_profiler` is slow all produce the same answer as a
 * machine with no GPU: no accelerator. The Settings section says so plainly
 * rather than showing a broken panel, because a reader who cannot tell "no GPU"
 * from "the probe failed" has been told nothing.
 */

/**
 * How long a probe may take before it is treated as having found nothing.
 *
 * Short enough that a reader who opens Settings is not waiting on it, long
 * enough that `system_profiler` — which is seconds, not milliseconds, on a
 * loaded machine — gets a fair chance. Slower than this and we would rather
 * report nothing than hold the dialog.
 */
const PROBE_TIMEOUT_MS = 4000;

/** The ceiling on what a probe tool may print. `nvidia-smi` on a big box is chatty. */
const PROBE_MAX_BUFFER = 1024 * 1024;

/**
 * Probes this machine once. Never rejects: a failure is an absent fact.
 *
 * Accepts an `exec`-shaped function so a test can answer with recorded output
 * instead of running anything. The default is the real `execFile`.
 */
export async function probeHardware(
  exec: Exec = defaultExec,
): Promise<HardwareSpec> {
  const base = cpuFacts();

  return {
    ...base,
    accelerator: await probeAccelerator(exec),
  };
}

/** The shape of `child_process.execFile`, narrowed to what this file uses. */
export type Exec = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; encoding: "utf8"; windowsHide: boolean },
  callback: (error: Error | null, stdout: string) => void,
) => void;

/**
 * What the machine says about itself without leaving Node.
 *
 * `os.cpus()` is the only source here that cannot fail, and its two blind
 * spots are known: it reports logical threads, and on Apple Silicon the model
 * string carries the SoC name rather than a CPU name — which is useful here,
 * because it is the same string `system_profiler` would report for the GPU.
 */
function cpuFacts(): Omit<HardwareSpec, "accelerator"> {
  const processors = cpus();
  const first = processors[0];

  return {
    platform: process.platform,
    cpu: first?.model?.trim() || null,
    // Logical threads, deliberately: there is no portable way to ask for
    // physical ones, and `os.availableParallelism()` — which does exclude
    // SMT siblings — is Node 19 and would break the stated Node 20.9 floor's
    // older cousins. The count is shown as a hint, never used in an estimate.
    cores: processors.length > 0 ? processors.length : null,
    memoryBytes: totalmem(),
  };
}

/**
 * Asks the platform's own tools what the accelerator is.
 *
 * Only one is tried per platform. A machine can have an NVIDIA card and an
 * integrated GPU, but a local server loads onto one of them and the first tool
 * that answers is the one that described the chip that will be used.
 */
async function probeAccelerator(exec: Exec): Promise<Accelerator | null> {
  if (process.platform === "darwin") {
    return parseMacosAccelerator(await quietly(exec, "system_profiler", ["SPDisplaysDataType", "-json"]));
  }

  if (process.platform === "linux") {
    return (
      parseNvidiaRow(await quietly(exec, "nvidia-smi", NVIDIA_QUERY)) ??
      parseRocmRows(await quietly(exec, "rocm-smi", ROCM_QUERY))
    );
  }

  // Windows is not probed. `wmic` reports AdapterRAM as a 32-bit integer, which
  // truncates at 4 GB — so a 24 GB card reads as 4 GB, or as "[integer]" — and
  // a wrong answer here is worse than none: it would mark a Model as too large
  // for a machine that has room for it. Until there is a way to ask that
  // returns the real number, a Windows machine reports its CPU and its RAM and
  // no accelerator, and the Speed fit says why.
  return null;
}

/**
 * Runs a probe tool and hands back its stdout, or an empty string if it did not
 * answer.
 *
 * A missing binary, a non-zero exit, a timeout and a crash all arrive here as
 * an error, and all four mean the same thing to this app: no accelerator. They
 * are not distinguished because nothing downstream could act on the difference.
 *
 * The failure is an empty string rather than null so that each parser can take
 * `string` directly. An empty answer is not JSON and not a CSV row, so every
 * parser here already has to treat it as "nothing found" — the same path an
 * absent tool takes — and returning null would only add a second spelling of it
 * at every call site.
 */
function quietly(exec: Exec, file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    try {
      exec(
        file,
        args,
        { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER, encoding: "utf8", windowsHide: true },
        (error, stdout) => resolve(error ? "" : stdout),
      );
    } catch {
      // A tool that throws synchronously — which `execFile` does on some
      // platforms for a malformed path — is still only a tool that did not
      // answer.
      resolve("");
    }
  });
}

/** The real thing, wrapped so `probeHardware` can be given something else in a test. */
const defaultExec: Exec = (file, args, options, callback) => {
  execFile(file, [...args], options, callback);
};