# 04: Wire the Tools into the chat route

**What to build:** The Tools reach the Model, the step loop is bounded, and a read outside the
Root stops and asks.

The chat route stays what it is — one POST, proxying to the chosen Endpoint — with the Tools
added to it rather than a second route beside it. Chat and reading are one Turn.

**Blocked by:** 03 — The three Tools

**Status:** resolved

- [x] With a Root chosen, the route passes `tools`, an approval policy, and a step limit to
      `streamText`
- [x] With no Root chosen, it passes none of them and the Turn behaves exactly as it did in v1 —
      pinned by a test, because a mode that only exists when configured is easy to break without
      noticing
- [x] No filesystem path is ever read from the request. The Root comes from the file of ticket
      01 and nowhere else, so a caller posting a path to `/api/chat` reaches nothing
- [x] `stopWhen: isStepCount(8)` is set explicitly, because `streamText` defaults to
      `isStepCount(1)` — one step means the Model produces a tool call and the loop stops without
      ever reading the result, so omitting it leaves the Tools inert rather than merely slow. The
      20 that the SDK's documentation calls the default belongs to `ToolLoopAgent`
- [x] Instructions naming the Tools are sent when a Root is set, and not otherwise
- [x] The instructions tell the Model not to retry a read that was denied, so a refusal ends the
      line rather than becoming a loop
- [x] An Endpoint whose Model cannot call Tools fails with a message naming the Endpoint and the
      Model, and quoting nothing from the provider — a case added to `lib/chat/failure.ts`, which
      exists so that nothing derived from a failure reaches the reader
- [x] A Turn whose history carries a tool call with no result fails readably rather than raw. This
      is a real failure mode, not a hypothetical one: the SDK throws `MissingToolResultsError`
      while converting messages, and it arrives as an error inside a 200 stream rather than as a
      status the existing status-based cases in `lib/chat/failure.ts` can see
- [x] The approval policy is deterministic for a given path, because the policy is re-evaluated on
      every replay of a history — a policy that asked twice for one path would ask the reader
      again for a decision they had already made
- [x] Stop still aborts the server's work during a tool loop, not only during generation — the
      `abortSignal` the route already passes covers it
- [x] A Tool failure leaves the Conversation intact, as every other failure in this app does
- [x] The route's `maxDuration` still covers a multi-step Turn, since eight steps against a
      loaded local Model is not one generation
- [x] Tests: no Tools without a Root; the step limit is what is configured; a path in the
      request body reaches no file; a provider refusing Tools produces the reader-safe message
      and echoes nothing

## Decisions

**The step limit is 8, and the baseline the ticket quoted is wrong.** `streamText`'s default is
`isStepCount(1)`, verified against the installed `ai@7.0.133` (`src/generate-text/stream-text.ts:423`,
typed `@default isStepCount(1)` at `dist/index.d.ts:3762`). The 20 belongs to `ToolLoopAgent`.
8 was already the right number; it is a judgement on top of a floor of 1 rather than a reduction
from 20. The exported name is `isStepCount`; `stepCountIs` is the same function under a second
name, and the spec and ticket already write `isStepCount`.

**Everything about reading is one conditional block, including `stopWhen`.** With no Root the
route passes no `tools`, no `toolApproval`, no `instructions` and no `stopWhen`. `stopWhen` is
inert without Tools — there is no second step to reach — so omitting it changes nothing a reader
can observe; it is conditional so that "this feature is off" is one decision rather than four,
and so the v1 Turn is structurally v1 rather than coincidentally so. Pinned by asserting the
observable half: with no Root the request the Endpoint receives names no Tools and mentions no
files, and the stream is text alone.

**The approval policy asks only about paths that are genuinely outside the Root.** This was a
bug the tests caught, and it is worth recording because the wrong version is the obvious one.
Containment answers three ways — `outside`, `unreadable`, `unusable` — and asking the reader for
all three means a Model that misspells a filename inside the Root stops the whole Turn with a
question about approving a read of a file that does not exist. `lib/roots/containment.ts` says
why the reasons are kept apart: `unreadable` is a typo, `outside` is a decision about the
boundary. So `outside` asks; the other two run and let the Tool refuse with the sentence it
already writes, which tells the Model to call `list_files`. Nothing is opened either way — the
path is not admitted, so the Tool reads nothing.

