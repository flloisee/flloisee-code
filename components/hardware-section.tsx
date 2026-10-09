"use client";

import { useCallback, useEffect, useState } from "react";

import { describeMachine, requestHardware, type HardwareAnswer } from "@/lib/hardware/hardware-request";
import {
  requestRecommendations,
  type Recommendation,
  type RecommendationAnswer,
} from "@/lib/hardware/recommend-request";

/**
 * What this machine is, and what would run on it.
 *
 * The section answers a question the reader cannot otherwise answer: not which
 * Model is loaded, but which of the Models on Hugging Face would run well here.
 * That is why it takes no Endpoint — a reader asking what they could use is not
 * yet using anything, and the answer should not depend on which one the composer
 * happens to be pointed at.
 *
 * The speed is a **slider rather than a constant**, and that is the design
 * decision the whole section rests on. At 50 tokens a second on an M4 only
 * sub-2B Models qualify; at 20, a 4B does. A fixed threshold would silently
 * answer a question the reader did not ask, and on weaker hardware would answer
 * it with nothing at all. A slider shows the trade-off instead of picking a point
 * on it.
 *
 * The one request here that leaves the machine — the Hub — is made only when the
 * reader moves the slider, never on open, because a reader who came here to
 * change the Theme should not have caused a call to a third party.
 */

/** Where the slider starts, and the value the reader asked for. */
const DEFAULT_TOKENS_PER_SECOND = 50;

/** The slowest and fastest worth offering; below and above these nothing changes. */
const SLOWEST = 5;
const FASTEST = 200;

/** How long to wait after the slider settles before asking, so a drag is one request. */
const SETTLE_MS = 400;

