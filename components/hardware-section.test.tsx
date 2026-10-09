// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { HardwareSection } from "./hardware-section";

/**
 * The Hardware section, as a reader sees it.
 *
 * The behaviour worth testing is not the layout but the **refusals**: what the
 * section says when the machine cannot be read, when the Models run on another
 * machine, and when nothing on Hugging Face clears the speed asked for. Each is
 * a place where a plausible-looking alternative — an empty panel, a zero, "no
 * Models available" — would tell a reader something false.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A machine as `/api/hardware` answers for an M4. */
const THIS_MACHINE = {
  platform: "darwin",
  cpu: "Apple M4",
  cores: 10,
  memoryBytes: 16 * 1024 ** 3,
  accelerator: { name: "Apple M4", kind: "apple", memoryBytes: null, cores: 8 },
};

/** Answers the two routes from whatever the test wants them to say. */
function stubRoutes({ hardware = THIS_MACHINE, recommendations }: {
  hardware?: unknown;
  recommendations: Record<string, unknown>;
}) {
  // The two facts every recommendations answer carries, so a test only has to
  // say what it is actually about. `bandwidthBytesPerSecond` here is an M4 at
  // 120 GB/s and 80% achievable.
  const answer = {
    bandwidthBytesPerSecond: Math.round(120 * 0.8 * 1024 ** 3),
    memoryBytes: 16 * 1024 ** 3,
    ...recommendations,
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes("/api/recommendations") ? answer : hardware;
      const ok = (body as { ok?: boolean }).ok ?? true;
      return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
    }),
  );
}

const aRecommendation = {
  repo: "Qwen/Qwen3-8B-GGUF",
  url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF",
  downloads: 2_000_000,
  quant: "Q4_K_M",
  bytes: 5_030_000_000,
  tokensPerSecond: 160,
};

describe("the Hardware section on a machine it could read", () => {
  it("names the chip before it names anything else", async () => {
    // The accelerator decides everything the section goes on to say, so it
    // leads; the CPU only appears where there is no accelerator to report.
    stubRoutes({
      recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [aRecommendation] },
    });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText(/Apple M4/)).toBeTruthy());
    expect(screen.getByText(/8 GPU cores/)).toBeTruthy();
  });

  it("says the speeds are estimates, before any of them is shown", async () => {
    // Stated once, up front, rather than in a tooltip. A reader about to act on
    // "160 tokens a second" should already have been told nobody measured it.
    stubRoutes({ recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [] } });
    render(<HardwareSection />);

    expect(screen.getByText(/not measured on it/i)).toBeTruthy();
  });

  it("says the ranking is popularity rather than quality", async () => {
    // The honest note about the one signal the list is sorted on. A reader who
    // takes downloads as merit would otherwise be misled by the ordering.
    stubRoutes({ recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [] } });
    render(<HardwareSection />);

    expect(screen.getByText(/popularity rather than quality/i)).toBeTruthy();
  });

  it("starts the slider at fifty, which is what was asked for", async () => {
    stubRoutes({ recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [] } });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText("50 tok/s")).toBeTruthy());
  });

  it("says what the slider is asking for, in words", async () => {
    // The number alone reads as a preference. Fifty tokens a second is a
    // requirement — nothing below it is offered at all — and that is the
    // difference between an empty list being a bug and it being the answer.
    stubRoutes({ recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [] } });
    render(<HardwareSection />);

    expect(screen.getByText(/feels immediate/i)).toBeTruthy();
  });
});

describe("the Hardware section showing a recommendation", () => {
  it("links to the repository page, opening elsewhere", async () => {
    // The page carries the download button and lists the other quantisations,
    // so a reader wanting a different size can find it without returning here.
    // The app downloads nothing itself — this is advice, not an installer.
    stubRoutes({
      recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [aRecommendation] },
    });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText("Qwen/Qwen3-8B-GGUF")).toBeTruthy());

    const link = screen.getByText("Qwen/Qwen3-8B-GGUF").closest("a");

    expect(link?.getAttribute("href")).toBe("https://huggingface.co/Qwen/Qwen3-8B-GGUF");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
  });

  it("shows the quantisation and its size, since that is what is downloaded", async () => {
    // The size and the speed are different quantities, and the quantisation is
    // what picks between eight files of different sizes in the same repository.
    stubRoutes({
      recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [aRecommendation] },
    });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText(/Q4_K_M/)).toBeTruthy());
    expect(screen.getByText(/4\.7 GB/)).toBeTruthy();
    expect(screen.getByText(/160 tok\/s/)).toBeTruthy();
  });
});

describe("the Hardware section when the Models run on another machine", () => {
  it("says so, and does not show fits", async () => {
    // The refusal that matters. Everything shown is computed from the chips of
    // whatever machine serves the app, so offering fits when the Models run
    // elsewhere would be answering confidently about the wrong computer.
    stubRoutes({
      recommendations: {
        applies: false,
        reason: "Your Model server is at 192.168.1.50, which is not this machine.",
        minTokensPerSecond: 50,
        // Sent even on the refusal, so one shape covers both answers and the
        // client parses it once rather than two.
        recommendations: [],
      },
    });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText(/192\.168\.1\.50/)).toBeTruthy());
    expect(screen.getByText(/describe the machine this app runs on/i)).toBeTruthy();
  });

  it("still says what machine it did read, because that part is true", async () => {
    // The specs are accurate whatever the placement; only the fits are not.
    stubRoutes({
      recommendations: { applies: false, reason: "Elsewhere.", minTokensPerSecond: 50, recommendations: [] },
    });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText(/Apple M4/)).toBeTruthy());
  });
});

describe("the Hardware section when nothing qualifies", () => {
  it("says nothing clears that speed, and points at the slider", async () => {
    // An empty list is a real answer — at 50 tokens a second on some hardware
    // only sub-2B Models qualify — and it is a different answer from an error.
    // Without the hint, a reader would think the app had nothing to suggest.
    stubRoutes({ recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [] } });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText(/Lower the slider/i)).toBeTruthy());
  });

  it("does not present the absence as a failure", async () => {
    stubRoutes({ recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [] } });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText(/Nothing on Hugging Face/i)).toBeTruthy());
    expect(screen.queryByText(/could not/i)).toBeNull();
  });
});

describe("the Hardware section on a machine it could not read", () => {
  it("says so rather than showing an empty row", async () => {
    // A blank beside "Hardware" is indistinguishable from a machine with no GPU,
    // and one of those is a fault worth knowing about.
    stubRoutes({
      hardware: { ok: false },
      recommendations: { applies: true, minTokensPerSecond: 50, recommendations: [] },
    });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText(/could not read this machine/i)).toBeTruthy());
  });
});

describe("the Hardware section on a chip it has no figure for", () => {
  it("says the app cannot estimate, rather than that nothing fits", async () => {
    // "This machine cannot" and "this app cannot tell" ask different things of
    // the reader, and conflating them would report a working GPU as useless.
    stubRoutes({
      recommendations: {
        applies: true,
        reason: "No memory bandwidth figure for this machine's chip, so speeds cannot be estimated.",
        minTokensPerSecond: 50,
        bandwidthBytesPerSecond: null,
        recommendations: [],
      },
    });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText(/cannot be estimated/i)).toBeTruthy());
  });
});