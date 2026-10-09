// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it } from "vitest";

import { Turn } from "@/components/chat";

/**
 * One Turn is one user message and the Response it produced. They are shown
 * differently on purpose: a Response is formatted by the Model, whereas what
 * the user typed is theirs to have shown back verbatim.
 */

afterEach(cleanup);

const message = (role: "user" | "assistant", text: string): UIMessage => ({
  id: "m1",
  role,
  parts: [{ type: "text", text }],
});

describe("a Turn in the Conversation", () => {
  it("shows a Response as formatted text", () => {
    const { container } = render(
      <Turn message={message("assistant", "## Plan\n\n- one\n- two\n\n**done**")} />,
    );

    expect(container.querySelector("h2")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("done");
  });

  it("shows what the user typed literally, without formatting it as a Response", () => {
    const { container } = render(<Turn message={message("user", "## not a heading")} />);

    expect(container.querySelector("h2")).toBeNull();
    expect(container.textContent).toContain("## not a heading");
  });

  it("keeps the user's own line breaks", () => {
    const { container } = render(<Turn message={message("user", "first\nsecond")} />);

    // Rendered as prose, a single newline is not a break; the user's own
    // spacing is preserved so what they typed is what they see.
    expect(container.querySelector("p")).toBeNull();
    expect(container.textContent).toContain("first\nsecond");
  });

  it("does not let a code block widen the Turn out of its container", () => {
    const { container } = render(
      <Turn message={message("assistant", "```\n" + "x".repeat(400) + "\n```")} />,
    );

    // `min-w-0` is what lets the code block's own scroll box take effect
    // inside the flex row rather than stretching it.
    const bubble = container.querySelector("pre")?.closest(".rounded-2xl");
    expect(bubble?.className).toContain("min-w-0");
  });
});