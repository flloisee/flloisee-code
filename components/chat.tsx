"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useState } from "react";

import { EndpointPicker } from "@/components/endpoint-picker";
import { ModelPicker } from "@/components/model-picker";
import { findEndpoint } from "@/lib/endpoints/registry";
import { rememberModel, selectedModel } from "@/lib/models/selection";

import { Markdown } from "./markdown";

export type ChatProps = {
  /** The Endpoint the Conversation opens on. The user can choose another. */
  endpointId: string;
};

/**
 * Renders one Turn as the user wrote it or as the model produced it.
 *
 * Message parts are rendered rather than plain strings so reasoning and tool
 * parts can appear later without reshaping this component.
 *
 * The two roles are shown differently on purpose. A Response is formatted text
 * the Model chose, so it is rendered as such. What the user typed is theirs to
 * have shown back verbatim, so it is left as written — including the single
 * newlines that a formatted rendering would otherwise swallow.
 */
export function Turn({ message }: { message: UIMessage }) {
  const fromUser = message.role === "user";

  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    // A Response can arrive as several parts; blank lines keep them from
    // merging into one paragraph when they are rendered together.
    .join("\n\n");

  return (
    <div className={`flex ${fromUser ? "justify-end" : "justify-start"}`}>
      {/* `min-w-0` lets a wide code block scroll inside its own box instead of
          stretching this flex child past the window. */}
      {/* The two surfaces are inverses of each other rather than two colours:
          the reader's own words sit on ink, the Model's on a raised paper. The
          pair flips together with the mode, so in dark mode the reader's Turn
          is the light one — the contrast is identical either way. */}
      {/* `data-turn` is a structural hook, not a styling one: it names which
          side of the Conversation a bubble belongs to so the tests can find the
          bubbles without having to know what colour or radius they are drawn
          with. Tests used to select on `.rounded-2xl`, which pinned the bubble
          radius to a test assertion. */}
      <div
        data-turn={fromUser ? "user" : "response"}
        className={`min-w-0 max-w-[85%] break-words rounded-panel px-4 py-3 ${
          fromUser
            ? "whitespace-pre-wrap bg-ink text-paper"
            : "border border-rule bg-paper-2 text-ink-2"
        }`}
      >
        {fromUser ? text : <Markdown>{text}</Markdown>}
      </div>
    </div>
  );
}

export function Chat({ endpointId: initialEndpointId }: ChatProps) {
  const [input, setInput] = useState("");
  // Keyed by Endpoint, so switching back to one restores the Model chosen there.
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [endpointId, setEndpointId] = useState(initialEndpointId);

  const endpoint = findEndpoint(endpointId);
  const modelId = selectedModel(selection, endpointId, endpoint?.defaultModelId ?? "");

  const { messages, sendMessage, status, stop, error, setMessages, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // Bound re-renders while a Response streams in, so reading stays smooth.
    throttle: 50,
  });

  const inProgress = status === "submitted" || status === "streaming";

  // Regenerating rewrites the last Response, so it needs one to exist and
  // nothing else in flight; otherwise two Responses would race for the same Turn.
  //
  // A failed Turn is the exception: the request produced no Response at all, so
  // the last message is still the user's own and there is nothing to rewrite.
  // Offering Regenerate there is what lets a transient failure be retried
  // without the message being typed a second time.
  const awaitingResponse = status === "error" && messages.at(-1)?.role === "user";
  const canRegenerate =
    !inProgress && (messages.at(-1)?.role === "assistant" || awaitingResponse);

  function startFreshConversation() {
    setMessages([]);
    stop();
  }

  function handleSubmit() {
    const text = input.trim();
    if (!text || inProgress) return;

    setInput("");
    void sendMessage({ text }, { body: { endpointId, modelId } });
  }

  function handleRegenerate() {
    if (!canRegenerate) return;
    // The request body is not remembered from the original send, so the Endpoint
    // and Model have to be named again or the Route Handler rejects the retry.
    void regenerate({ body: { endpointId, modelId } });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The chosen Endpoint and Model stay on screen above the Conversation, so
          it is always clear which one produced a Response. */}
      <div className="px-4 pt-3 sm:px-6">
        <EndpointPicker endpointId={endpointId} onSelect={setEndpointId} />

        <ModelPicker
          endpointId={endpointId}
          endpointName={endpoint?.name ?? endpointId}
          modelId={modelId}
          onSelect={(identifier) =>
            setSelection((current) => rememberModel(current, endpointId, identifier))
          }
        />
      </div>

      {/* `hm-scroll` reserves the scrollbar's gutter whether or not one is
          drawn, so the Turns do not slide sideways the moment the Theme
          changes — or the moment the first Turn makes this scrollable. */}
      <div className="hm-scroll flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && (
          <p className="mx-auto max-w-[52ch] text-center text-sm text-muted">
            Send a message to begin a Conversation with {endpoint?.name ?? endpointId}.
          </p>
        )}
        {messages.map((message) => (
          <Turn key={message.id} message={message} />
        ))}
      </div>

      {error && (
        <p role="alert" className="mx-4 mb-2 sm:mx-6">
          <span className="hm-status hm-status--error">{error.message}</span>
        </p>
      )}

      {/* The composer wraps rather than shrinking: at a narrow width the field
          takes its own full-width row and the controls sit beneath it, so no
          button label is ever squeezed into two lines or clipped. */}
      <div className="flex flex-wrap items-end gap-2 border-t border-rule bg-paper px-4 py-3 sm:px-6">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Send a message…"
          rows={1}
          aria-label="Message"
          // `resize-y` rather than none: a one-row box cannot hold a long
          // message, and the reader should be able to make room for it.
          className="hm-field order-1 max-h-40 basis-full resize-y sm:order-none sm:max-h-none sm:basis-auto sm:flex-1"
        />

        <button
          type="button"
          onClick={startFreshConversation}
          disabled={messages.length === 0}
          className="hm-btn hm-btn--quiet order-2 sm:order-none"
        >
          New
        </button>

        {/* Disabled while a Response is in progress so Turns cannot interleave. */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={inProgress || input.trim().length === 0}
          className="hm-btn hm-btn--primary order-3 sm:order-none sm:ml-auto"
        >
          Send
        </button>

        {/* Stop and Regenerate are mutually exclusive: one abandons a Response
            in flight, the other retries one that has already landed. */}
        {inProgress ? (
          <button
            type="button"
            onClick={stop}
            className="hm-btn order-4 sm:order-none"
          >
            Stop
          </button>
        ) : (
          canRegenerate && (
            <button
              type="button"
              onClick={handleRegenerate}
              className="hm-btn order-4 sm:order-none"
            >
              Regenerate
            </button>
          )
        )}
      </div>
    </div>
  );
}
