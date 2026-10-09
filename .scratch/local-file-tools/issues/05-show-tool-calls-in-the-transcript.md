# 05: Show Tool Calls in the transcript

**What to build:** I can see which files went into the answer.

A Conversation that can read the disk and does not say so is the one failure this feature cannot
have. The reader has to be able to tell what the answer was based on, and which Endpoint it was
based on it at.

**Blocked by:** 03 — The three Tools

**Status:** resolved

- [x] Tool parts render in the transcript rather than being filtered out — `Turn` currently
      keeps only text parts, so a Tool Call is invisible until this changes
- [x] Each shows what was asked for, in a collapsed row that fits on one line: the Tool's name and
      the path
- [x] It can be opened to show what came back, so a reader can check a cited line rather than
      taking it on trust
- [x] A file outside the Root that was covered by a Grant appears marked as automatically
      approved, rather than arriving like a read inside the Root
- [x] A file outside the Root that the reader denied appears as denied, with its path — so the
      reader can see what was refused and allow it next Turn if they were being cautious
- [x] A Tool still running is visibly running, since a read of a large file is a pause that would
      otherwise look like a stalled app
- [x] A Tool that failed says so in the transcript, in the same reader-safe voice as the rest of
      the app's failures
- [x] Rows are identifiable by a structural hook the way `data-turn` already is, rather than by
      a class name or a radius, so a test does not pin the styling
- [x] The rows sit inside the Response they belong to, not as Turns of their own — a Tool Call
      is part of one Turn's answer
- [x] Tests: a completed read renders with its path; a denied read renders as denied; a running
      read renders as running; a failed read renders its message and no content

## Decisions

**The row is `ToolCall` in `components/tool-call.tsx`, and it takes one prop.** `ToolCall({ part })`,
where `part` is `ToolCallPart` — the SDK's `ToolUIPart` or its `DynamicToolUIPart`, the seven
states either way. Nothing is threaded through `Turn` for ticket 06 to fill in: the row takes the
part it is about, and there is nothing else it could need from the chat.

**The types live in `lib/chat/tool-part.ts` rather than in the component**, because `Turn` and
`ToolCall` both have to agree on them. Exported from there: `MessagePart`, `ToolPart`,
`ToolCallPart`, `isToolCall(part)` (the narrowing guard), and two booleans — `isAwaitingApproval`
and `isAutomaticApproval`. The two booleans are deliberately *not* narrowing guards: `part is
ToolPart` leaves the false branch typed `never` wherever the input is already a Tool Call, which is
exactly where they are called from.

**`isAwaitingApproval` is how ticket 06 detects a row awaiting an answer.** `messages.some((m) =>
m.parts.some(isAwaitingApproval))` over `useChat`'s `messages` is the whole of it. It returns
`false` for an automatic approval, deliberately: a read a Grant covers is asked about by the same
machinery and was never the reader's to answer, so "asked" and "not yet answered" are not the
same question. Pinned by `lib/chat/tool-part.test.ts`.

**A refusal is not a failure, and the state cannot tell them apart.** `lib/tools/file-tools.ts`
returns `ok: false` with a sentence rather than throwing, so a refusal arrives as
`output-available` — the same state as a file that was read. Anything reading the state alone
renders a file that was never opened as though it had been. So `output-available` is checked for
`ok === false`, the row says `Not read`, and the panel opens by itself. This is the one claim in
the ticket that is not visible in a screenshot of a successful read.

**A finished read says nothing.** The row carries a word only when there is something to say:
`Running…`, `Approved automatically`, `Needs your answer`, `Not read`, `Denied by you`, `Failed`.
A read that worked is silent, because a Turn that read four files should not carry the same word
four times, and silence after a row that has visibly appeared is the quietest way to say "done".

