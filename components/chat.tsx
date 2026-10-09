"use client";

import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ApprovalAnswering } from "./approval-answer";
import { canAnswer, type ApprovalAnswer } from "@/lib/chat/approval-answer";
import { isAwaitingApproval, isToolCall } from "@/lib/chat/tool-part";
import type { SavedConversation } from "@/lib/conversations/store";

import { useFileMenu } from "./file-menu";
import { Markdown } from "./markdown";
import { useNamedFiles } from "./named-files";
import { ToolCall } from "./tool-call";
import { mentionAt, mentionRuns, type MentionRun } from "@/lib/roots/mention";
import { useRootReadout } from "@/lib/roots/root-readout";

export type ChatProps = {
  /** The Endpoint in use. Held by the caller, so it outlives this component. */
  endpointId: string;
  /** How the Endpoint is named for the reader, used where the Conversation opens empty. */
  endpointName: string;
  /**
   * The Model in use, already resolved against the Endpoint's default.
   *
   * Resolved by the caller rather than here: the Endpoint and Model are edited in
   * Settings, above the chat, and this component is remounted on every
   * Conversation switch.
   */
  modelId: string;
  /** The saved Conversation open here, or null when starting a new one. */
  conversation: SavedConversation | null;
  /** Called with the Turns on screen, so the Conversation can be saved. */
  onSave: (messages: UIMessage[]) => void;
  /** Called when the reader asks for a fresh Conversation, so the chat can be detached. */
  onStartNew?: () => void;
};

/**
 * Renders one Turn as the user wrote it or as the model produced it.
 *
 * The parts of a Turn are rendered rather than joined into one string, because a
 * Tool Call is a thing that happened partway through a Response: the prose before
 * it and the prose after it were written on opposite sides of a file read, and
 * rendering them as one block would hide the order the answer was built in.
 * Consecutive text parts are still joined together, so a Response of nothing but
 * words renders exactly as it did before.
 *
 * The two roles are shown differently on purpose. A Response is formatted text
 * the Model chose, so it is rendered as such. What the user typed is theirs to
 * have shown back verbatim, so it is left as written — including the single
 * newlines that a formatted rendering would otherwise swallow.
 *
 * **A Tool Call is not a Turn.** A read is part of one Turn's answer rather than
 * a message of its own, so its row sits inside the Response that made it — which
 * is what lets a reader see that a line the Model cited and the file it came
 * from are two halves of the same thing.
 */
export function Turn({ message }: { message: UIMessage }) {
  const fromUser = message.role === "user";

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
        {renderParts(message, fromUser)}
      </div>
    </div>
  );
}

/**
 * A Turn's parts in the order they arrived, with its words kept together.
 *
 * The accumulating is the reason this is not a plain map: a Response the Model
 * wrote around a read arrives as text, tool, text, and rendering each text part
 * on its own would break every paragraph the Endpoint split for its own reasons
 * into one line per part. So words are held back and flushed as a block whenever
 * something that is not a word comes between two of them.
 */
function renderParts(message: UIMessage, fromUser: boolean): ReactNode[] {
  const blocks: ReactNode[] = [];
  let words: string[] = [];

  const flush = () => {
    if (words.length === 0) return;
    // A Response can arrive as several parts; blank lines keep them from
    // merging into one paragraph when they are rendered together.
    const text = words.join("\n\n");
    words = [];
    blocks.push(
      fromUser ? (
        <span key={blocks.length}>{text}</span>
      ) : (
        <Markdown key={blocks.length}>{text}</Markdown>
      ),
    );
  };

  for (const part of message.parts) {
    if (part.type === "text") {
      words.push(part.text);
      continue;
    }

    flush();

    // A dynamic Tool Call carries its name on the part rather than in its type,
    // and `ToolCall` reads that too — so a Tool the app has no declaration for is
    // still shown rather than vanishing the way a filtered-out part does.
    if (isToolCall(part)) {
      blocks.push(<ToolCall key={part.toolCallId} part={part} />);
    }
  }

  flush();
  return blocks;
}

/**
 * The mention the caret is inside, left open.
 *
 * "Open" is the whole of the difference from the runs in `mention.ts`: this is a
 * mention mid-typing, waiting to be replaced by a path, and it has to carry where
 * it began because the insertion has to replace exactly the words the `@` opened
 * and nothing else — including anything the reader has already typed past the
 * caret, which stays where it was.
 */
