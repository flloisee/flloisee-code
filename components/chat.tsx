"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useState } from "react";

import { ENDPOINTS } from "@/lib/endpoints/registry";

export type ChatProps = {
  /** The Endpoint the user has selected. */
  endpointId: string;
  /** The Model the user has selected within that Endpoint. */
  modelId: string;
};

/**
 * Renders one Turn as the user wrote it or as the model produced it.
 *
 * Message parts are rendered rather than plain strings so reasoning and tool
 * parts can appear later without reshaping this component.
 */
function Turn({ message }: { message: UIMessage }) {
  const fromUser = message.role === "user";

  return (
    <div className={`flex ${fromUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 whitespace-pre-wrap ${
          fromUser
            ? "bg-foreground text-background"
            : "border border-black/[.08] bg-white text-foreground dark:border-white/[.15] dark:bg-zinc-900"
        }`}
      >
        {message.parts
          .filter((part) => part.type === "text")
          .map((part, index) => (
            <span key={index}>{part.text}</span>
          ))}
      </div>
    </div>
  );
}

export function Chat({ endpointId, modelId }: ChatProps) {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // Bound re-renders while a Response streams in, so reading stays smooth.
    throttle: 50,
  });

  const inProgress = status === "submitted" || status === "streaming";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-500">
            Send a message to begin a Conversation with{" "}
            {ENDPOINTS.find((endpoint) => endpoint.id === endpointId)?.name}.
          </p>
        )}
        {messages.map((message) => (
          <Turn key={message.id} message={message} />
        ))}
      </div>

      {error && (
        <p role="alert" className="px-4 pb-2 text-sm text-red-600">
          {error.message}
        </p>
      )}

      <div className="flex items-end gap-2 border-t border-black/[.08] px-4 py-3 dark:border-white/[.15]">
        <button
          type="button"
          onClick={startFreshConversation}
          disabled={messages.length === 0}
          className="rounded-md border border-black/[.08] px-3 py-2 text-sm disabled:opacity-40 dark:border-white/[.15]"
        >
          New
        </button>

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
          className="flex-1 resize-none rounded-md border border-black/[.1] bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/[.15] dark:focus:border-white/40"
        />

        {/* Disabled while a Response is in progress so Turns cannot interleave. */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={inProgress || input.trim().length === 0}
          className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
        >
          Send
        </button>

        {inProgress && (
          <button
            type="button"
            onClick={stop}
            className="rounded-md border border-black/[.15] px-4 py-2 text-sm dark:border-white/[.2]"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}