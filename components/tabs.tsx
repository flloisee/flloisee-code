"use client";

import { useId, useRef, type ReactNode } from "react";

/**
 * A strip of tabs over a single panel: several things one dialog holds, of which
 * one is showing at a time.
 *
 * The dialog is the reason this is here. A Settings panel holding six controls
 * in a column is a column a reader scrolls past to reach the one they came for,
 * and the reason each of those controls sits where it does is a reason about
 * order — this one is per-machine, that one is set once. Tabs take the ordering
 * out of the reader's way: what is there is what is offered, in one line, and
 * the panel below holds whichever of them they are actually after.
 *
 * Two decisions are the whole of the component, and both are about what mounting
 * a panel costs rather than about how a tab looks.
 *
 * **Only the showing panel is rendered.** A tab nobody has visited has never
 * mounted, so nothing behind it has been asked for: not the Registry, not the
 * Reading Root, not the machine, not Hugging Face. A reader who opens this to
 * change the Theme gets the Theme and no request to a third party — which is the
 * promise `hardware-section.tsx` already makes about its own request and could
 * not keep while the section sat mounted under three others. It also means a
 * panel is asked afresh every time it comes back, so a Credential stored a
 * moment ago is on screen the moment the reader looks for it rather than on the
 * next reload.
 *
 * **The arrows move focus rather than choose.** Activation is on Enter, which is
 * the manual pattern in the ARIA tabs practice — automatic activation would mount
 * each panel as the focus crosses it, which with the rule above means arrowing
 * past a panel that reaches a third party would make its request on the way to a
 * tab the reader may never have wanted. Focus landing somewhere inert is a far
 * smaller cost than a request to a third party made by a keypress the reader
 * thought was only navigation.
 *
 * One deliberate departure from that pattern: the roving `tabIndex` stays on the
 * *selected* tab rather than following focus. The practice moves it with focus so
 * that tabbing away and back returns the reader to the tab they last looked at;
 * here it returns them to the tab they last chose, which is the one whose panel
 * is actually on screen and the one `Tab` then walks into. A reader who arrows
 * along the strip and then tabs away without pressing Enter has changed nothing,
 * which is the right account of what they did.
 *
 * The strip wears the same marks as the fit tabs in `hardware-section.tsx` — the
 * mono label, the two-pixel underline on the chosen one — so a reader who has
 * used those knows this one. They are written out rather than shared for now;
 * the two collapsing into one utility is a change to make when that section's
 * tabs are given panels of their own, not a reason to leave this one looking
 * like a different control.
 */

export type TabSpec = {
  /** What the tab is called. Short, because the strip holds them all on a line. */
  label: string;
  /** What it holds. Built here, rendered only while this tab is the one showing. */
  panel: ReactNode;
};

export type TabsProps = {
  /** The tabs, in the order they are offered. */
  tabs: readonly TabSpec[];
  /**
   * Which one is showing.
   *
   * Held by the dialog rather than by this component, so that it survives the
   * dialog swapping itself for a question and back: the reader who confirms
   * something destructive and comes back should land where they left off, and
   * state declared inside a component that unmounts for the question would be
   * gone by the time it returned.
   */
  selected: number;
  /** Called with the index chosen, whether by pointer or by Enter on a focused tab. */
  onSelect: (index: number) => void;
  /** Names the strip. The dialog's own heading, rather than a second name invented for it. */
  labelledBy: string;
  /** Where the whole thing sits in the dialog. */
  className?: string;
  /**
   * Whether the panel takes the room a fixed-height dialog has left, and scrolls
   * what does not fit in it.
   *
   * A dialog whose height is steady — so that moving between panels of different
   * lengths does not move its top edge — is a flex column, and something inside
   * it has to be the part that gives way. That part is the panel: the heading and
   * the strip stay exactly where the reader last saw them, and a table of Models
   * too long for the box scrolls under the strip rather than out of the dialog.
   *
   * Off by default, because a dialog that fits its content has nothing to give
   * way and would only be made to scroll by this.
   */
  grows?: boolean;
};

export function Tabs({ tabs, selected, onSelect, labelledBy, className, grows }: TabsProps) {
  // Two things with similar names, and the difference is what each is for: `id`
  // is the prefix every element in here is named from, `strip` is the element
  // the focus lookup happens against.
  const id = useId();
  const strip = useRef<HTMLDivElement>(null);

  return (
    <div className={`${className ?? ""} ${grows ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      <div
        ref={strip}
        role="tablist"
        aria-labelledby={labelledBy}
        className="flex flex-wrap gap-x-4 gap-y-1"
      >
        {tabs.map((tab, index) => {
          const chosen = index === selected;

          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              id={tabId(id, index)}
              aria-selected={chosen}
              aria-controls={panelId(id, index)}
              // One tab in the tab order rather than five. The strip is walked
              // with the arrows, so tabbing into it and then tabbing straight on
              // out is the whole journey for a reader who is passing through to
              // the panel below.
              tabIndex={chosen ? 0 : -1}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => {
                const to = whereKey(event.key, index, tabs.length);
                if (to === null) return;
                // Only the movement is taken here. Choosing is the click, which
                // Enter and Space already produce on a button — so a hand on the
                // arrows never mounts a panel.
                event.preventDefault();
                // By role rather than by index into children, so the strip stays
                // readable if anything else is ever put inside it.
                strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
              }}
              className={`hm-label cursor-pointer pb-1 ${
                chosen ? "border-b-2 border-ink text-ink" : "border-b-2 border-transparent"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId(id, selected)}
        aria-labelledby={tabId(id, selected)}
        // Focusable so that tabbing out of the strip has somewhere to land. Most
        // of these panels hold a control already, but not all of them always do:
        // the Endpoint one is disabled while the Registry is being read, and the
        // Saved one holds nothing but a button that is disabled when there is
        // nothing saved. A panel that can be empty of focusables is a panel
        // Escape-and-Tab walks straight out of.
        tabIndex={0}
        // `min-h-0` alongside the flex grow, and it is the whole of it: a flex
        // item defaults to `min-height: auto`, so the panel would refuse to shrink
        // below its content and push the dialog's own box out through the bottom
        // instead of scrolling inside it. `hm-scroll` reserves the gutter for the
        // bar that appears only on the panels long enough to need one.
        className={`mt-4 ${grows ? "hm-scroll min-h-0 flex-1 overflow-y-auto" : ""}`}
      >
        {tabs[selected].panel}
      </div>
    </div>
  );
}

/**
 * Which tab a key moves to, or `null` when the key does not move at all.
 *
 * Wrapping, because a strip this short is a thing to land on rather than a list
 * to fall off the end of — and because a reader who has not counted five tabs
 * should not have to count them to find out which way round they are.
 */
function whereKey(key: string, from: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (from + 1) % count;
    case "ArrowLeft":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** One tab's id, from one place. */
function tabId(strip: string, index: number): string {
  return `${strip}-tab-${index}`;
}

/** One panel's id, from one place — the other half of what `aria-controls` names. */
function panelId(strip: string, index: number): string {
  return `${strip}-panel-${index}`;
}