type OpenMention = { start: number; query: string };

/**
 * The message, cut into the names in it and the words around them.
 *
 * **Every character appears once, in order, and nothing else is added.** This is
 * not a list of what the message is about drawn beside the message: it is the
 * message, with some of its runs wrapped, and a copy that dropped a space or
 * folded two lines into one would put every name after it out of place — so the
 * runs are cut rather than the words chosen, and the pieces between them are
 * everything the runs do not cover.
 */
function drawn(text: string, runs: MentionRun[]): ReactNode {
  const pieces: ReactNode[] = [];
  let at = 0;

  runs.forEach((run, index) => {
    if (run.start > at) pieces.push(text.slice(at, run.start));
    pieces.push(
      <span key={index} data-mention="" className="hm-mention">
        {text.slice(run.start, run.end)}
      </span>,
    );
    at = run.end;
  });

  if (at < text.length) pieces.push(text.slice(at));

  return <>{pieces}</>;
}

export function Chat({
  endpointId,
  endpointName,
  modelId,
  conversation,
  onSave,
  onStartNew,
}: ChatProps) {
  const [input, setInput] = useState("");

  /**
   * The composer, and the caret it owns.
   *
   * The field is reached for rather than driven: it is where the menu's keys
   * arrive, and it is the only thing that knows where the caret was. Nothing here
   * ever takes focus away from it — see `useFileMenu`, whose whole design is
   * that the reader's caret stays where they left it.
   */
  const field = useRef<HTMLTextAreaElement>(null);
  /**
   * The drawn copy of the message, over the field rather than beside it.
   *
   * A second box holding the same characters as the field, so a name in the
   * message can be drawn heavier than the words around it — which a textarea
   * cannot do for itself, because its text is one run with one weight. It is
   * reached for only to scroll: the field is the message, and everything the
   * reader does to the message goes to the field.
   */
  const mirror = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<OpenMention | null>(null);
  /**
   * Where the caret should land once the next value has been rendered, or `null`
   * when nothing is owed.
   *
   * A ref rather than state, because this is not something to re-render for: it is
   * a note left for the DOM after React has written the value, read once and
   * cleared. Held as state it would be a second render that exists only to put a
   * caret in the right place.
   */
  const caretOwed = useRef<number | null>(null);

  /**
   * Whether this reader has named a file with `@` in this Conversation.
   *
   * Only ever one way, because the tip below is a sentence about something the
   * reader has not found yet, and a reader who has found it is only being told
   * again. It comes back on its own when it should: the chat is remounted for
   * every Conversation, so a reader who opens another one — or presses New —
   * is told about `@` again rather than being left to remember it.
   *
   * Set on the pick rather than on the `@` being typed, so opening the menu and
   * changing your mind does not take the sentence away for good.
   */
  const [namedWithAt, setNamedWithAt] = useState(false);

  const menu = useFileMenu({
    query: mention?.query ?? null,
    onPick: insertPath,
  });

  /**
   * The files this message is about, resolved as it is written.
   *
   * A reader names a file by pasting where it is as often as by picking it from
   * the Root, and the pasted one may be anywhere on the machine. So the message is
   * watched for paths, each is asked about, and one beyond the folder the reader
   * chose puts its three answers here — before the Turn exists, which is the whole
   * of what makes this moment different from a Tool Call's approval.
   *
   * It is answered here and nowhere else: this component owns the composer's text
   * and the Send control, and `named-files` owns everything else about it.
   */
  const named = useNamedFiles(input);

  // The caret is placed after React has written the value and before the browser
  // has painted, so the reader picks up typing from the end of what was inserted
  // rather than from wherever the browser happened to leave it. Every render is
  // checked because the value is React's to write, and a caret set before React
  // has heard of the new value is a caret React overwrites.
  useEffect(() => {
    // The drawn copy is kept at the field's scroll before the caret is placed,
    // because the field can have scrolled on its own to write this value: a
    // message that grew past the cap brings the caret's line into view, and a
    // mirror left where the value used to be short draws the reader's own words
    // somewhere they did not type them.
    scrollMirror();

    const owed = caretOwed.current;
    if (owed === null) return;
    caretOwed.current = null;
    field.current?.setSelectionRange(owed, owed);
  });

  /**
   * Holds the drawn copy at the field's scroll.
   *
   * The only thing the mirror is ever told to do. It is two boxes rather than one
   * only so a name can be drawn heavier than the words around it, and the price of
   * that is that they can be scrolled apart — which is invisible until a reader has
   * scrolled back up the message to re-read a line and finds the names on it drawn
   * where the lines above them are.
   */
  function scrollMirror(): void {
    const drawn = mirror.current;
    const typed = field.current;
    if (drawn !== null && typed !== null) drawn.scrollTop = typed.scrollTop;
  }

  /**
   * Puts a chosen path in the message.
   *
   * The words after the `@` are replaced and the `@` itself stays, because it is
   * the reader's own mark on the name: it is what says, later in the same sentence
   * and to the row of files above the field, which words in a message are files,
   * and dropping it would leave a picked name indistinguishable from a path the
   * reader typed out from memory. Everything around it is left exactly as it was,
   * including anything past the caret. A space follows, because a name in a message
   * ends there and the reader is very often going to want a word next.
   *
   * What lands is `@src/util.ts ` rather than `src/util.ts `, so `named-path` takes
   * the `@` off again on the way to the route — the same trim a pasted `@path`
   * goes through, which is what keeps picking a file and typing one one action.
   */
  function insertPath(chosen: string) {
    if (mention === null) return;

    const caret = field.current?.selectionStart ?? input.length;
    const before = input.slice(0, mention.start);
    const after = input.slice(caret);

    setInput(`${before}@${chosen} ${after}`);
    setMention(null);
    setNamedWithAt(true);
    caretOwed.current = before.length + chosen.length + 2;
  }

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    setMessages,
    regenerate,
    addToolApprovalResponse,
  } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // Bound re-renders while a Response streams in, so reading stays smooth.
    throttle: 50,
    // Turns already stored for this Conversation, so opening a saved one shows
    // what was in it rather than an empty chat. The id is what makes `useChat`
    // treat these as its own history, so streaming a further Turn continues the
    // saved Conversation instead of starting a parallel one.
    id: conversation?.id,
    messages: conversation?.messages,
    // What makes answering a question carry on by itself. Without it the reader
    // answers, the row settles into `approval-responded`, and the Turn simply
    // stops there — the Model never learns whether the read was allowed, so
    // nothing about the file is ever read and nothing is said about it.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  // Which folder is the Root, for the composer to name above the field. Asked here
  // because this is where it is drawn, and read again when the picker announces a
  // change — a composer left naming the last folder declared would be claiming a
  // boundary that is no longer the one being read.
  const root = useRootReadout();

  // Saved as the Turns change, so a reload reopens what was in front of the
  // reader.
  //
  // Watching `messages` and debouncing is what makes this correct rather than
  // merely cheap. Every streamed delta produces a new array, so each one
  // re-arms the timer, and the save happens once the stream has been quiet for
  // the interval — which is the settled Conversation, not a half-received one.
  // Watching something coarser, such as the Turn count, would fire the save
  // while a Response was still arriving and then never fire again, because
  // streaming adds text without adding a Turn.
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => onSave(messages), 300);
    return () => clearTimeout(timer);
  }, [messages, onSave]);

  const inProgress = status === "submitted" || status === "streaming";

  /**
   * A read the Model is waiting on the reader to answer.
   *
   * A Grant-covered read is asked about by the same machinery and answered in the
   * same generation, so it is not outstanding and a Turn is not waiting on it —
   * which is the distinction `isAwaitingApproval` draws and the reason it is not
   * simply "is any part approved-pending".
   */
  const awaitingAnswer = messages.some((message) =>
    message.parts.some(isAwaitingApproval),
  );

  /**
   * The reader's answer, sent only when there is a question to answer it to.
   *
   * The SDK matches on the approval's own id and quietly ignores an answer that
   * matches nothing — while still firing the resume that follows an answer, so an
   * id from nowhere (or a second press) sends a Turn nobody asked for. Checked
   * here, where the whole Conversation is to hand, and refused rather than
   * half-applied.
   *
   * **The Endpoint and Model go with it.** `sendMessage` and `regenerate` do not
   * remember their body, and neither does `addToolApprovalResponse`: the options
   * are handed to each of them separately and none of them keeps what the last one
   * used. A resume sent without them is refused by the route for naming no
   * Endpoint and no Model — the reader presses "allow" and the Turn simply stops,
   * which looks exactly like the question having no answer.
   */
  function answerApproval(answer: ApprovalAnswer) {
    if (!canAnswer(messages, answer.id)) return;

    void addToolApprovalResponse({
      ...answer,
      options: { body: { endpointId, modelId } },
    });
  }

  // Regenerating rewrites the last Response, so it needs one to exist and
  // nothing else in flight; otherwise two Responses would race for the same Turn.
  //
  // A failed Turn is the exception: the request produced no Response at all, so
  // the last message is still the user's own and there is nothing to rewrite.
  // Offering Regenerate there is what lets a transient failure be retried
  // without the message being typed a second time.
  //
  // **An unanswered question is the other exception**, on the same grounds as
  // Send: there is no Response to rewrite, because the Model asked whether it may
  // read and has not been told yet. Resending it is not merely pointless — the
  // history would end on a Tool Call with nothing answering it, which the SDK
  // rejects before the Endpoint is reached at all, inside the stream rather than
  // as a status, so the reader would be told a Model could not complete the
  // request rather than that their Conversation is broken.
  //
  // The same `awaitingAnswer` Send is held back by, rather than one derived from
  // the last message alone: a Conversation with an outstanding question anywhere
  // in it is a Conversation whose history the Endpoint will refuse, and the last
  // message is not where that stops being true.
  const awaitingResponse =
    status === "error" && messages.at(-1)?.role === "user";
  const canRegenerate =
    !inProgress &&
    !awaitingAnswer &&
    (messages.at(-1)?.role === "assistant" || awaitingResponse);

  function startFreshConversation() {
    setMessages([]);
    stop();
    // The New control in the composer does not know about the list, so the
    // caller is told to detach this Conversation — otherwise the next save
    // would write the fresh Turns into the one the reader just left open.
    onStartNew?.();
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
      {/* **The Turns are the one thing on screen that scrolls**, now that the
          document itself does not: `globals.css` refuses to scroll `html` and
          `body`, which are held at exactly the window's height, so this box is
          where a long Conversation goes — and the composer below is a flex child
          of the same column rather than anything riding the document, so it
          stays at the foot of the window however far this has been scrolled.

          That makes the height above it load-bearing rather than incidental.
          `flex-1` is what fills the column the shell leaves once the header,
          the error line and the composer have had theirs, and `min-h-0` on the
          parent above is what lets the column be that short in the first place —
          a flex item that refuses to shrink would push the composer's own bottom
          edge out of the window instead.

          No `min-h-0` here, and that is not an oversight: a scroll container's
          automatic minimum size is zero whatever its height, which is exactly
          the allowance that lets this shrink below the Turns inside it. The
          sibling in `conversation-list` spells it out anyway, and a class that
          changes nothing should not be copied a second time. */}
      {/* `hm-scroll` reserves the scrollbar's gutter whether or not one is
          drawn, so the Turns do not slide sideways the moment the Theme
          changes — or the moment the first Turn makes this scrollable. */}
      <ApprovalAnswering answer={answerApproval}>
        <div className="hm-scroll flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {/* The reading column: capped and centred inside a shell that is as
              wide as the window. The page used to be capped instead, and taking
              that cap off it to fill the screen would have handed the prose the
              whole screen as well — a Turn is a line being read, and a line a
              hundred and fifty characters long is not one anybody reads to the
              end.

              So the cap moved here rather than away, and it is `max-w-6xl`
              because a reader on a wide monitor found 896px too narrow to write
              a message in: wide enough for a long one to be read while it is
              being written, narrow enough that a Response still wraps inside a
              line rather than a screen. **The same cap is on the composer row
              and on the error line below** — the field and the Turns have to end
              in the same place, or Send stops lining up with the reader's own
              Turn above it. Change all three together.

              `flex min-h-full flex-col` is what lets the greeting sit in the
              middle of the space the Turns would fill rather than pinned to the
              top of it. It is a column at least as tall as the window, so the
              empty Conversation is centred by `my-auto` on its greeting — auto
              margins rather than `justify-content: center` on the scroll box,
              because a centred flex container overflows at *both* ends and the
              top of it cannot be scrolled back to. With auto margins the surplus
              collapses to nothing instead, and a Conversation that outgrows the
              window scrolls from the first Turn. Nothing else in the column
              carries a vertical margin, so the Turns are laid out exactly as
              they were before. */}
          <div className="mx-auto flex min-h-full max-w-6xl flex-col space-y-4">
            {/* An empty Conversation is one greeting above one instruction, and the
                greeting is the larger of the two because it is the only line the
                reader has been shown before any of their own — at the muted size of
                the instruction it read as a system note rather than as anything
                said to them.

                Big within the scale rather than past it: `text-lg` is the top of the
                five sizes in `tokens.css` and the size the page's own heading is set
                at, so the display face and the weight carry the rest. A sixth size
                here would be the one place the type scale stopped being a rule.

                `data-greeting` is a structural hook for the tests, the same bargain
                as `data-turn`: it names this block so a test can find the greeting
                without asserting a size or a colour. */}
            {messages.length === 0 && (
              <div
                data-greeting
                className="mx-auto my-auto max-w-[52ch] text-center"
              >
                <p className="font-display text-lg font-semibold tracking-tight text-ink">
                  Hello!
                </p>
                <p className="mt-2 text-sm text-muted">
                  Send a message to begin a Conversation with {endpointName}.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <Turn key={message.id} message={message} />
            ))}
          </div>
        </div>
      </ApprovalAnswering>

      {error && (
        <p role="alert" className="mx-auto w-full max-w-6xl px-4 pb-2 sm:px-6">
          <span className="hm-status hm-status--error">{error.message}</span>
        </p>
      )}

      {/* The composer is two boxes: a bar across the whole column, and the row of
          controls inside it at the reading measure — the `max-w-6xl` the Turns
          above are capped at, and for their reason. The rule and the paper span
          the width the shell now occupies, so the composer reads as the foot of
          the Conversation rather than as a box floating in the middle of it; the
          controls stop at the measure, because a field a monitor wide is a field
          the caret runs out of before the message does.

          That row wraps rather than shrinking: at a narrow width the field takes
          its own full-width row and the controls sit beneath it, so no button
          label is ever squeezed into two lines or clipped. `relative` is on the
          row rather than the bar, and is for the menu alone — it is placed
          against the row instead of the window, so it stays over the composer the
          reader is typing into however far down the page the Conversation has
          grown, and it is the width of the field rather than the width of the
          screen. */}
      <div className="border-t border-rule bg-paper px-4 py-3 sm:px-6">
        <div className="relative mx-auto flex w-full max-w-6xl flex-wrap items-end gap-2">
          {/* The two things a message written here will be answered by, said where it
              is written, on one line at opposite ends.

              What a message goes to, and what it is allowed to read, are halves of
              one question — who is answering, and from where. They are read together
              before a message is written and never again afterwards, so they share a
              line: the Endpoint and Model at the left, the Root at the right, each
              truncated with the whole of it one hover away.

              The Endpoint and Model are chosen in Settings and a Conversation runs
              long past the choosing, so the pair the reader is actually talking to
              sits beside the control that will carry it — otherwise the only place
              it is written down is a dialog they would have to reopen to read it.
              Kept to one quiet line, because it is a readout rather than a control:
              the Model is in the mono register as elsewhere, being a machine string
              read character by character.

              `min-w-0` on both halves, which is what lets either be truncated at
              all: without it a flex child keeps its content's width, the long one
              pushes the short one off the end of the line, and the line the two
              share becomes a line where only the first thing is readable. */}
          <div className="order-none flex basis-full items-baseline justify-between gap-4">
            <p
              // `data-in-use` names the readout for the tests, so an assertion can
              // read what a message would be sent to without going by the words it
              // happens to be made of.
              data-in-use
              title={[endpointName, modelId].filter(Boolean).join(" · ")}
              className="min-w-0 truncate text-xs text-muted"
            >
              {endpointName}
              {/* Absent rather than trailing when no Model is resolved, so the line
                  reads as what it knows rather than as a separator before nothing. */}
              {modelId && <span className="font-mono"> · {modelId}</span>}
            </p>

            {/* Which folder is the Root, at the other end of the same line.
                Every message is answered from somewhere, and until this existed
                nothing on screen said where: the Root lives behind the Settings
                dialog, so a reader who had declared one had no way to tell whether
                the Response in front of them came from inside it.

                **It is drawn, not offered.** Nothing here opens Settings, and there
                is no control to click: a readout that could be mistaken for one
                would make the reader hunt for a control that is not there, and the
                folder is changed where it is declared rather than from a composer
                that has no business changing it.

                `truncate` is the floor under a floor rather than the cut itself: the
                path is already cut to `MAX_ROOT_CHARS` in `root-readout`, and this
                only catches a window too narrow to draw even that. */}
            {root && (
              <p
                // `data-root` names the readout for the tests, on the reasoning
                // `data-in-use` records: an assertion should not be pinned to the
                // exact words the Root is named with, or to the cut that keeps it on
                // one line.
                data-root
                title={root.title}
                className={`min-w-0 shrink truncate text-right text-xs text-muted ${
                  root.machine ? "font-mono" : ""
                }`}
              >
                {root.text}
              </p>
            )}
          </div>

          {/* The menu, which is a popup over the composer and never a dialog
              beside it. It is rendered here so it sits inside the box the popup is
              placed against, and unmounted rather than hidden whenever there is no
              `@` being typed — a menu left on screen with nothing behind it is a
              menu offering a Root the reader has stopped asking about. */}
          {menu.popup}

          {/* The files this message is about, in the same place and for the same
              reason, and never at the same time: while an `@` is being typed the
              words after it are half a filename, and a row asking about one would be
              a question about something the reader has not finished typing. The menu
              closes the moment a name is chosen, and the row it left behind is then
              the answer. */}
          {!menu.open && named.panel}

          {/* The field and the drawn copy of it, one box painted twice.

              A textarea's text is a single run, so it is a single weight: every
              word in the message would be drawn the same however it was named.
              The names are what a reader most needs to find again once the
              sentence has grown around them, and once the row of files above the
              field has gone — so the message is drawn a second time over the field
              with the names heavier, and the field's own text is made invisible.

              **The field stays the message.** The value, the caret, the selection,
              the keyboard and the undo stack are all the textarea's, and nothing
              here takes them: a control that reads a reader's keystrokes is a
              control that can lose them. The copy is `aria-hidden` and takes no
              pointer, so it is drawn and never heard from and never clicked on, and
              the two scroll together because a copy left behind by a scroll would
              draw the reader's own words somewhere they did not type them.

              The layout classes are on the wrapper rather than on the field,
              because the wrapper is what the row lays out and the copy has to fill
              exactly what the field fills.

              **`flex` on the wrapper is not decoration.** A `<textarea>` is
              `inline-block` by default, so as the first thing in a plain block box it
              sat on a line and the box grew by the line's descent below it — seven
              pixels of nothing under the field, and the field no longer level with
              the buttons it sits beside. As a flex item it is out of the line box
              and the wrapper is exactly as tall as the field. */}
          <div className="relative flex order-1 basis-full sm:order-none sm:basis-auto sm:flex-1">
            <textarea
              ref={field}
              value={input}
              onChange={(event) => {
                const value = event.target.value;
                // Typing puts a dismissed menu back, rather than leaving a reader
                // who pressed Escape unable to bring it up again without starting the
                // mention over. The same goes for a refusal about a named file: a
                // reader who has read it and carried on typing has read it.
                menu.typing();
                named.typing();
                setInput(value);
                // Read from the caret rather than from the end of the text, because a
                // reader who has moved back up the message is editing there and a menu
                // that followed the end of the line would be answering a different
                // sentence.
                setMention(
                  mentionAt(value, event.target.selectionStart ?? value.length),
                );
              }}
              onBlur={() => setMention(null)}
              onScroll={scrollMirror}
              onKeyDown={(event) => {
                // Asked first, and only while the menu is open — so a key the menu has
                // no use for, and every key when it is closed, still does what it does
                // in a textarea.
                if (menu.handleKey(event.key)) {
                  // Taken, not merely seen: an arrow key would move the caret out from
                  // under the menu, and an Enter would send a message the reader was
                  // still choosing a name inside.
                  event.preventDefault();
                  return;
                }

                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Send a message…"
              rows={1}
              aria-label="Message"
              // The combobox wiring, in full, because this is the case it was written
              // for: the field keeps the focus and the caret throughout, and the row
              // being chosen is named from here rather than by anything that took
              // focus to hold it. `aria-expanded` is `false` the whole time no `@` is
              // being typed, which is most of a reader's time in this field.
              role="combobox"
              aria-expanded={menu.open}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-controls={menu.open ? menu.listId : undefined}
              aria-activedescendant={menu.activeId}
              // `resize-y` rather than none: a one-row box cannot hold a long
              // message, and the reader should be able to make room for it.
              //
              // `hm-field--behind-mirror` is the whole of what the drawn copy costs
              // this element: its own text is invisible and the caret keeps its
              // colour, so the field is left holding everything a field is *for*.
              className="hm-field hm-field--behind-mirror relative z-0 max-h-40 resize-y sm:max-h-none"
            />

            {/* The message again, drawn. `aria-hidden` because it is a copy of
                something already announced, and `pointer-events` off because it
                covers the field: a copy that took clicks would take keys too. */}
            <div
              aria-hidden
              ref={mirror}
              data-mirror
              className="hm-mirror absolute inset-0 z-10"
            >
              {drawn(input, mentionRuns(input))}
            </div>
          </div>

          <button
            type="button"
            onClick={startFreshConversation}
            disabled={messages.length === 0}
            className="hm-btn hm-btn--quiet order-2"
          >
            New
          </button>

          {/* Disabled while a Response is in progress so Turns cannot interleave, and
              while a read is waiting to be answered: a Turn started behind an open
              question would send a history in which the Model has asked for
              something and been told nothing, which reads as though the answer was
              yes. Held down the same way while a file the reader named is waiting on
              *their* answer, for the same reason and with the same consequence — and
              "Deny" is on the row beside them, so refusing one file never refuses the
              whole message. */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              inProgress ||
              awaitingAnswer ||
              named.open > 0 ||
              input.trim().length === 0
            }
            className="hm-btn hm-btn--primary order-3"
          >
            Send
          </button>

          {/* Stop and Regenerate are mutually exclusive: one abandons a Response
              in flight, the other retries one that has already landed. */}
          {inProgress ? (
            <button
              type="button"
              onClick={stop}
              className="hm-btn order-4"
            >
              Stop
            </button>
          ) : (
            canRegenerate && (
              <button
                type="button"
                onClick={handleRegenerate}
                className="hm-btn order-4"
              >
                Regenerate
              </button>
            )
          )}

          {/* What `@` is for, said where `@` is typed.
              The menu is the only way to name a file without writing its path out,
              and nothing else in the interface mentions it: the Root lives behind
              the Settings dialog, so a reader who has never guessed the character
              has no way of finding out that they do not have to remember paths.
              Under the field rather than in it, because the placeholder is already
              spoken for and a tip inside the box would be a second thing read
              before the reader has written anything of their own.

              **On the row with the controls, at its right-hand end, once there
              is room for it.** It used to sit between New and Send, which put a
              sentence about writing a message between the two controls that act
              on one: a reader reaching for Send read past the tip to find it, and
              the tip was fitted into whatever gap two buttons left rather than
              placed at all. The controls keep each other's company on the left of
              the row and the sentence takes what is left, which is the one part of
              the row nothing else has an opinion about.

              That is what the orders are for, and they are the same at every
              width — nothing here needs a second arrangement. `sm:flex-1` is the
              space it takes to sit at that end: it grows into whatever the field
              and the buttons leave, sharing it with the field rather than
              squeezing it — which on a narrow window means both are smaller and
              the sentence wraps to two lines. `sm:text-right` is what holds it to
              the end of the row rather than letting it begin where the buttons
              stop, which is a sentence hung off Send and reads as though it were
              about it. Below `sm` there is no such space, so it keeps its own
              full-width row under the buttons, where it is centred and legible.

              Said about "the folder you chose" rather than naming the folder, which
              the tip has no room for: the folder's own path is named at the other
              end of the line above the field, where there is a whole row's worth of
              budget for it. The sentence is a promise the app cannot keep when no
              folder has been chosen, and the menu says so in its own words the
              moment the reader types the `@`, which is the better moment for it
              anyway, since that is where they are looking. */}
          {!namedWithAt && (
            <p
              // `data-tip` names the sentence for the tests, on the reasoning
              // `data-in-use` records: an assertion should not be pinned to the
              // exact words the tip happens to be drawn with.
              data-tip="mention"
              // `self-center` rather than the row's `items-end`, so the sentence
              // sits level with the labels inside the buttons beside it rather
              // than level with their bottom edge.
              className="order-5 basis-full text-center text-xs text-muted sm:flex-1 sm:self-center sm:text-right"
            >
              Type <span className="font-mono text-ink-2">@</span> to name a
              file or folder from the folder you chose, and what it holds is
              sent with your message.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
