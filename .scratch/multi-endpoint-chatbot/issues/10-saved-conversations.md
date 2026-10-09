# 10: Saved Conversations

**What to build:** My Conversations are still there after I close the app, and I can come back to
one of them by name.

**Status:** resolved

Conversation persistence and multiple simultaneous Conversations were listed as out of scope for
v1 and are delivered here. `GLOSSARY.md` gained **Saved Conversation**, **Name**, **Store**,
**Preference Store** and **Conversation Store**; the word "session" remains on the avoid list
throughout, as the existing entries for **Conversation** required.

- [x] A Conversation survives closing and reopening the app
- [x] Saved Conversations are listed newest first, beside the Conversation
- [x] Each Saved Conversation is named from the message that opened it, cut to something
      scannable and ending at a word boundary
- [x] A name is derived once and kept, so a further Turn does not overwrite it
- [x] I can rename a Saved Conversation, and the name survives further Turns
- [x] I can delete a Saved Conversation, and the others are left alone
- [x] Deleting the open Conversation closes it rather than leaving Turns on screen that are
      stored nowhere
- [x] Opening another Conversation shows its own Turns and does not write into the one just
      left open
- [x] An empty Conversation is not saved, so the list holds no blank rows
- [x] Where storage will not open, the interface says so and carries on without saving
- [x] Failing to save never costs the Turns already on screen
- [x] A Stored Conversation that no longer parses is skipped rather than breaking the list
- [x] A Response slower than the save still arrives, under one Conversation name
- [x] The Endpoint and Model in use survive switching Conversations, in both directions
- [x] Starting a new Conversation from the list clears the Turns of the one left open
- [x] The app still opens on the Endpoint the page chose, not on the last one used

## Decisions

**IndexedDB, in the browser, with no server behind it.** There is no account and no second
machine, so a server-side store would be a database whose only reader is the machine that wrote
it. This keeps the app single-user and local, which `README.md` already treats as the security
posture the whole design rests on. The cost is that a Saved Conversation cannot be shared or
synced, which is recorded as out of scope rather than presented as a limitation to work around.

**The name is derived once and stored.** Recomputing it from the Turns on every save would
silently undo a rename on the next Turn, so the stored name wins over the derived one from then
on.

**The cut prefers a word boundary, but not unconditionally.** A name ending mid-word reads as
damage. A single unbroken string has no boundary to find, and chasing the last space in it would
leave almost nothing, so the boundary is only taken when it still leaves 60% of the name.

**Only a trailing *high* surrogate is dropped.** `slice` counts code units, and an emoji or
astral-plane CJK character is two of them, so a cut can land between halves. The stranded half is
the high one — a trailing low half is the ordinary second unit of a pair that is already whole,
and trimming it would delete a character the reader typed. A test pins both directions, because
the first version of this had it backwards.

**The store is behind a backend the caller supplies.** The hook takes a `ConversationBackend`
rather than reaching for the global factory, so the tests drive the real store against an
in-memory database instead of asserting against jsdom's. The factory is bound into the backend
rather than passed per call, because a call site that omitted it would silently reach the real
browser database rather than failing.

**The Conversation Store guards each field separately.** One test planting a single malformed
record proved nothing — removing the Turns check entirely still passed, because the name check
was doing the work. There are now three planted records, one per field, so each guard is pinned
by the case it exists for.

**`Workspace` renders the chat itself.** A render-function prop cannot cross the server/client
boundary under Cache Components — `next build` fails on it — so the Endpoint and Model pickers
stay where they belong, in `Chat`.

**Renaming a row that is not open reads the record first.** The list offers the control on every
row, so a rename that rebuilt the record from state would empty any Conversation that was not
currently on screen.

**The Endpoint and Model are held by the Workspace, not by `Chat`.** This is the one thing the
first pass got wrong. The chat is remounted on every Conversation switch — that remount is what
makes `useChat` adopt a saved Conversation's Turns — and the Endpoint and Model were seeded into
`Chat`'s own state from props. So every switch threw them away and fell back to the `endpointId`
prop, which is Ollama: choose a Cloud Endpoint, start a new Conversation, and the app silently
reverted to an Endpoint the reader had not chosen. They are now props on `Chat`, held above the
remount, with the Model choice still keyed by Endpoint so switching back restores it.

The tests for this assert on the request the Route Handler receives, not on what a picker
displays, because the picker can show one thing while the request says another — and it did,
for exactly as long as this was broken.

**A reload opens on an empty Conversation rather than reopening the last one.** The Turns are
shown because they were stored, not fetched, and dropping a reader into Turns they did not ask
for on every visit would be worse than making them click. Pinned by a test because the opposite
is a reasonable thing to want.

**Two flaky tests here were really two broken assertions.** `reopens with the Turns it was left
holding` had been passing on `getByText`, which matched the sidebar row rather than a Turn, so
it never checked the Turns at all. And the Endpoint assertion after a reopen sampled the picker
while its own Registry re-read was in flight, so it read `""` — a fresh mount has to await the
picker, not sample it. Both are now scoped to the Turns and awaited.

**The save is debounced on the Turns themselves, not on a summary of them.** Watching a coarser
signal such as the Turn count fires the save while a Response is still arriving and then never
fires again, because streaming adds text without adding a Turn. Watching the array and
debouncing saves once the stream has gone quiet, which is the settled Conversation.

**A Conversation's id is assigned when it is started, not when it is first written.** The chat
is keyed on this id, so minting it on first write remounted the chat underneath a Response that
was still streaming in — unmounting aborts the stream, and the reader is left with their message
and no answer, and no error either. It bit exactly when the first token was slower than the
300ms save: a cold Model loading before its first token, which is the normal case for LM Studio
with Just-In-Time loading rather than an edge. Proven against the live server log, which showed
the chat request arriving, the model starting to load, and then `Client disconnected. Stopping
generation... Engine protocol startup was aborted` — all inside the same second the message was
sent. While starting new, `current` is therefore an unsaved shell with a stable id and no Turns,
not nothing; the first write keeps the id, so the key never changes under a stream. Only
starting, opening, or deleting changes it. Pinned by holding the stub's first chunk past the
debounce and asserting the Response still arrives, under one Conversation name rather than two.

## Checking these tests are worth having

Each guard above was removed one at a time and the suite watched, the way
`scripts/mutation-check.sh` does for the Key Entry paths. Two guards survived that first pass
and are worth recording, because both looked covered:

- Removing the Turns check from `isSaved` changed nothing, until the test planted a record that
  was corrupt *only* in its Turns. One malformed record was being caught by the name check, so
  the Turns check had no test of its own.
- Removing the "keep the existing name" rule passed too, because the assertion read the listed
  name, which is only re-read once the write lands — so it passed while the write that would
  undo the rename was still in flight. It now waits on the stored name.
