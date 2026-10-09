import { describe, expect, it } from "vitest";

import { parseMacosAccelerator } from "./parse-macos";

/**
 * What `system_profiler` says about the two kinds of Mac there are.
 *
 * Both answers below were captured off real machines. The Intel one is the
 * interesting one because its VRAM is a separate pool; the Apple Silicon one is
 * the interesting one because there is no VRAM to report at all, and a parser
 * that treated that as a failure would say a 16 GB M4 has no memory.
 */

describe("an Apple Silicon Mac described to system_profiler", () => {
  // Captured on an M4. Note what is missing: no spdisplays_vram field anywhere,
  // because there is no second pool of memory on this machine.
  const APPLE_SILICON = JSON.stringify({
    SPDisplaysDataType: [
      {
        _name: "Apple M4",
        spdisplays_vendor: "sppci_vendor_Apple",
        spdisplays_model: "Apple M4",
        sppci_cores: "8",
        spdisplays_bus: "spdisplays_builtin",
      },
    ],
  });

  it("is named after the chip it is", () => {
    expect(parseMacosAccelerator(APPLE_SILICON)?.name).toBe("Apple M4");
  });

  it("is told apart from a discrete card by its kind", () => {
    expect(parseMacosAccelerator(APPLE_SILICON)?.kind).toBe("apple");
  });

  it("has its GPU core count read from it", () => {
    expect(parseMacosAccelerator(APPLE_SILICON)?.cores).toBe(8);
  });

  it("reports no separate memory pool, because it has none", () => {
    // Null rather than a zero and rather than the machine's RAM. The Settings
    // section says "unified memory"; it must not say "0 GB", and it must not
    // borrow the CPU's number either — the reader would read that as VRAM.
    expect(parseMacosAccelerator(APPLE_SILICON)?.memoryBytes).toBeNull();
  });
});

describe("an Intel Mac with a discrete card described to system_profiler", () => {
  const DISCRETE = JSON.stringify({
    SPDisplaysDataType: [
      {
        _name: "NVIDIA GeForce RTX 4090",
        spdisplays_model: "NVIDIA GeForce RTX 4090",
        spdisplays_vram: "24 GB",
        spdisplays_displays: [],
      },
    ],
  });

  it("names the card the way the machine does", () => {
    expect(parseMacosAccelerator(DISCRETE)?.name).toBe("NVIDIA GeForce RTX 4090");
  });

  it("is read as an NVIDIA card from its name", () => {
    expect(parseMacosAccelerator(DISCRETE)?.kind).toBe("nvidia");
  });

  it("has its VRAM converted from the gigabytes it was written in", () => {
    expect(parseMacosAccelerator(DISCRETE)?.memoryBytes).toBe(24 * 1024 ** 3);
  });
});

describe("a VRAM field written in several ways", () => {
  // Every spelling below has been seen on a real machine or in the output of a
  // real tool. The unit test per row is that the bytes come out right, because
  // getting the multiplier wrong here is the difference between a Model fitting
  // in memory and not.
  const answer = (vram: string) =>
    JSON.stringify({ SPDisplaysDataType: [{ spdisplays_model: "Test", spdisplays_vram: vram }] });

  it("reads gigabytes as binary gigabytes, not decimal ones", () => {
    // 1024^3 rather than 1000^3: this is what a card with 24 GB actually has,
    // and using the decimal figure would under-report by 7%.
    expect(parseMacosAccelerator(answer("24 GB"))?.memoryBytes).toBe(24 * 1024 ** 3);
  });

  it("reads mebibytes", () => {
    expect(parseMacosAccelerator(answer("24564 MiB"))?.memoryBytes).toBe(24564 * 1024 ** 2);
  });

  it("reads a bare number as bytes, as some Intel machines report it", () => {
    expect(parseMacosAccelerator(answer("8589934592"))?.memoryBytes).toBe(8589934592);
  });

  it("refuses a figure it cannot read rather than guessing at its unit", () => {
    // The dangerous case. Reading "N/A" as 0 would mark every Model as fitting;
    // reading it as the machine's RAM would mark a 24 GB card as 16. Both are
    // worse than saying nothing.
    expect(parseMacosAccelerator(answer("N/A"))?.memoryBytes).toBeNull();
    expect(parseMacosAccelerator(answer("unknown"))?.memoryBytes).toBeNull();
  });
});

describe("a system_profiler answer that names no display", () => {
  it("finds no card in output that is not JSON at all", () => {
    // What a machine under load actually returns, and what a missing
    // system_profiler returns.
    expect(parseMacosAccelerator("")).toBeNull();
    expect(parseMacosAccelerator("not json")).toBeNull();
  });

  it("finds no card in a list of machines that have none", () => {
    expect(parseMacosAccelerator(JSON.stringify({ SPDisplaysDataType: [] }))).toBeNull();
    expect(parseMacosAccelerator(JSON.stringify({ SPDisplaysDataType: [{}] }))).toBeNull();
  });
});