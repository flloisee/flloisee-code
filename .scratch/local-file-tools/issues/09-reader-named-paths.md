# 09: Reader-named paths

**What to build:** I can paste a path into a message, and if it is outside the folder I chose I
am asked before the message is sent.

The other half of naming a file. `@` searches the Root; a pasted path is for a location the
reader already knows, which may well be outside it.

**Blocked by:** 02 — Containment, 04 — Wire the Tools into the chat route, 06 — Answer Approval
Requests

**Status:** resolved

- [x] A pasted or typed path is recognised in the composer and checked as it is entered
- [x] Inside the Root, or under a Grant, it resolves and says so — no interruption
- [x] Outside both, the ask appears **in the composer, before the Turn exists**: allow, always
      allow, deny. The same three answers as a Tool Call's approval, and the same Grants
- [x] The ask is a different moment from a Tool Call's approval and is presented as the
      reader's own decision, because the reader named the file and the Model did not ask
- [x] The check happens again at send. A file deleted, or a Root changed, between paste and send
      is refused with a 400 naming the file — not sent with the contents silently missing
- [x] A path outside the Root is never read before it is allowed, not even to tell the reader what
      kind of file it is
- [x] A directory named this way sends its listing rather than its contents
- [x] The file's contents are placed in the message as text, with a delimiter saying which file
      they came from — not sent as a file part, because most of the 189 Endpoints would not take
      one
- [x] An unreadable file — deleted, a permission failure, binary, over the cap — is reported in
      the message rather than sending an empty block
- [x] Several files can be named in one message
- [x] The reader can see which files a message is about before sending it
- [x] A Turn's bytes are whatever the reader attached and whatever the Model read, sent to
      whichever Endpoint was selected. The interface says which Endpoint that is at the moment
      the files are named, not only later in the transcript
- [x] Tests: a path inside the Root resolves silently; one outside raises the ask before send;
      "always allow" records a Grant and the next message proceeds; a file deleted between paste
      and send is refused naming it; the same containment function refuses it as would refuse a
      Tool Call for the same path

## Decisions

**A path is recognised by its shape, and the shape has to be unambiguous.** `namedPaths` in
`lib/roots/named-path.ts` is one pure function, used by the composer and by the chat route, and
it takes a token as a path only when the token is absolute (`/…`, never `/` on its own), or
explicitly relative (`./…`, `../…`), or carries a `/` with an extension somewhere along it
(`src/util.ts`, `a/b.txt`), or carries two or more separators (`src/deep/nested`), or is a single
name with an extension (`notes.md`, `package.json`). Punctuation around a word is trimmed first,
so `read "notes.md".` names `notes.md`, and a leading `@` is trimmed too, because the `@` menu
holds `@src/util.ts` while it is open.

What it refuses, each by a stated rule rather than by hoping: one separator and no extension
anywhere is two words with a slash between them (`and/or`, `I/O`, `yes/no`, `3/4`, `src/util`); a
single-segment name needs a segment of two characters or more (`e.g.`, `i.e.`, `U.S.` fail,
`README.md` passes) and an extension starting with a letter (`1.2.3` is a version); a `scheme://`
is an address; one `@` with no separator and nothing empty is an email address
(`node_modules/@scope/pkg` is not — it has a separator); anything over 1024 characters or holding
a control character is not a path the disk could hold.

**`~` and `~/` are expanded; a tilde that is not home shorthand is not.** The first pass refused
all of them, on the reasoning that `~` in prose ("~5 files") is not rare and that expanding it
hands the server's home directory to a token the reader typed. That reasoning was about the risk
of expansion, and it was answered by refusing the common case rather than by narrowing the rule
— so `~/notes.md`, which is how a developer writes a path outside the project folder, did not
name a file at all.

The narrower rule is that `~` and `~/` expand and everything else beginning with a tilde stays
English, which the existing rules already refuse on their own. Expanding grants nothing: the
result is an ordinary absolute path that then goes through containment like any other, so
`~/notes.md` asks the reader in exactly the way `/Users/me/notes.md` does. It is a home directory
on a single-user local app whose own walk is already bounded to that same home.

The expansion lives here rather than in `resolveAgainstRoot`, which the approval policy and the
three Tools share, so it touches nothing the Model can reach: a path the Model names is never
run through a tilde rule. `~/` returns the home directory with no trailing separator, since
`/Users/me/` is a different string from `/Users/me` and would not compare equal to it.

**The cost of that conservatism: a bare folder name is not a path.** The `@` menu offers folders
and inserts their Root-relative name, so picking `src` puts the word `src` in the message and
this recogniser leaves it alone. A directory named as `./src`, as `src/deep`, or as an absolute
path sends its listing, which is what the ticket asks for; a single bare segment does not. The
alternative — treating any single word as a path — turns "what does the composer do" into a file
request, which is the failure this ticket is most exposed to. Recorded rather than hidden, and
`lib/roots/named-path.test.ts` states it as a test so a later change to it is deliberate.

**The recheck is the server's, and it is a recheck rather than a repetition.** The chat route
calls `attachNamedFiles`, which runs the *same* `namedPaths` over the *same* message text and
puts every path it finds through `mayRead` — the one function the three Tools ask. Nothing about
which paths are looked at arrives in a field: the request carries a message, the recogniser finds
paths in it, and containment decides. This does not reopen the property ticket 04 closed. That
property is *no path is read from a request into the filesystem*; what a request supplies here is
prose, and the paths are derived from the prose on the server by the same code the Tools are
bounded by. A caller who wanted an arbitrary file read would have to get `mayRead` to say yes,
and the only ways to do that are to be inside the Root, to be under a Grant the reader recorded,
or to be a path the reader allowed in this process — none of which the caller controls.

