# 06: Answer Approval Requests

**What to build:** When something outside the Root is read, I am asked, and my answer sticks.

Automatic inside the Root, a question outside it — and an answer of "always" is remembered, so
the same question is not asked on every Turn.

**Blocked by:** 04 — Wire the Tools into the chat route

**Status:** resolved

- [x] The policy is one function over the parsed tool input, so the answer depends on the path
      the Model actually asked for rather than on which Tool it reached for
- [x] Inside the Root: no approval metadata, the Tool runs
- [x] Under a Grant: an automatic approval carrying a reason, so the read is recorded in the
      transcript as automatically approved rather than arriving unannounced
- [x] Outside both: `'user-approval'`, and the request appears in the Turn
- [x] The request shows the full resolved path, because the reader is being asked to allow a
      specific file and a relative version of it would not tell them which
- [x] Three answers: allow once, always allow, deny
- [x] Always allow records a Grant through the route of ticket 01 and then answers, so the two
      cannot disagree
- [x] Answering resumes the Turn with no further typing from the reader
- [x] The resume sends exactly one request per answer. The SDK's completeness helper counts an
      `approval-responded` part as finished *before* the tool has run, so an auto-resume can fire
      while the read is still outstanding — asserted by counting the requests, since a duplicate
      Turn looks like nothing at all from the reader's side
- [x] Denying resumes the Turn too — the Model is told the read was refused and continues, rather
      than the Turn ending on a refusal
- [x] `experimental_toolApprovalSecret` is set to a value generated once per server process, so a
      modified client cannot fabricate an approval for a read the server never asked about
- [x] The reader's answer is matched on the approval's own id, not on the tool call's — the two
      sit next to each other in the stream and look alike, and using the wrong one is a silent
      no-op that still triggers the auto-resume
- [x] Granted paths are listed with a control to remove each, so an old Grant does not outlive the
      reason for it — and removing one takes effect on the next Turn
- [x] While a request is unanswered, the composer's Send stays disabled, so a Turn cannot be
      started behind an open question
- [x] Answering twice, or answering a request the server did not issue, is refused rather than
      half-applied
- [x] Tests: each of the three policy answers, asserted against the policy function rather than
      through a mocked model; approving resumes; denying resumes; the secret is set; a Grant
      recorded by "always allow" makes the next read automatic; removing a Grant makes the next
      read ask again

## Decisions

**Where a Grant is recorded is the path the Model asked for, resolved by the server.** "Always
allow" posts `{ action: "grant", path }` to `/api/roots` carrying whatever was in the Tool Call's
input — the relative path — and the route resolves it with `resolveAgainstRoot`, the same rule the
approval policy uses. The browser cannot resolve it: it does not know the Root. One answer to
"where does this path point", rather than two that could disagree and put a Grant on a different
file from the one the reader was shown.

**"Always allow" records the Grant and only then answers.** The route's refusal is shown and the
question stands, so the reader can still allow it once or deny it. The other order would let a
reader press "from now on" and receive an approval with no Grant behind it — a promise the app
cannot keep, and one the reader has no way to detect.

**The Grant is the path that was asked about, not its folder.** Spec story 13 says "for that
path", and the out-of-scope list rules out per-file grants *finer than* a path prefix — a file is
its own prefix. Granting the containing folder would widen the boundary to files the reader was
never asked about, which is a decision they did not make and cannot see they made.

**The route gained two actions rather than a second route.** `grant` and `revoke` sit beside
`read`/`find`/`declare`/`forget` on `/api/roots`, which is already the development-only route that
holds this file, and are bounded the same way: inside the walk boundary, so a caller cannot turn
it into a general "make this readable" request aimed at a server holding every Credential.
`revoke` compares exactly and refuses nothing, because the only thing it can do is take one entry
out of a list this route wrote.

**A path inside the Root cannot be granted.** Nothing was ever asked about it, so a Grant for it
is an entry no decision of the reader's backs — and padding the list with those makes the real
Grants harder to see, which is the one thing the list is for.

**An approved read is a boundary, not a bypass — the gap the ticket did not anticipate.** Ticket
04 left the Tools refusing anything outside the Root, which was correct then: an approval request
that nothing could answer never became a read. Once it can be answered, that same refusal fires
at the moment the answer is used, and the reader presses "allow" and watches the Turn say the
file was not read. So the Tools now take the reader's answer as a boundary in its own right:
`mayRead(reading, asked, answered)` puts the asked path in the list alongside the Root and the
Grants, and reports it under a third `Boundary`, `"approved"`. One `realpath`, one comparison,
one refusal — a rule that could differ between "inside the Root" and "the reader said yes" is a
second rule nobody remembers to check. `namer` already treats anything but `"root"` as absolute,
which is what an answered path needs.

**The answer is read out of the history the SDK hands the Tool, not remembered.** `execute`
receives `{ toolCallId, messages }`, and `messages` carries the `tool-approval-request` (which
names both ids) and the `tool-approval-response` (which names only the approval). The SDK
verifies every approval's signature against the tool name, call id and an input digest *before* it
runs anything, so a Tool that executes is one whose answer this server issued — and a Tool holding
its own set of what had been allowed would answer the same call differently on the next Turn,
which is the failure `readingApproval`'s determinism rule exists to prevent.

**The answering function travels in context rather than through `Turn`.** `ToolCall` keeps its
one prop and `Turn` keeps its one, so the tests that render a Turn directly are unaffected, and
`components/chat.tsx` gains a provider around the transcript instead of a prop on every row. A row
rendered with no Conversation around it offers no answers, which is the honest reading: there is
nothing there that could carry one.

**The resume re-sends the Endpoint and Model, and this is not optional.** `useChat` remembers
neither `sendMessage`'s body nor `addToolApprovalResponse`'s — the options are handed to each
separately and none keeps what the last used. A resume without them is refused by the route for
naming no Endpoint and no Model, and the reader presses "allow" and the Turn simply stops. The
answer carries `options: { body: { endpointId, modelId } }` for exactly that reason.

**Send is disabled while a question is open.** A Turn started behind one sends a history in which
the Model asked for something and was told nothing, which reads downstream as a yes. This is the
one change made in `components/chat.tsx` beyond the provider and the resume, and it is the smallest
that keeps the claim true.

**An answer with nothing to answer is refused silently.** `canAnswer` runs in `Chat`, where the
whole Conversation is to hand, and refuses an id that is not an open question. Nothing is shown:
there is no question left on screen to attach a message to, and one would be a message about a
control that has gone.

**`read` now answers with the Grants as well as the Root**, defaulted to `[]` on the wire so a
server that has never granted anything is not read as broken. `RootAnswer` carries `grants` on
every non-refusal.

## Comments