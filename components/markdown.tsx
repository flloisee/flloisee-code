"use client";

import { createContext, useContext, useState, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a Response as formatted text rather than a wall of unstyled characters.
 *
 * A Response is untrusted input. Point this app at a third-party Endpoint and
 * whatever that Endpoint — or anyone who can influence what the Model emits —
 * reaches this component as text. So it is treated as text throughout:
 *
 * - Raw HTML in the markdown is never turned into elements. `rehype-raw` is
 *   deliberately absent; without it an HTML block renders as literal characters.
 * - Every URL is checked against an allowlist before it can become an `href`.
 * - Images are not rendered at all. Loading a remote image would tell a third
 *   party what the reader asked a model, and `data:` images are a known way to
 *   smuggle script past a text-only policy.
 */

/** Schemes a Response may link to. Anything else renders as inert text. */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Returns the URL if it is safe to link to, or `undefined` if it is not.
 *
 * The scheme is decided by the URL parser rather than a prefix check, because a
 * prefix check is what the usual bypasses are written against: leading
 * whitespace, mixed case, and the control characters a browser strips before
 * acting on a scheme all resolve to the same parsed protocol here. A URL the
 * parser rejects has no scheme, and a scheme-less URL in a Response means a
 * link back into this app rather than anywhere the reader intends to go.
 */
function safeHref(href: unknown): string | undefined {
  if (typeof href !== "string") return undefined;

  const value = href.trim();
  if (value === "") return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  return ALLOWED_SCHEMES.has(parsed.protocol) ? parsed.href : undefined;
}

/** `react-markdown` asks about every URL it meets; a rejected one gets no href. */
function urlTransform(url: string): string {
  return safeHref(url) ?? "";
}

/**
 * Flattens rendered children back to their text.
 *
 * Walks whatever structure it is handed rather than assuming a shape, because
 * a partially-streamed code block can reach this with children that are not yet
 * the array of strings a finished one would be. Anything it does not recognise
 * contributes nothing rather than throwing.
 */
function toPlainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toPlainText).join("");
  if (isValidElement(node)) return toPlainText((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * A `code` element cannot tell from its own props whether it sits inside a
 * fence — an unlabelled fence and inline code look identical to it. The
 * enclosing `pre` says so instead.
 */
const InsideCodeBlock = createContext(false);

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      disabled={code === ""}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(code)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => setCopied(false));
      }}
      className={`hm-btn hm-btn--quiet hm-btn--sm absolute right-2 top-2 font-mono transition-opacity ${
        code === "" ? "opacity-0" : "opacity-70 hover:opacity-100"
      }`}
    >
      {/* Silent success: the label swaps to "Copied" and reverts on its own.
          No toast — the reader is already looking at the button they pressed. */}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

type ElementProps = { children?: ReactNode; className?: string; href?: string; alt?: string };

const components: Components = {
  a: ({ children, href }: ElementProps) => {
    const safe = safeHref(href);

    // An unusable URL still shows its text — a Response stays readable even
    // where it cannot be made safe to click.
    if (safe === undefined) {
      return <span className="underline decoration-dotted underline-offset-2">{children}</span>;
    }

    return (
      <a
        href={safe}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-accent underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
      >
        {children}
      </a>
    );
  },

  // Deliberately absent: images. See the note at the top of this file.
  img: ({ alt }: ElementProps) => <span className="text-muted">{alt || "image"}</span>,

  pre: ({ children }: ElementProps) => (
    <InsideCodeBlock.Provider value={true}>
      <div className="group relative my-3">
        {/* The code scrolls inside its own box instead of widening the Turn,
            which is what keeps a long line usable in a narrow window.
            A tinted surface with a hairline, rather than a dark card: inside a
            Conversation a code block has to sit under a light-mode and a
            dark-mode surface without either one swallowing it. */}
        <pre className="overflow-x-auto rounded-control border border-rule bg-paper-3 p-3 font-mono text-[0.8rem] leading-relaxed text-ink-2">
          {children}
        </pre>
        <CopyButton code={toPlainText(children).replace(/\n$/, "")} />
      </div>
    </InsideCodeBlock.Provider>
  ),

  code: function Code({ children, className }: ElementProps) {
    if (useContext(InsideCodeBlock)) {
      return <code className={`font-mono ${className ?? ""}`}>{children}</code>;
    }

    return (
      <code className="rounded bg-paper-3 px-1 py-0.5 font-mono text-[0.9em] text-ink">
        {children}
      </code>
    );
  },

  // Headings inside a Response step down from the app's own display scale —
  // a Response is quoted material, not the page's own voice, so it should not
  // compete with the app chrome around it.
  h1: ({ children }: ElementProps) => (
    <h1 className="mt-4 mb-2 font-display text-md font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }: ElementProps) => (
    <h2 className="mt-4 mb-2 font-display text-base font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }: ElementProps) => (
    <h3 className="mt-4 mb-1.5 font-display text-sm font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }: ElementProps) => (
    <h4 className="mt-4 mb-1.5 font-display text-sm font-semibold text-ink first:mt-0">{children}</h4>
  ),
  h5: ({ children }: ElementProps) => <h5 className="mt-3 mb-1 font-semibold">{children}</h5>,
  h6: ({ children }: ElementProps) => <h6 className="mt-3 mb-1 font-semibold">{children}</h6>,

  p: ({ children }: ElementProps) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,

  ul: ({ children }: ElementProps) => <ul className="my-2 list-disc pl-5 first:mt-0">{children}</ul>,
  ol: ({ children }: ElementProps) => <ol className="my-2 list-decimal pl-5 first:mt-0">{children}</ol>,
  li: ({ children }: ElementProps) => <li className="my-1 pl-1">{children}</li>,

  blockquote: ({ children }: ElementProps) => (
    <blockquote className="my-3 border-l-2 border-rule-2 pl-3 text-muted">{children}</blockquote>
  ),

  hr: () => <hr className="my-4 border-rule" />,

  // Markdown tables are common in model output; they scroll rather than stretch.
  table: ({ children }: ElementProps) => (
    <div className="my-3 overflow-x-auto rounded-control border border-rule">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }: ElementProps) => (
    <th className="border-b border-rule bg-paper-3 px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }: ElementProps) => (
    <td className="border-b border-rule-2 px-3 py-2 align-top">{children}</td>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={urlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