export function HardwareSection() {
  const [machine, setMachine] = useState<HardwareAnswer | null>(null);
  const [wanted, setWanted] = useState(DEFAULT_TOKENS_PER_SECOND);
  const [answer, setAnswer] = useState<RecommendationAnswer | null>(null);
  const [asking, setAsking] = useState(false);

  // The machine is local and fast, so it is read on open rather than asked for.
  // `system_profiler` is seconds on a loaded machine, which is why this shows
  // "Reading..." rather than pretending to know nothing yet.
  useEffect(() => {
    let current = true;
    void requestHardware().then((found) => {
      if (current) setMachine(found);
    });
    return () => {
      current = false;
    };
  }, []);

  const ask = useCallback((minTokensPerSecond: number) => {
    setAsking(true);
    void requestRecommendations(minTokensPerSecond)
      .then(setAnswer)
      .finally(() => setAsking(false));
  }, []);

  // Asked on mount as well as on change, because a section that says nothing
  // until something happens is a section a reader has to discover. The mount
  // case is the reader asking to see recommendations at all.
  //
  // Debounced because the control is a slider: without the settle, dragging it
  // across its range is a dozen requests to a third party for an answer the
  // reader was not going to stop on.
  useEffect(() => {
    const timer = setTimeout(() => ask(wanted), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [wanted, ask]);

  return (
    <section aria-labelledby="hardware-heading" className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span id="hardware-heading" className="hm-label w-16 shrink-0">
          Hardware
        </span>
        <p className="flex-1 font-mono text-sm text-ink-2" role="status">
          {machine === null ? "Reading this machine..." : describeMachineOrReason(machine)}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="hm-label w-16 shrink-0" htmlFor="speed-fit">
          Speed fit
        </label>

        <input
          id="speed-fit"
          type="range"
          min={SLOWEST}
          max={FASTEST}
          step={5}
          value={wanted}
          // Not a controlled-throttled request: the label updates immediately
          // so the control feels connected to the finger, while the request
          // waits for the drag to settle.
          onChange={(event) => setWanted(Number(event.target.value))}
          aria-describedby="speed-fit-message"
          className="flex-1"
        />

        <span className="w-20 shrink-0 text-right font-mono text-xs text-ink-2">
          {wanted} tok/s
        </span>
      </div>

      <p id="speed-fit-message" className="hm-status">
        {sliderMeaning(wanted)}
      </p>

      {answer !== null && <AnswerList answer={answer} asking={asking} />}

      <p className="hm-status">
        Speeds are estimated from this machine&apos;s memory bandwidth, not measured on it. Rankings
        come from Hugging Face downloads, which is popularity rather than quality.
      </p>
    </section>
  );
}

/**
 * What the slider is asking for, in the reader's terms.
 *
 * Said in words because the number alone does not convey that it is a
 * requirement being placed on the answer. Fifty tokens a second reads as a
 * preference until you know nothing below it is offered at all.
 */
function sliderMeaning(tokensPerSecond: number): string {
  if (tokensPerSecond >= 100) return "Very fast. Only small Models will qualify.";
  if (tokensPerSecond >= 50) return "Quick enough that a Response feels immediate.";
  if (tokensPerSecond >= 20) return "Readable, with a pause before each answer.";
  return "Slow. Expect to wait, and expect fewer Models to qualify.";
}

/**
 * The machine, or the reason there is not one to describe.
 *
 * "No accelerator found" is shown rather than hidden. A reader who cannot tell
 * "this machine has no GPU" from "the probe failed" has been told nothing, and
 * the second is likelier on a machine whose tools answered nothing.
 */
function describeMachineOrReason(answer: HardwareAnswer): string {
  if (answer.status === "unavailable") return `Could not read this machine — ${answer.message}`;

  const described = describeMachine(answer.spec);
  if (described.length > 0) return described;

  return "No chip details found on this machine";
}

/** The answer, in whichever of its shapes arrived. */
function AnswerList({ answer, asking }: { answer: RecommendationAnswer; asking: boolean }) {
  if ("status" in answer) {
    return (
      <p className="ml-16 text-xs text-muted" role="status">
        {answer.message}
      </p>
    );
  }

  if (!answer.applies) {
    // The refusal. Said plainly rather than as an empty list, because an empty
    // list here would read as "nothing suits this machine" — the opposite of
    // the truth, which is that the machine was never the right one to ask about.
    return (
      <p className="ml-16 text-xs text-muted" role="status">
        {answer.reason} These specs describe the machine this app runs on, so no fits are shown.
      </p>
    );
  }

  if (answer.reason !== null) {
    return (
      <p className="ml-16 text-xs text-muted" role="status">
        {answer.reason}
      </p>
    );
  }

  if (answer.recommendations.length === 0) {
    // The ceiling is what makes this answer explicable rather than merely
    // empty. On an M4 at 50 tokens a second it is under 2 GB, which is why only
    // very small Models appear there — and a reader told the speed they chose
    // and the consequence of it can decide whether to move the slider.
    const ceiling =
      answer.largestModelBytes === null
        ? null
        : ` At that speed a Model has to be under ${gib(answer.largestModelBytes)}.`;

    return (
      <p className="ml-16 text-xs text-muted" role="status">
        {asking
          ? "Looking..."
          : `Nothing on Hugging Face clears ${answer.minTokensPerSecond} tokens a second on this machine.${ceiling ?? ""} Lower the slider to see more.`}
      </p>
    );
  }

  return (
    <ul className="ml-16 flex flex-col gap-1.5" role="list">
      {answer.recommendations.map((item) => (
        <RecommendationRow key={item.repo} item={item} />
      ))}
    </ul>
  );
}

/**
 * One Model, and where to get it.
 *
 * The speed comes first and is the most useful number here. The quantisation and
 * its size are beside it because those are what the reader actually downloads,
 * and the two are not the same thing — the same Model has eight of each, and
 * picking the wrong one costs gigabytes.
 *
 * The link goes to the repository page rather than to a file, because the page is
 * where the download button is and where the other quantisations are listed, so
 * a reader who wants a smaller or larger one can find it without coming back
 * here. Nothing is downloaded by the app: this is advice, not an installer.
 */
function RecommendationRow({ item }: { item: Recommendation }) {
  return (
    <li className="flex items-baseline gap-3 border-l-2 border-rule pl-3">
      <span className="w-16 shrink-0 font-mono text-xs text-accent">
        {Math.round(item.tokensPerSecond)} tok/s
      </span>

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-xs text-ink underline decoration-rule underline-offset-2"
      >
        {item.repo}
      </a>

      <span className="shrink-0 font-mono text-xs text-muted">
        {gib(item.bytes)} {item.quant}
      </span>
    </li>
  );
}

/** Bytes as the reader would say them. */
function gib(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? `${Math.round(value)} GB` : `${value.toFixed(1)} GB`;
}