// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "@/components/markdown";

/**
 * Copying a snippet out of a Conversation is the reason a Response renders code
 * as a code block rather than as prose, so it is checked against a real DOM
 * rather than assumed from the markup.
 */

const render_ = (markdown: string) => render(createElement(Markdown, null, markdown));
const clickCopy = () => fireEvent.click(screen.getByRole("button", { name: /copy/i }));

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  // jsdom exposes `clipboard` as a getter, so it has to be redefined outright.
  // `fireEvent` is used rather than `user-event`, which installs a clipboard
  // stub of its own and would hide what this component actually called.
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

// Vitest runs with `globals: false`, so testing-library does not self-clean.
afterEach(cleanup);

describe("copying a snippet out of a Conversation", () => {
  it("puts the code, and nothing else, on the clipboard", () => {
    const code = "export const answer = 42;";
    render_(`\`\`\`ts\n${code}\n\`\`\``);

    clickCopy();

    expect(writeText).toHaveBeenCalledWith(code);
  });

  it("confirms the copy so the reader knows it worked", async () => {
    render_("```sh\nollama pull llama3.2\n```");

    clickCopy();

    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("stays usable when the clipboard is refused", () => {
    writeText.mockRejectedValue(new Error("denied"));
    render_("```sh\nollama pull llama3.2\n```");

    clickCopy();

    // No crash and no false confirmation; the button is still there to retry.
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeTruthy();
  });

  it("copies a partially-streamed block, before its closing fence arrives", () => {
    render_("```ts\nconst partial = ");

    clickCopy();

    expect(writeText).toHaveBeenCalledWith("const partial = ");
  });
});

describe("a long line in a Response", () => {
  it("scrolls inside the code block rather than widening the Turn", () => {
    const { container } = render_("```\n" + "x".repeat(400) + "\n```");

    const pre = container.querySelector("pre");
    expect(pre?.className).toContain("overflow-x-auto");
  });

  it("breaks a long unbroken table inside its own scroll region", () => {
    const { container } = render_("| a | b |\n| - | - |\n| " + "x".repeat(300) + " | y |");

    expect(container.querySelector("table")?.closest("div")?.className).toContain(
      "overflow-x-auto",
    );
  });
});