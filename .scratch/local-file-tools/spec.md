# Local File Tools

Status: ready-for-agent

## Problem Statement

A developer wants to ask questions about files on their own machine — what this function
does, where it is called from, what these logs say — and the Model cannot see any of it. The
developer has to find the file first, open it, and paste the fragment that matters, by hand,
every time. For anything larger than a fragment that does not scale at all.

The app already holds a Conversation with a Model and already knows how to proxy a request to
whichever Endpoint the reader chose. It knows nothing about the disk.

v1 named tool calling and file attachment out of scope, and said so. This is the ticket that
takes them off the list.

## Solution

The Model gets three read-only Tools over a folder the developer names — a **Root** — and the
developer gets two ways to name a file directly: typing `@` to browse the Root from the
composer, or pasting a path into a message.

Everything is contained to the Root. Anything outside it stops and asks first, in the
interface, and an answer of "always" is remembered as a **Grant** so it does not ask again.

The Rule that governs the whole feature: **a file the reader did not point at does not leave
the machine.** What the Model reads is what the reader can see it read, and where that read
went — the same Endpoint, and therefore possibly off the machine.

## User Stories

### Getting files in front of the Model

1. As a developer, I want the Model to read a file in my project, so that I can ask about it
   without finding and pasting the part I guessed was relevant.
2. As a developer, I want the Model to list a directory, so that it can find out what is there
   rather than guessing at filenames.
3. As a developer, I want the Model to search across my project, so that I can ask "where is
   this used" without knowing which file answers it.
4. As a developer, I want to type `@` and pick a file from the folder I chose, so that naming a
   file does not mean typing its path from memory.
5. As a developer, I want to paste a path into a message, so that I can name a file I already
   know the location of.
6. As a developer, I want a pasted path to be checked before the message is sent, so that I find
   out it is wrong while I can still fix it.
7. As a developer, I want a file I name to be sent with my message as text, so that every
   Endpoint I already talk to can still work.

### Choosing what can be read

8. As a developer, I want to choose the folder the Model reads, so that it sees my project and
   not my whole home directory.
9. As a developer, I want that choice to survive a restart, so that I do not choose it again
   every morning.
10. As a developer, I want to change or remove the folder, so that finishing a piece of work
    does not leave a capability lying around.
11. As a developer, I want the Model to be able to read anything inside that folder without
    stopping to ask me, so that a question spanning ten files still gets answered in one go.
12. As a developer, I want to be asked before anything outside that folder is read, so that
    reaching for `~/.ssh` is my decision and not the Model's.
13. As a developer, I want to be asked once and then left alone for that path, so that I am not
    answering the same question on every Turn.
14. As a developer, I want to see which paths I have granted and remove them, so that an old
    grant does not outlive the reason for it.
15. As a developer, I want to deny a read and have the conversation carry on, so that refusing
    one thing does not end the Turn.

### Seeing what happened

16. As a developer, I want to see which files the Model read, so that I know what its answer is
    based on.
17. As a developer, I want to see what a denied read was going to be, so that I can allow it on
    the next Turn if I was being cautious.
18. As a developer, I want to know which Endpoint my files were sent to, so that I am not
    surprised to learn a folder went to a Cloud Endpoint.
19. As a developer, I want the app to work exactly as it did before, when I have not chosen a
    folder, so that this costs me nothing until I use it.
20. As a developer, I want to be told when a Model cannot call Tools at all, so that I pick a
    different Model rather than assuming the folder is at fault.

### When things go wrong

21. As a developer, I want a file that has been deleted or moved to be reported plainly, so
    that I can point at the right one.
22. As a developer, I want to be told when a file is too large or not text, so that a refusal
    reads as a decision rather than an empty answer.
23. As a developer, I want a search over a huge folder to stop and say so, rather than hang.
24. As a developer, I want a failure to read a file to leave the Conversation intact, so that I
    keep the context I had built up.
25. As a developer, I want the folder to hold nothing that gets committed, so that my directory
    layout is not published with the app.

## Implementation Decisions

### Tools, not embeddings

The Model navigates with `list_files`, `read_file` and `search_files` rather than being handed
retrieved chunks.

