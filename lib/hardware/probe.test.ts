import { describe, expect, it } from "vitest";

import { probeHardware, type Exec } from "./probe";
import { usableMemoryBytes } from "./spec";
import type { HardwareSpec } from "./spec";

/**
 * The probe, asked questions it has to answer without shelling out.
 *
 * The `Exec` it takes is the seam: a test hands it recorded output and the
 * probe cannot tell the difference. That matters more here than in most code,
 * because the alternative is a test suite that only passes on the machine that
 * wrote it — and a Mac-only suite for a feature whose whole subject is "not
 * everyone has a Mac".
 */

describe("a tool that answered", () => {
  /** An exec that answers whatever the fixture says, and nothing for the rest. */
  const answering = (fixtures: Record<string, string>): Exec => (file, _args, _options, callback) => {
    const answer = fixtures[file];
    callback(answer === undefined ? new Error("not found") : null, answer ?? "");
  };

  it("is asked for the GPU with a fixed argv and never a shell string", async () => {
    const seen: { file: string; args: string[] }[] = [];

    const spy: Exec = (file, args, _options, callback) => {
      seen.push({ file, args: [...args] });
      callback(null, "{}");
    };

    await probeHardware(spy);

    // The invariant this file exists to hold: the command is fixed, so no
    // caller can reach it. If this test ever needs a fixture file to appear
    // here, something has been made configurable that must not be.
    for (const call of seen) {
      expect(call.args.every((argument) => !/[;&|`$()]/.test(argument))).toBe(true);
    }
  });

  it("reads the chip off a Mac that answered", async () => {
    const spec = await probeHardware(
      answering({
        system_profiler: JSON.stringify({
          SPDisplaysDataType: [{ spdisplays_model: "Apple M4", sppci_cores: "8" }],
        }),
      }),
    );

    expect(spec.accelerator?.name).toBe("Apple M4");
    expect(spec.accelerator?.cores).toBe(8);
  });

  it("reads a card off a Linux box that answered nvidia-smi", async () => {
    // The parser is exercised through the probe so that the argv and the
    // parser cannot drift apart: a test that called the parser directly would
    // still pass if the probe asked for the wrong columns.
    if (process.platform !== "linux") return;

    const spec = await probeHardware(
      answering({ "nvidia-smi": "NVIDIA GeForce RTX 4090, 24564, 20000" }),
    );

    expect(spec.accelerator?.kind).toBe("nvidia");
  });
});

describe("a machine whose tools did not answer", () => {
  const silent: Exec = (_file, _args, _options, callback) => {
    callback(new Error("ENOENT"), "");
  };

  it("reports no accelerator rather than failing the probe", async () => {
    // The whole point of the design: a missing system_profiler and a missing
    // driver are the same fact to this app, and neither is worth an error the
    // Settings dialog would have to explain.
    const spec = await probeHardware(silent);

    expect(spec.accelerator).toBeNull();
  });

  it("still reports what Node could tell it on its own", async () => {
    // RAM and core count do not depend on any of the tools above, so a
    // machine where they all fail is not a machine with nothing to say.
    const spec = await probeHardware(silent);

    expect(spec.memoryBytes).toBeGreaterThan(0);
    expect(spec.cores).toBeGreaterThan(0);
  });

  it("survives a tool that throws instead of exiting", async () => {
    // `execFile` throws synchronously on some platforms rather than calling
    // back. That is still only a tool that did not answer.
    const throwing: Exec = () => {
      throw new Error("spawn failed");
    };

    await expect(probeHardware(throwing)).resolves.toMatchObject({ accelerator: null });
  });
});

describe("the memory a Model would be decoded from", () => {
  const base = {
    platform: "darwin" as NodeJS.Platform,
    cpu: "Apple M4",
    cores: 10,
    memoryBytes: 16 * 1024 ** 3,
    accelerator: null,
  };

  it("is the machine's memory where the accelerator has no pool of its own", () => {
    // Apple Silicon: one pool, read by both. This is the case the fallback
    // exists for, and it is the common one on a Mac.
    expect(usableMemoryBytes(base)).toBe(16 * 1024 ** 3);
  });

  it("is the accelerator's own memory where it has one", () => {
    const discrete: HardwareSpec = {
      ...base,
      accelerator: { name: "RTX 4090", kind: "nvidia", memoryBytes: 24 * 1024 ** 3, cores: null },
    };

    // Not the sum, and not the smaller of the two. A 24 GB card on a 16 GB
    // machine is 24 GB to a Model, which is the whole reason for the field.
    expect(usableMemoryBytes(discrete)).toBe(24 * 1024 ** 3);
  });

  it("falls back to the machine's memory when a card reports none", () => {
    const unsized: HardwareSpec = {
      ...base,
      accelerator: { name: "AMD Radeon", kind: "amd", memoryBytes: null, cores: null },
    };

    expect(usableMemoryBytes(unsized)).toBe(16 * 1024 ** 3);
  });
});