**Containment fails the Turn; the read does not.** A path that is outside the Root, gone, or no
longer resolvable is a **400 naming the file**, and nothing is sent to the Endpoint at all. A
path that is admitted and then cannot be turned into text — binary, past the byte cap — is
**reported in the message** as a block naming the file and saying what happened, so the Model can
tell the reader why it cannot see something they attached. The ticket lists a deleted file under
both; the line drawn is admission, and either way nothing is ever sent as an empty block. What
is refused in the read is `readNamedFile`'s own refusal, unchanged: the same binary check, the
same `MAX_FILE_BYTES`, the same sentence, because `readNamedFile` and `listNamedFolder` were
lifted out of the Tools' `execute` bodies and both callers now run the same code.

**"Allow once" and "Deny" are held by the server, in this process, until the next send.** They
cannot come from the request: a decision in the request body is a caller naming the path to be
read, which is exactly the primitive the chat route refuses to be. So they are recorded by
`/api/roots` — behind its existing development guard, alongside "always allow", because one place
decides whether a reader can widen the boundary at all — into `lib/roots/named-decision.ts`, a
module-level record that `takeDecisions()` empties once per send. Two consequences, both
intended: a deployed build cannot mint a decision, in the same words and for the same reason it
cannot write a Grant; and an allowance does not survive a restart, which is the same posture the
per-process approval signing secret already takes — it re-asks, which is the correct failure.
"Always allow" is unchanged: it writes a Grant through `grantPath` and lasts.

**Decisions are keyed by the path as the reader wrote it.** The recogniser is the same function on
both sides, so the string the composer asked about is the string the send looks up. Keying on
anything the server worked out for itself would let the answer to one question be found under a
spelling the reader was never shown.

**Deny does not end the Turn.** A refused path becomes a block in the message saying it was left
out, and everything else the message named still goes. The row's name is the reader's own
spelling, because the canonical name the Tools use comes from the disk and asking the disk is
what was refused.

**The block names the file as the Tools name it.** `[file: src/notes.md]` … `[end of file:
src/notes.md]`, Root-relative inside the Root and absolute under a Grant, from the same `namer`
the Tools use — so the Model is handed a name it can ask about rather than a second spelling,
and the Root is not spelled out in the reader's own Conversation. Both ends carry the name because
the Model has no parser to fall back on: the line that says where the file ends is the only thing
marking it. A file's own lines carry the same numbering `read_file` gives, so a line the Model
cites is a line the reader can find.

**Only the last message the reader wrote is rewritten, and only for the copy the Endpoint
receives.** The bubble in their Conversation keeps their own words, and the Turns before this one
are history that has already been dealt with. A message naming nothing is left exactly as it was —
the arrays are not even rebuilt — so a Conversation with no file in it is byte-for-byte the
Conversation it was before this feature.

**With no Root declared, nothing is attached and nothing is refused.** There are no boundaries, so
there is nothing a named path could cross, and the Turn is the one it was in v1. The composer
already says "you have not chosen a folder" before the reader gets there.

**The ask borrows ticket 06's answers and nothing else.** The three buttons are "Allow once",
"Always allow", "Deny", in that order, with the same classes; the three sentences they settle into
(`ALLOWED_ONCE`, `ALLOWED_ALWAYS`, `READ_REFUSED`) were moved out of `components/approval-answer.tsx`
into `lib/chat/approval-answer.ts` and are now written down once for both places. What is new is
the sentence above them — "You named this, and it is outside the folder you chose for the Model
to read, so nothing is sent until you say so" — because that is the whole of what makes this a
different moment, and a sentence about the Model would claim an agency that is not there.
The same routing, the same Grants, the same `/api/roots` guard.

**The ask holds Send down, the way an unanswered Tool Call does.** A Turn started behind an open
question would send a message the reader has not finished agreeing to. "Deny" is on the row beside
them, so refusing one file never refuses the whole message.

**The row and the `@` menu never appear at once.** Both are placed against the composer, and while
an `@` is being typed the words after it are half a filename. The menu closes the moment a name
is chosen and the row it left behind is then the answer.

**`POST /api/files` gained a `reason` on its refusals, and nothing on its successes.** The
composer has to *act* on one refusal and merely *say* the rest, and it cannot tell them apart from
the prose. `outside` is the one that becomes a question. The success body is untouched — a caller
that sent something this app does not understand is told so, not handed a shape it might act on.
`resolve` with no Root now says `no-root` rather than passing `mayRead`'s `outside` through, since
`mayRead` answers `outside` for everything when there are no boundaries and that is true of
containment and wrong of the interface.

**A turn's own bytes are named where the file is named.** `data-in-use` above the composer already
read out the Endpoint and Model; with a file in view the reader reads the destination and the
question in the same glance. The sentence the spec puts in the README's Proxying section is now
there.

**Not done deliberately: entries in `scripts/mutation-check.sh`.** The spec asks for one per
containment guard, and the two guards this ticket adds were checked by hand instead — removing
the `mayRead` recheck fails 6 tests in `app/api/chat/named-paths.test.ts`, and making the
recogniser find nothing fails 18 across the route and the composer. The script currently mutates
two named files and hard-codes them, and six worktrees editing it in parallel is a merge hazard
the integration owner should own. The evidence is in the report rather than in the script.

**Not touched: the README's API table.** It still says "Four Route Handlers" and lists none of
`/api/files` or `/api/roots`, which is a gap opened by tickets 01–08 and not by this one.

## Comments
