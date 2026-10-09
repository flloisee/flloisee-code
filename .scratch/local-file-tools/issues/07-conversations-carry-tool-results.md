# 07: Saved Conversations carry Tool Results

**What to build:** A Conversation that read files still opens properly tomorrow.

The Conversation Store was built for Turns of text. Tool parts carry file contents into it, and
the risk is that reopening one produces a malformed history rather than a conversation.

**Blocked by:** 05 — Show Tool Calls in the transcript

**Status:** ready-for-agent

- [ ] Tool parts and their results are saved with the rest of the Turn, so reopening a
      Conversation shows what was read
- [ ] Reopening a Saved Conversation and continuing it produces a valid history — a tool call
      with no result is malformed, and providers reject it, so this is asserted rather than
      assumed
- [ ] An **unanswered** approval in a reopened Conversation does not poison the whole history.
      The SDK's message conversion filters dangling tool calls by an index-dependent rule, so the
      same unfinished Turn can throw on one save and be silently truncated on another — a later
      user message is enough to change which branch it takes. Pinned by tests over both shapes,
      because a bug that only appears on some saves is read as flakiness rather than as a defect
- [ ] An approval request that was answered survives the reload as answered, and does not
      reappear as an open question
- [ ] A Saved Conversation written before this feature, with no tool parts at all, still opens —
      pinned by a test, because the reader's existing Conversations are not fixtures
- [ ] The store's size guard still holds with Tool Results in it; a file read of a large file
      does not silently blow past what a browser database will take
- [ ] Deleting a Saved Conversation that holds file contents removes those contents too — there
      is no second copy anywhere
- [ ] The save debounce still behaves: a Turn whose Tool Results arrive mid-stream is saved once,
      not on every chunk, and the file contents are not re-written on each debounce tick
- [ ] Tests: a Conversation with a completed read reopens with the read intact; one with an
      answered approval reopens without asking again; one with an open approval reopens still
      asking; a pre-feature Conversation reopens; a deleted one leaves nothing behind

## Decisions

_Recorded once resolved._

## Comments