**`experimental_toolApprovalSecret` is left to ticket 06.** It is only meaningful once something
answers an approval request, and setting it now would change the wire shape of every request for
a capability that has no reader.

**Out-of-root reads are non-functional until ticket 06 lands.** A read outside the Root now emits
a `tool-approval-request` and stops the loop, which is the SDK's own behaviour: a Tool Call
waiting on an answer is not run. Nothing in the app can answer yet, so that is where such a Turn
goes for now. This is the correct intermediate state and not a defect, but it should not be read
as a finished branch.

**The Grant branch of the policy is here rather than in ticket 06.** `mayRead` already answers
`under: "grant"`, and `spec.md:163-165` settles what that means: `{type: "approved", reason}`,
so a read under a Grant appears in the transcript marked as already allowed rather than arriving
like a read inside the Root. Writing only two thirds of one function and handing the third to
the next ticket is how the two halves come to disagree. Ticket 06 owns the client half and the
tests for the three answers.

**A Model that cannot call Tools is detected from the refusal's own words, privately.** There is
no status or code for it: 189 Endpoints say it 189 ways. `describeFailure` reads the response
body to *choose* a message and emits only its own prose, which is the rule that file already
follows for statuses. Two conditions narrow it, because a bare 400 is also a bad parameter or a
prompt that is too long and telling the reader to change Model there sends them to the wrong
setting: the request must have carried Tools — read from `APICallError.requestBodyValues`, which
is the request that actually went out rather than a claim about it — and the words must name tool
calling. Both halves are tested by refusing them.

**`MissingToolResultsError` is checked before every status case.** It is not an Endpoint failure
at all: the Turn is one this app built, so it fails whichever Endpoint it reaches, and the
Credential the reader entered has nothing to do with it. Told first, it is also the one thing the
reader can act on, because every later Turn from that Conversation fails the same way.

**Stop reaches the Tools, and a pending read does not run at all.** Verified at runtime rather
than read off the type. Aborting the request while a Tool Call has been parsed but before it has
executed produces `{"type":"abort"}` with no `tool-output-available` and no second request to the
Endpoint: the SDK checks the signal at that boundary, so the file is never opened. Aborting
between steps ends the loop the same way. Separately probed: the `AbortSignal` object handed to a
Tool's `execute` is identical (`===`) to the one the route passed, and `search_files` forwards it
to `walkFiles`, which stops at the next folder and reports `complete: false`. The mid-execution
case is not pinned by a test because interrupting a real walk deterministically would need a race
against a timer; the route-level tests pin what a reader experiences instead.

**`toUIMessageStreamResponse` is left alone.** It is deprecated in `ai@7` and will be removed in
the next major, but it still carries every tool and tool-approval chunk — verified end to end
against the stub, including `tool-approval-request` with its `approvalId`, `reason` and
`signature`. Its replacement is
`createUIMessageStreamResponse({stream: toUIMessageStream({stream: result.stream, tools})})`, and
the `tools` matters: the SDK's own example omits it, which loses dynamic/static resolution.
Migrating it is a one-line mechanical change that deserves its own diff and its own verification
of the tool chunks, rather than riding along in a ticket about reading files.

**`maxDuration` stays at 300.** Eight steps against a loaded local Model is eight round trips,
not one generation, and nothing here shortens them. The value is pinned by a test so it cannot be
quietly lowered to a single-generation figure.

**What the stream now emits, for tickets 05 and 06.** Part types are `tool-list_files`,
`tool-read_file`, `tool-search_files`, and the states observed are `input-streaming` /
`input-available`, `approval-requested`, `output-available` and `output-error` / `output-denied`.
An approval request arrives as
`{"type":"tool-approval-request","approvalId":"aitxt-…","toolCallId":"call_…","reason":"…"}`,
where `approvalId` is the id to answer with and `toolCallId` is not; a Grant arrives instead as a
`tool-approval-request` immediately followed by a `tool-approval-response` carrying
`isAutomatic: true` and the same `reason`.

## Comments