Embedding-based retrieval was considered and rejected for v2. It needs an embedding Model per
Endpoint, and the Catalog records no embedding identifiers, so a reader would have to find one
per provider before the feature worked at all. It needs a vector store on disk and an index that
goes stale as files change. And it sends file content to an embedding provider to be stored as
vectors, which is a larger and quieter disclosure than reading a file the reader asked about.

Grep-style search over a chosen folder answers the same question for a folder the developer
already knows the extent of, needs no setup, and works on every one of the 189 Endpoints —
including a local Ollama serving a small model, where an embedding endpoint may not exist at
all. The interface is a tool boundary rather than string matching, so a `search_documents` tool
can be added behind it later without reshaping anything above it.

### The Root is held by the server, and the browser never names a path

The chat route reads the Root from a file of its own. No filesystem path arrives in a request
from the browser.

This follows the precedent set by the Key Entry route, where a caller-supplied base URL is
rejected outright so that reaching the route cannot redirect where a Credential goes. The same
argument applies here with more force: a caller-supplied path is an arbitrary-file-read
primitive aimed at a server that also holds every Credential on the machine.

The reader chooses the Root through a route that lists directories for them to walk. The
browser says "the third entry of the second directory" and the server does the resolving.

### Containment is by real path, and Grants are checked the same way

A path is admitted only if, after `path.resolve` and `fs.realpath`, it is the Root or sits under
`Root + sep`.

Realpath first, containment second, and in that order. A symlink inside the Root pointing at
`~/.ssh` resolves out of the Root and is refused — checking containment before resolving would
follow the link and then discover it was fine.

Grants are additional admitted prefixes, held as absolute resolved paths, and put through the
same check. A Grant is an addition to the boundary, never a way around it: a path is admitted
if it is under the Root **or** under a Grant, and by nothing else.

### Grants live in a file beside the environment file

`.reading-root.json`, next to `.env.local`, gitignored, written atomically by a development-only
route.

Putting them in the browser's Preference Store was considered and rejected. It needs no second
writer and the file holds no secret, which is a real economy. But the browser resends the whole
message history each Turn and can post anything to the app's own routes, so a grant held in the
browser is a grant something in the browser can pre-approve. The threat this feature exists to
survive is a Model reading a document and being talked into reaching for a key file; with the
Grant on the server, that still costs a human click every time.

The cost is that Key Entry is no longer the app's only file writer, and `README.md` says so in
one place. That sentence has to change. It is the price of a capability the server must
authorise for itself.

### Reads are automatic inside the Root, and outside it the SDK's own approval flow

The decision is made by a `toolApproval` function on `streamText`, which receives the parsed
tool input — so the answer depends on the path the Model actually asked for, not on which tool
it reached for. Inside the Root, or under a Grant, it returns nothing and the Tool runs. Outside,
it returns `'user-approval'` and the SDK emits an approval request part into the stream.

`{ type: "approved", reason }` is used for a path already covered by a Grant, so a read outside
the Root still appears in the transcript marked as automatically approved rather than arriving
unannounced.

The interface answers with Allow, Always allow, or Deny, and
`lastAssistantMessageIsCompleteWithApprovalResponses` resumes the Turn without the reader typing
anything. A denial reaches the Model as a denied result, and the instructions tell it not to
retry, so a refusal ends the line rather than becoming a loop.

### Approval responses are signed

`experimental_toolApprovalSecret` is set to a value generated once per server process.

The client resends the entire message history each Turn, so without it a modified client could
fabricate an approval for a read the server never asked anyone about. The secret makes the
server's approval request verifiable. It is per-process rather than configured, because it is
not a secret anyone holds — it is a check that the request came from this server.

Under Turbopack a module reload regenerates it and an approval in flight fails once. That is
the correct failure: it re-asks.

### Three Tools, all read-only

`list_files({ path })`, `read_file({ path, offset, limit })`,
`search_files({ query, path, glob })`.

Read-only as a decision, not an omission. A Tool that writes is a different capability with
different bounds, and it would make every read worth being suspicious of.