**A row whose whole content is a sentence opens itself; one holding a file does not.** Failures,
denials, refusals and an open question have one sentence each and nothing to inspect, so leaving
them collapsed would hide the only thing the row has to say. A successful read holds lines to
check, which is a thing to go and choose to look at. The reader's own press still wins either way
— `useState<boolean | null>` with `null` meaning "no opinion yet" — so a row that opened itself
can still be closed and stays closed.

**`errorText` is shown as-is.** It is the one piece of text in the transcript not written by this
app, and it is safe here because `lib/tools/file-tools.ts` returns refusals as results rather than
throwing: a Tool error is therefore a failure of the machinery, not a provider's words, and there
is nothing upstream in it to leak. The row itself never carries anything derived from it — the row
says `Failed` in our own voice and the panel repeats the reason.

**Three Tools, one frame.** The row branches on `part.state` and on what the *result* carries, never
on which Tool made the call, so there are no three near-identical bodies. `output.lines`,
`output.entries` and `output.matches` are each read by a narrow guard and rendered in the same
quoted block. The row also takes its arguments off the input by field name rather than per Tool,
so a Tool the app has no declaration for still shows what it was asked.

**`search_files` shows its query as well as its path.** A search with no path is a search of the
whole project, so the path alone would make the row read `search_files .` — a Tool name and the
Root, which is what every search says and none of what this one was. The query goes on the line
with it because the query is what an answer can be checked against. This is the one place the
"the Tool's name and the path" wording is read as "the name and what it was asked for".

**The shape of a result is restated in the component rather than imported.** `lib/tools/file-tools.ts`
opens files, and a client component reaching into it would be reaching across the boundary those
Tools exist to hold — so the transcript reads `output` as `unknown` and narrows it. Which is the
honest posture anyway: it is whatever the Endpoint chose to send, and every field shown is checked
before it is shown.

**200 lines is the most a panel shows, and it says what it did not show.** The Tool's own ceiling
is two thousand, and two thousand numbered lines inside a chat bubble pushes the rest of the
Conversation off the screen and buries the sentence that explains what was read. Stated rather
than dropped, the way every other ceiling in this feature states itself.

**The Endpoint is not stamped on the row, and the brief's "which Endpoint" is left to the composer.**
The Endpoint and Model are already named above the composer by `data-in-use` (`chat.tsx:194`), and
`useChat`'s messages do not carry which Endpoint produced them — so a per-Turn stamp could only
name the one *currently* selected, which for a Saved Conversation reopened tomorrow under a
different Endpoint would be a false claim rather than a missing one. The composer already says
which Endpoint is in use; what this ticket adds is the files it was based on.

**`data-tool` and `data-tool-state`.** `data-tool` names the Tool that made the row and
`data-tool-state` carries the SDK's own `state` verbatim, on the reasoning `data-turn` records: a
test that selects on a class or a radius has pinned the styling to an assertion. Tests find rows by
that hook and reach the disclosure by its role and accessible name.

**Both shapes of Tool part, not just the three declared.** The SDK normalises a static Tool part to
a dynamic one when the schema is unavailable across a persistence boundary, so a Saved
Conversation can hand back a read in a shape the app did not write. `isToolCall` takes both, so
such a read is shown rather than dropped — and a dropped read is a silent one.

**Tested at two seams.** `components/tool-call.test.tsx` drives the `Turn` component with the parts
an Endpoint running the Tools produces, and `components/chat.test.tsx` drives the real chat with
`fetch` rewired to the real Route Handler, seeded with the same parts the way a reopened
Conversation arrives. The stub Endpoint cannot produce a tool part on its own — a read is
something the Route Handler does on the Model's behalf, not something an Endpoint says — so the
second seam seeds rather than streams. The four tests the ticket names are all at the first seam.

**Not built here, because they are ticket 06's:** the three answers, the Grant list, and disabling
Send while a request is unanswered. The last of those needs only `isAwaitingApproval` above; the
first two need `part.approval.id`, which the row already carries and which the row deliberately
does not put anywhere a control could pick up by accident.

## Comments