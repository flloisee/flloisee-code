import { describe, expect, it } from "vitest";

import { parseNvidiaRow } from "./parse-nvidia";
import { parseRocmRows } from "./parse-amd";

/**
 * What the two Linux tools answer with.
 *
 * The NVIDIA row below is the real shape: `nounits` gives bare MiB with no
 * unit in the text, which is the detail that catches people out — a parser
 * that reads "24564" as bytes would be wrong by a factor of a million.
 */

describe("a row from nvidia-smi asked for CSV with no units", () => {
  it("names the card and reads its memory as MiB, not bytes", () => {
    const row = parseNvidiaRow("NVIDIA GeForce RTX 4090, 24564, 20000");

    expect(row?.name).toBe("NVIDIA GeForce RTX 4090");
    expect(row?.kind).toBe("nvidia");
    expect(row?.memoryBytes).toBe(24564 * 1024 * 1024);
  });

  it("reads the first card rather than adding them up", () => {
    // Two cards is two pools, and a local server picks one by index and starts
    // at zero. Reporting the sum describes a machine no single Model will run
    // on; reporting the first describes the one it will.
    const two = parseNvidiaRow(
      ["NVIDIA GeForce RTX 4090, 24564, 20000", "NVIDIA GeForce RTX 3090, 24576, 24000"].join("\n"),
    );

    expect(two?.name).toBe("NVIDIA GeForce RTX 4090");
    expect(two?.memoryBytes).toBe(24564 * 1024 * 1024);
  });

  it("skips a card that names no memory rather than reporting none", () => {
    // An X server holding the driver but not the card. The row parses as a
    // card, so taking it would report a GPU with no memory — which downstream
    // reads as "nothing fits", the wrong answer in the direction that hides a
    // working machine.
    expect(parseNvidiaRow("NVIDIA GeForce RTX 4090, 0, 0")).toBeNull();
    expect(parseNvidiaRow("NVIDIA GeForce RTX 4090, [N/A], [N/A]")).toBeNull();
  });

  it("finds no card in empty output", () => {
    expect(parseNvidiaRow("")).toBeNull();
    expect(parseNvidiaRow("\n\n")).toBeNull();
  });
});

describe("the sections of a rocm-smi answer", () => {
  // The shape documented for `--showproductname --showmeminfo vram`. Written
  // against the documentation rather than a captured answer, which the parser's
  // own header says; the leniency below is what buys that.
  const ROCM = [
    "device,name",
    "card0,AMD Radeon RX 7900 XTX",
    "device,memory total (B),memory used (B)",
    "card0,25753026560,1234567890",
  ].join("\n");

  it("names the card from the card row rather than from a heading", () => {
    // The heading "device,name" is not a name, and reading it as one would put
    // the word "device" in the Settings section.
    expect(parseRocmRows(ROCM)?.name).toBe("AMD Radeon RX 7900 XTX");
    expect(parseRocmRows(ROCM)?.kind).toBe("amd");
  });

  it("takes memory total as the bytes it already is", () => {
    // Unlike NVIDIA's MiB, this section reports bytes, and the header says so.
    expect(parseRocmRows(ROCM)?.memoryBytes).toBe(25753026560);
  });

  it("still names a card whose memory section is missing", () => {
    // Better a card with no memory figure than nothing at all — the name is
    // what lets the bandwidth table say anything, and the memory answer comes
    // from the machine's RAM instead.
    const partial = ["device,name", "card0,AMD Radeon RX 7900 XTX"].join("\n");

    expect(parseRocmRows(partial)?.name).toBe("AMD Radeon RX 7900 XTX");
    expect(parseRocmRows(partial)?.memoryBytes).toBeNull();
  });

  it("finds no card in output it does not recognise", () => {
    expect(parseRocmRows("")).toBeNull();
    expect(parseRocmRows("something else entirely")).toBeNull();
  });
});