Three rather than more, because a small local Model handles a small tool list better, and a Tool
the Model cannot choose correctly is a Tool that produces a wrong answer rather than an error.
`read_file` takes an offset and a limit so a large file is read in pieces rather than refused.

Text comes back line-numbered and truncated with a pointer to where the rest of it is, so the
Model can cite a line the reader can then find. Binary is detected and refused rather than
mangled into the transcript, where it would read as content.

`search_files` is a bounded Node walk. `node_modules`, `.git`, and `.env*` are skipped, binary
and oversized files are not read, results are capped, and the cap is reported in the result so
the Model knows the answer is partial rather than complete.

Ripgrep was considered and rejected for v2: shelling out to a binary the app does not control
means two code paths, and behaviour that differs by machine.

### A named file is inlined as text, not attached as a file part

An Attachment's contents are placed in the reader's message as a delimited block of text.

The SDK can send a file part, and several Endpoints would take one. Most of the 189 would not,
and v1's entire premise is one code path across all of them. Inlining is dull and works
everywhere, which is the property this app is built on. Images are a separate question and stay
out of scope: a genuine image needs a Model that accepts one.

### The `@` menu and `search_files` share one walk

The composer menu filters the Root by filename and inserts the path. It is served by the same
bounded walk, so there is one implementation of "look through the Root" rather than two.

No persistent index. The Root is a folder a developer pointed at, usually far smaller than a
machine, and an index brings invalidation, a cache file and a second thing to go stale. Capping
results and debouncing the query covers the case that motivated it; a Root large enough to
outgrow that earns a cache as its own later ticket.

### A pasted path is resolved in the composer, and again at send

The composer recognises a path as it is typed or pasted and asks the server what it is: inside
the Root, under a Grant, or outside. Outside, the ask happens **in the composer, before the
Turn exists**.

This is a different moment from a Tool Call's approval, and it is deliberately not dressed up as
one. The reader named the file; the Model did not ask. An approval prompt appearing mid-Response
would claim an agency that is not there.

The server checks again at send. A file can be deleted, or the Root changed, between the paste
and the send, and the message is refused with a 400 naming the file rather than sent with a
silent omission.

### Tool Results stay in the Saved Conversation

A Conversation holding Tool Results holds file contents, and they go into IndexedDB with the
rest of it and are re-sent on every later Turn.

Stripping the output was considered and rejected. A tool call with no result is malformed
rather than merely terse, and providers reject it — so a Saved Conversation stripped of its
outputs would reopen as a broken one.

The honest statement is that a Saved Conversation can now contain the contents of files, on the
reader's own machine, in the reader's own storage. That is the same posture as the rest of the
Conversation Store: local, unshared, and gone when the reader deletes it.

### No Tools at all until a Root is chosen

With no Root set, the chat route passes no `tools` and no approval policy, and the Turn behaves
exactly as it did in v1.

This keeps the cost of the feature at zero for a reader who never uses it, and keeps the v1
tests meaningful rather than testing a mode that only exists when a Root is configured.

The instructions naming the Tools are sent on the same condition, so a Conversation with no Root
carries no talk of files.

### Eight steps

`stopWhen: isStepCount(8)`.

This is not a tuning decision. `streamText` defaults to `isStepCount(1)` — one step is the model
producing a tool call and then stopping, with the result never read — so without a `stopWhen` set
explicitly the Tools do not work at all. The number is a judgement on top of a floor.

A tool loop costs a full round trip per step and burns tokens doing it. Small local Models loop
when they are unsure, so 8 caps a runaway and cuts off a legitimately long search. The limit is
chosen for the Models most likely to need it.

An earlier draft of this spec claimed the SDK defaulted to 20 and that 8 was a reduction. That was
the documentation talking, not the package: 20 is `ToolLoopAgent`'s default, and the two are
conflated in the SDK's own docs. Verified against `stream-text.ts`, which says `isStepCount(1)`.

### Reading works in any build; declaring a Root does not

The route that writes the Root and Grants refuses outside development, as the Key Entry route
does. The chat route reads the file in any build, so a production server started after a Root
was declared still reads files.

The distinction is what is written rather than what is read. Writing records home-directory
paths on disk and is bounded like Key Entry. Reading is already bounded by the Root, and a
build that cannot set a Root cannot widen one.

