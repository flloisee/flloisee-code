// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes("/api/recommendations") ? answer : hardware;
    const ok = (body as { ok?: boolean }).ok ?? true;
    return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

/** The bodies this section sent to the recommendations route, in order. */
function asked(mock: { mock: { calls: unknown[][] } }): { minTokensPerSecond: number; rank: string }[] {
  return mock.mock.calls
    .map((call) => [String(call[0]), call[1] as RequestInit | undefined] as const)
    .filter(([url]) => url.includes("/api/recommendations"))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

/** The tab for a fit, found by what it is called rather than by a class. */
const tab = (name: string) => screen.getByRole("tab", { name });

const aRecommendation = {
  repo: "Qwen/Qwen3-8B-GGUF",
  url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF",
  downloads: 2_000_000,
  quant: "Q4_K_M",
  bytes: 5_030_000_000,
  parameters: 8_300_000_000,
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

describe("the two fits, chosen by the reader", () => {
  const answered = { applies: true, minTokensPerSecond: 50, recommendations: [aRecommendation] };

  it("opens on the Speed fit, and says which one that is", async () => {
    // Not decoration. A reader who cannot tell which ordering they are looking
    // at has been shown a list whose whole point is invisible.
    stubRoutes({ recommendations: answered });
    render(<HardwareSection />);

    await waitFor(() => expect(tab("Speed fit").getAttribute("aria-selected")).toBe("true"));
    expect(tab("Intelligence fit").getAttribute("aria-selected")).toBe("false");
  });

  it("asks again by intelligence when that tab is chosen", async () => {
    // The whole point: the two fits are different questions, and one of them is
    // not the same list in another order. The route has to be told which was asked.
    const spy = stubRoutes({ recommendations: answered });
    render(<HardwareSection />);

    await waitFor(() => expect(asked(spy)).toHaveLength(1));
    expect(asked(spy)[0].rank).toBe("speed");

    fireEvent.click(tab("Intelligence fit"));

    await waitFor(() => expect(asked(spy)).toHaveLength(2));
    expect(asked(spy)[1].rank).toBe("intelligence");
  });

  it("keeps the speed the reader chose when the fit changes", async () => {
    // The slider is shared on purpose. "Intelligence over speed" is not a second
    // budget — it is the same ceiling, ordered differently, and a reader who set
    // 20 tokens a second did not agree to 50 when they clicked a tab.
    const spy = stubRoutes({ recommendations: answered });
    render(<HardwareSection />);

    await waitFor(() => expect(asked(spy)).toHaveLength(1));
    fireEvent.click(tab("Intelligence fit"));

    await waitFor(() => expect(asked(spy)).toHaveLength(2));
    expect(asked(spy)[1].minTokensPerSecond).toBe(50);
  });

  it("leads each row with whatever the fit is ordered by", async () => {
    // The left column is the figure that explains the row's position, so it is
    // the one the ordering uses. On this tab that is the parameter count.
    stubRoutes({ recommendations: answered });
    render(<HardwareSection />);

    await waitFor(() => expect(screen.getByText("160 tok/s")).toBeTruthy());

    fireEvent.click(tab("Intelligence fit"));

    await waitFor(() => expect(screen.getByText("8.3B")).toBeTruthy());
    expect(screen.queryByText("160 tok/s")).toBeNull();
  });

  it("keeps the pace beside a Model it recommends for being large", async () => {
    // The honesty this tab most easily loses. The most capable Model a machine can
    // hold may be far too slow to use, and dropping the number to make the tab
    // look better would be precisely the lie the note beneath it exists to
    // prevent.
    stubRoutes({ recommendations: answered });
    render(<HardwareSection />);

    fireEvent.click(tab("Intelligence fit"));

    await waitFor(() => expect(screen.getByText("8.3B")).toBeTruthy());
    expect(screen.getByText(/160 tok\/s/)).toBeTruthy();
  });

  it("takes the other list away rather than showing it under this tab's name", async () => {
    // A list ordered by pace, left on screen under "Intelligence fit" while the
    // new answer is still coming, is a list that is briefly wrong about what it
    // is — and the rows look identical either way, so nothing corrects it.
    let intelligence = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.includes("/api/recommendations")) {
          intelligence = JSON.parse(String(init?.body)).rank === "intelligence";

          // Never settles: this test is about the moment *before* the answer.
          if (intelligence) return await new Promise<Response>(() => {});

          return new Response(
            JSON.stringify({
              applies: true,
              minTokensPerSecond: 50,
              bandwidthBytesPerSecond: Math.round(120 * 0.8 * 1024 ** 3),
              memoryBytes: 16 * 1024 ** 3,
              recommendations: [aRecommendation],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify(THIS_MACHINE), { status: 200 });
      }),
    );

    render(<HardwareSection />);
    await waitFor(() => expect(screen.getByText("Qwen/Qwen3-8B-GGUF")).toBeTruthy());

    fireEvent.click(tab("Intelligence fit"));

    await waitFor(() => expect(screen.queryByText("Qwen/Qwen3-8B-GGUF")).toBeNull());
  });

  it("says what the ordering on this tab is, and what it is worth", async () => {
    // The Speed fit admits its ranking is popularity. This one has to admit its
    // ranking is a proxy for capability, because more parameters is usually
    // better and sometimes much less so — and a reader who does not know that
    // would take the top row as the best Model on the Hub.
    stubRoutes({ recommendations: answered });
    render(<HardwareSection />);

    expect(screen.getByText(/popularity rather than quality/i)).toBeTruthy();

    fireEvent.click(tab("Intelligence fit"));

    await waitFor(() =>
      expect(screen.getByText(/rough proxy for capability/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/popularity rather than quality/i)).toBeNull();
  });

  it("still says the speeds were never measured on this machine", async () => {
    // Said on both tabs, before either list is drawn. Switching fit does not
    // retire the caveat.
    stubRoutes({ recommendations: answered });
    render(<HardwareSection />);

    expect(screen.getByText(/not measured on it/i)).toBeTruthy();

    fireEvent.click(tab("Intelligence fit"));

    await waitFor(() => expect(screen.getAllByText(/not measured on it/i).length).toBe(1));
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