import { describe, expect, it } from "vitest";

import { BANDWIDTH_ROWS, bandwidthFor, bandwidthRowFor } from "./bandwidth";
import type { HardwareSpec } from "./spec";

/**
 * Which row a chip name finds, and — the part that matters more — which it
 * does not.
 *
 * Every name below is a chip someone runs a Model on. A table that is right
 * about the cards it knows and wrong about the ones it does not is acceptable;
 * a table that is confidently wrong is not, so these tests spend most of their
 * effort on the refusals.
 */

const withChip = (name: string, memoryBytes: number | null = 24 * 1024 ** 3): HardwareSpec => ({
  platform: "linux",
  cpu: "Test CPU",
  cores: 16,
  memoryBytes: 64 * 1024 ** 3,
  accelerator: { name, kind: "nvidia", memoryBytes, cores: null },
});

describe("a chip the table has a row for", () => {
  it("is given the figure from that chip's own row", () => {
    const row = bandwidthRowFor(withChip("NVIDIA GeForce RTX 4090"));

    expect(row?.gigabytesPerSecond).toBe(1008);
    // Scaled down to what a decode actually achieves, not the vendor's peak.
    expect(bandwidthFor(withChip("NVIDIA GeForce RTX 4090"))).toBe(Math.round(1008 * 0.8 * 1024 ** 3));
  });

  it("carries where its figure came from, so the UI can say", () => {
    // A reader told "~24 tok/s" is entitled to know it came from a spec sheet.
    const row = bandwidthRowFor(withChip("NVIDIA GeForce RTX 4090"));

    expect(row?.source).toContain("specification");
  });

  it("finds a row hidden inside a longer vendor name", () => {
    // Real strings from nvidia-smi and system_profiler, both of which prefix
    // the chip with a vendor.
    expect(bandwidthFor(withChip("AMD Radeon RX 7900 XTX"))).not.toBeNull();
    expect(bandwidthFor(withChip("NVIDIA GeForce RTX 3060"))).not.toBeNull();
  });
});

describe("a chip whose row must not be borrowed from a neighbour", () => {
  it("gives the Max its own figure rather than the base chip's", () => {
    // The case that makes word boundaries worth having: "Apple M4 Max" contains
    // "M4", and the base chip's row is four and a half times weaker. The array
    // order is what settles it, so this test fails if the rows are resorted.
    const max = bandwidthRowFor(withChip("Apple M4 Max", 128 * 1024 ** 3));
    const base = bandwidthRowFor(withChip("Apple M4", 16 * 1024 ** 3));

    expect(max?.gigabytesPerSecond).toBe(546);
    expect(base?.gigabytesPerSecond).toBe(120);
    expect(max?.gigabytesPerSecond).not.toBe(base?.gigabytesPerSecond);
  });

  it("is not fooled by a neighbouring generation", () => {
    // "RTX 3090" and "RTX 3080" differ by less than a megabyte of text, so a
    // prefix match would hand a 3080 the 3090's figure.
    expect(bandwidthRowFor(withChip("NVIDIA GeForce RTX 3080"))?.gigabytesPerSecond).toBe(760);
  });

  it("keeps every specific row ahead of every family row", () => {
    // "Apple M" is the fallback row and would match every Mac if it were tried
    // first, which would make the M4 and M4 Max rows decorative.
    const order = BANDWIDTH_ROWS.map((row) => row.name);
    expect(order.indexOf("M4 Max")).toBeLessThan(order.indexOf("Apple M"));
    expect(order.indexOf("M4")).toBeLessThan(order.indexOf("Apple M"));
  });
});

describe("a chip the table has no row for", () => {
  it("refuses rather than borrowing the nearest figure", () => {
    // The whole reason `bandwidthFor` returns null. Dividing a real model size
    // by a made-up bandwidth produces a confident number with nothing behind
    // it, which is the one outcome this feature must never produce.
    expect(bandwidthFor(withChip("NVIDIA GeForce RTX 9070 Ti"))).toBeNull();
    expect(bandwidthFor(withChip("Intel Arc A770"))).not.toBeNull();
    expect(bandwidthFor(withChip("Some Future Accelerator"))).toBeNull();
  });

  it("refuses a laptop card that names itself after a desktop one", () => {
    // Real and nasty: the RTX 4090 Laptop GPU is 576 GB/s against the desktop
    // card's 1008, and names itself almost identically. Answering with the
    // desktop row would overstate it by three quarters, so no answer is given.
    expect(bandwidthFor(withChip("NVIDIA GeForce RTX 4090 Laptop GPU"))).toBeNull();
    expect(bandwidthFor(withChip("NVIDIA GeForce RTX 3080 Ti Laptop GPU"))).toBeNull();
  });

  it("has nothing to say about a machine with no accelerator", () => {
    // A CPU decode is also bandwidth-bound, but modelling it would mean
    // modelling cache behaviour too, and a wrong CPU figure is worse than none.
    const cpuOnly: HardwareSpec = {
      platform: "linux",
      cpu: "AMD Ryzen 9 7950X",
      cores: 16,
      memoryBytes: 64 * 1024 ** 3,
      accelerator: null,
    };

    expect(bandwidthFor(cpuOnly)).toBeNull();
  });
});