## Testing Decisions

Containment is the highest-value thing here and gets the most attention, on the same reasoning
as the Key Entry route: it is our own logic, and it is the only thing standing between a
document on disk and a Cloud Endpoint.

- **Containment, exhaustively.** `..` climbing out, an absolute path elsewhere, a path that
  shares a prefix string with the Root without being under it (`/Users/fll/project-other` against
  a Root of `/Users/fll/project`), a symlink pointing out of the Root, a symlink chain, the Root
  itself, a path under a Grant, a path that is a sibling of a Grant rather than under it, and a
  Grant that cannot be used to reach the file above it.
- **Grants are additive and nothing else.** A test that removing the Grant check changes nothing
  would be the exact failure mode `scripts/mutation-check.sh` exists to catch, so entries are
  added there rather than trusted.
- **Text handling.** Binary refused rather than truncated; truncation that points at what was
  cut; line numbers that survive an offset; an empty file; a file that is exactly at the cap.
- **The walk.** The cap is honoured and reported; `.gitignore`d and `node_modules` paths are
  skipped; a file too large to read is skipped rather than opened.
- **The approval policy.** Inside the Root returns nothing; under a Grant returns an automatic
  approval carrying a reason; outside returns `'user-approval'`. Asserted against the policy
  function rather than through a mocked model, because the policy is the thing that is ours.
- **The route.** Refuses outside development; refuses a Root that is not a directory; refuses a
  path containing a null byte; never accepts a path from a chat request; answers `find` and
  `resolve` from the Root and not from anywhere else.
- **The composer.** `@` filters to the Root, navigates by keyboard, and inserts a path that
  resolves. A pasted path outside the Root raises the ask before the message can be sent.
- **The interface.** A denied read renders as denied and the Turn continues; an approved read
  appears in the transcript; answering an approval resumes the Turn without the reader typing.

Tool calls against a live Model are verified by use, not mocked. Start Ollama, ask a question
that needs two files, and watch the transcript — the Model layer is the SDK's, and a mocked
harness would only assert that the mock was called.

Each containment guard is added to `scripts/mutation-check.sh`, which already exists to answer
one question: would this test pass whether or not the check were there.

## Out of Scope

- Writing, editing, moving or deleting files, and running commands
- Embeddings, vector search, or any index over the Root
- Image and binary files, which need a Model that accepts them
- More than one Root at a time
- A time-based Grant — "allow this for an hour" is a real want and needs an expiry the file
  format does not have yet
- Per-file grants finer than a path prefix
- Grants for directories named by a pattern
- Re-indexing or invalidation for `@`, which is why there is no index
- Following a symlink out of the Root, ever, including after a Grant for its target
- Files larger than the read cap, which are refused with a reason rather than truncated into an
  answer
- Sharing a Root or a Saved Conversation with another machine or person
- A read-only browsing Endpoint, and any hosting of this app

## Status

Not started. Ten tickets, none claimed.

## Further Notes

**The sentence in `README.md` that has to change.** It reads: "This route is the app's only file
writer, and is bounded accordingly." After ticket 01 that is no longer true, and the surrounding
text reads as a security argument rather than a note. It has to be rewritten to cover both
writers and say what each is bounded by — one by development-only, one by containment.

**A Turn's contents are whatever the reader attached and whatever the Model read, sent to
whichever Endpoint was selected.** Both halves land in the same Conversation and the same saved
store. That sentence belongs in the README's Proxying section, because Proxying is what makes it
true.

**Tool support is not uniform across 189 Endpoints.** A Model that cannot call Tools fails in a
shape `lib/chat/failure.ts` has no case for, and that file's whole job is that nothing derived
from a failure reaches the reader. A case belongs there before the feature ships, and it has to
be assembled from the Endpoint's declared name — never from the provider's message, which echoes
the request back.

**Build against a Local Endpoint first, as always.** Ollama with a tool-capable Model is the
cheapest way to see whether a Model that has to reason across three files in sequence manages
it. If it does not, the transcript shows exactly which Tool Call went wrong, which is worth more
than any amount of retrying with a different provider.