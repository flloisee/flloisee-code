/**
 * What every glyph in this app is drawn with, and the one place it is said.
 *
 * Drawn here rather than pulled from an icon library, and the reasoning is set
 * out in full at the top of `theme-toggle.tsx`: an icon set is a whole
 * dependency and a whole voice, and this app has a handful of glyphs, so a
 * library would arrive to draw them and impose a stroke weight on a design
 * system that has only just defined its own. That answer holds for a pencil and
 * a bin as much as it did for the first glyph.
 *
 * What this file adds to it is that there is more than one glyph. Sharing the
 * box, the weight, the caps and the colour source is what makes drawings written
 * in different files read as one hand rather than as one hand per file; the
 * alternative is a copy of this object in each, and a glyph drawn from the wrong
 * copy is the wrong size and the wrong weight beside the words it sits with.
 *
 * `currentColor` so a glyph inherits the control's colour, and follows the Theme
 * — and a destructive control's red — without a second set of values to keep in
 * step.
 *
 * `aria-hidden` because the control's accessible name already says what the
 * glyph is for, and a screen reader that read both would say everything twice.
 *
 * Size in `em`, so a glyph tracks the font-size of the button it is in rather
 * than being pinned to a pixel value that would drift the moment the type scale
 * moved. `display: block`, so the drawing is centred by the button's flex rather
 * than sitting on a text baseline with the descender gap inline SVG carries.
 * Those two were `.hm-btn--icon > svg` in `globals.css` and moved here when a
 * glyph turned up beside a word rather than alone in an icon button.
 */
export const STROKE = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  width: "1.125em",
  height: "1.125em",
  display: "block",
  "aria-hidden": true,
  focusable: false,
} as const;