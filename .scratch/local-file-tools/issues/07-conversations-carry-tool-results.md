# 07: Saved Conversations carry Tool Results

**What to build:** A Conversation that read files still opens properly tomorrow.

The Conversation Store was built for Turns of text. Tool parts carry file contents into it, and
the risk is that reopening one produces a malformed history rather than a conversation.

**Blocked by:** 05 — Show Tool Calls in the transcript

**Status:** resolved

- [x] Tool parts and their results are saved with the rest of the Turn, so reopening a
      Conversation shows what was read
- [x] Reopening a Saved Conversation and continuing it produces a valid history — a tool call
      with no result is malformed, and providers reject it, so this is asserted rather than
      assumed
- [x] An **unanswered** approval in a reopened Conversation does not poison the whole history.
      The SDK's message conversion filters dangling tool calls by an index-dependent rule, so the
      same unfinished Turn can throw on one save and be silently truncated on another — a later
      user message is enough to change which branch it takes. Pinned by tests over both shapes,
      because a bug that only appears on some saves is read as flakiness rather than as a defect
- [x] An approval request that was answered survives the reload as answered, and does not
      reappear as an open question
- [x] A Saved Conversation written before this feature, with no tool parts at all, still opens —
      pinned by a test, because the reader's existing Conversations are not fixtures
- [x] The store's size guard still holds with Tool Results in it; a file read of a large file
      does not silently blow past what a browser database will take
- [x] Deleting a Saved Conversation that holds file contents removes those contents too — there
      is no second copy anywhere
- [x] The save debounce still behaves: a Turn whose Tool Results arrive mid-stream is saved once,
      not on every chunk, and the file contents are not re-written on each debounce tick
- [x] Tests: a Conversation with a completed read reopens with the read intact; one with an
      answered approval reopens without asking again; one with an open approval reopens still
      asking; a pre-feature Conversation reopens; a deleted one leaves nothing behind

## Decisions

### The index-dependent rule is real, and it is not the worst of it

Both halves verified at runtime against the installed SDK, through the shipping path rather than
by reading the conversion (`lib/testing/history.ts`). `[user, assistant(approval-requested)]` is
rejected with `MissingToolResultsError`; `[user, assistant(approval-requested), user]` is silently
truncated and succeeds. One more user message changes the branch, so both shapes are pinned in
`lib/conversations/turns.test.ts`.

The larger find is that the implicit filter only covers `approval-requested`. A call in
`input-streaming` or `input-available` is rejected **in both shapes**. That is the mid-read save:
the debounce is 300ms and a read takes longer than that, so the save that lands in the gap stores
a Tool Call with nothing under it, and no later user message rescues it. Any Tool the reader waits
on — a `search_files` walking a large tree — reaches the database in that state.

### A Tool Call is saved only when something answers it

`lib/conversations/turns.ts` settles every call nothing has answered yet, and `save` puts Turns
through it. A call the *machine* owes — `input-streaming`, `input-available`, a Grant-covered
request the SDK had not yet answered, or a reader's yes before the read ran — is recorded as
`output-error` saying the read was cut short. A call the *reader* owes is kept verbatim.

**Not `ignoreIncompleteToolCalls`.** That deletes the part, so the Model continues with no memory
of having asked; settling keeps the call in the history as one that did not come back, which is
what happened and is something the Model can be told. The route still passes no options to
`convertToModelMessages`.

Settling keeps the approval and marks it granted, because that is what it was: a Grant, or a
reader's yes, had already decided to let the read happen before the tab closed. It is also the
SDK's own shape — `output-error` carries an approval only when it was granted — and dropping it
would let a cut-short read of a file outside the folder the reader shared come back looking like
one inside it.

### What a reader sees when they reopen a Conversation whose last Turn ended on an unanswered approval

**Still asking.** The question is kept verbatim, the row reads "Needs your answer", and since
ticket 06 they can answer it on return — the approval id travels with the part. They are never
answered for them.

The question is kept because it is not unfinished, it is waiting on the reader, and dropping it
would answer for them. Keeping it does **not** make that shape safe to send, which is why both
shapes are pinned: the app never sends it. Continuing is impossible while a question is open —
Send is disabled by ticket 06's `awaitingAnswer` — and **Regenerate is now withheld on the same
ground**, which is the one remaining path to a history the Endpoint refuses. There is no Response
to rewrite: the Model asked, and has not been told. Withholding it costs nothing the reader can
do, and offering it would send them a `data: {"type":"error"}` inside a 200 stream reading as a
Model failure rather than as their Conversation being broken.

One thing a later ticket should know: a reader who never answers and simply abandons the
Conversation leaves the question open in the record forever, and it will silently vanish from the
Model's view on the next Turn. That is the SDK's rule, not ours, and it is the right answer — a
question the reader skipped is not something the Model should read as settled.

### The size guard: there is none, and none was added

`store.ts` has never had a ceiling of its own, and it does not get one now. The ceiling that
exists is the Tools': `MAX_FILE_BYTES` (1 MiB) and `MAX_READ_LINES` (2000) in
`lib/tools/file-tools.ts`. A megabyte is well inside what a browser database takes, and
IndexedDB was chosen over `localStorage`'s ~5MB string budget for precisely this reason. A second,
smaller ceiling in the store would be a limit nobody asked for, and the failure mode of hitting it
would be a Conversation silently losing the end of a file it had already read. Pinned with a
planted maximum-size read that round-trips whole, in `store.test.ts`.

Known limit, left alone as out of scope: a genuine quota failure reaches the reader as "this
browser will not open the Conversations database", which would be a lie. Worth its own ticket.

### Where this was tested

- `lib/conversations/turns.ts` + `turns.test.ts` — the rule, and every one of the SDK's seven
  states against the shipping path.
- `lib/conversations/store.test.ts` — round trip, pre-feature record, size ceiling, deletion.
- `lib/conversations/use-conversations.test.tsx` — save, reopen and delete through the hook
  against a real in-memory database.
- `components/chat-tools.test.tsx` — the debounce with a real read in the middle of a Turn,
  against a real file on disk. Its own file so the HTTP stub and the temporary project stay out
  of the shared suites.
- `components/chat.test.tsx` — Regenerate withheld on an open question, and offered again once
  answered.

`components/chat.tsx` was touched in one place, the `canRegenerate` condition, reusing the
`awaitingAnswer` ticket 06 had already introduced.

## Comments