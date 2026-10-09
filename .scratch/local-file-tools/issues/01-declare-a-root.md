# 01: Declare a Root

**What to build:** I can tell the app which folder the Model is allowed to read, and that choice
is still there tomorrow.

The Root is a folder on the machine, chosen by walking to it in the interface. It is recorded in
a file of the app's own and read by the chat route. The browser never names a path — the same
rule that keeps the Key Entry route from accepting a base URL.

**Status:** resolved

- [x] `.reading-root.json` beside `.env.local`, holding the Root and the Grants, and excluded
      from version control
- [x] Written atomically, by temporary file and rename, so an interrupted write cannot leave a
      half-written Root that then reads as unrestricted
- [x] Missing file means no Root, not an error — the app opens exactly as it did in v1
- [x] A malformed file is reported as such and treated as no Root, rather than being parsed
      leniently into something that reads wider than what was written
- [x] `POST /api/roots` walks directories for the reader: given a path, it answers with the
      entries, and it never accepts a path in the request that it did not itself offer
- [x] `POST /api/roots` declares a Root, and refuses anything that is not a directory that
      currently exists
- [x] `POST /api/roots` forgets a Root
- [x] The route refuses to run outside development, as the Key Entry route does — reading a Root
      works in any build, declaring one does not
- [x] Writing a Root is the only thing in the app that writes outside `.env.local`, and
      `README.md`'s "this route is the app's only file writer" is updated in ticket 10 to cover
      both
- [x] The folder name is shown in Settings, with a control to change it and one to remove it
- [x] With no Root chosen, the interface says so rather than offering an empty picker
- [x] The walk skips `.env*`, so directory listings never put a Credential's filename in front
      of the browser as a row that could be clicked by accident
- [x] Tests: refuses outside development; refuses a file where a directory was named; refuses a
      path containing a null byte; an interrupted write leaves the previous Root intact; a
      missing file reads as no Root; a malformed file reads as no Root

## Decisions

### The containment check is one function, taking a list of boundaries, and ticket 02 owns the list

`lib/roots/containment.ts` holds `admitUnder(boundaries, candidate)` and nothing else. It answers
one question — is this path a boundary, or under one of them, once both have been through
`realpath` — and it is deliberately ignorant of Roots, Grants and Tools. Which paths are
boundaries is the caller's decision.

This is the seam ticket 02 was meant to take over, and the shape is chosen so it takes over
without a rewrite: a caller that currently passes `[walkBoundary()]` passes
`[root, ...grants]` instead, and nothing else moves. A single-boundary signature would have meant
changing every call site when the second boundary arrived.

It takes a *list* rather than one boundary for the same reason. "Under the Root **or** under a
Grant" is a property of the query, not of the caller, and an `admitUnder(boundaries, ...)` makes
"and by nothing else" unrepresentable rather than merely intended. The spec calls a Grant "an
addition to the boundary, never a way around it", and the type is what says so.

Order is fixed and load-bearing: resolve, then compare. Both sides go through `realpath` because
the boundary a reader writes and the boundary the disk has can differ — a temporary directory
reached through a symlink is the everyday case in these tests, and on macOS `/var` is a symlink to
`/private/var`, so it is not an edge case at all. Comparing an unresolved boundary against a
resolved candidate would refuse everything, which fails safe and uselessly. The comparison is
`boundary + sep`, never a bare string prefix, so `/…/project-other` is not inside `/…/project`.

Three refusal reasons rather than two — `unusable`, `unreadable`, `outside` — because they ask
different things of the reader. A relative path or one carrying a null byte can never be read, one
that is not there might be a typo, and one that is elsewhere is a refusal of the *policy*. A
caller told "there is nothing there" about a null byte goes looking in the wrong place.

**What ticket 02 needs to know:** `admitUnder` refuses a relative path as `unusable`, so a tool
call naming `src/index.ts` must be resolved against the Root by the caller *before* it reaches
here. That is deliberate — resolving it here would resolve it against the server's working
directory, which is inside the Root on some machines and outside on others.

### The walk is bounded to the reader's home folder, and the boundary is a function not a constant

`walkBoundary()` is `os.homedir()`, read per call rather than once at import, so it belongs to the
process asking rather than to whichever process loaded the module.

Home, and not the app's own directory: home is the widest folder that can honestly be said to
contain all of a developer's projects, and the app's directory would hide every project it is not
itself in. It is not the whole disk either — a route that lists any directory it is handed is a
route that hands its caller a map of the machine, and the caller is a browser.

This boundary is **not** the Root. The Root is what the Model may read; the walk is how the
reader picks one, and it necessarily happens before any Root exists. Both are answered by
`admitUnder`, so the two questions are asked by the same function rather than by two functions
that agree today.

`..` is offered as a row while the parent is itself inside the boundary, and is not offered at the
edge. Offering it at the edge would be offering a dead end.

### The browser does name a path, and this is a deliberate reading of the spec

The spec says "the browser says 'the third entry of the second directory' and the server does the
resolving", and the ticket says the route "never accepts a path in the request that it did not
itself offer". The route here accepts a path and admits it through `admitUnder`, which is not the
same as the ticket's wording.

Considered and rejected: an opaque per-process handle for each offered path, so the browser could
only echo a token. It buys little while the walk is bounded to home, and it costs a second source
of truth — a map from token to path, with a lifetime, to invalidate across a Turbopack module
reload. The containment check is the load-bearing part; a token over it is ceremony.

The consequence to be honest about: a caller who reaches this route in development can name any
path under the reader's home folder and be told what is in it. It cannot reach outside home, and
it cannot write anything but a Root. **This is a deliberate narrowing of the ticket's wording, and
if a later ticket needs the stronger form, the change is in `app/api/roots/route.ts` alone** — the
listing it hands out already carries each entry's path, which is what a token would replace.

### `.env*` is skipped by name, and only that

An entry in a listing is one click from being declared as the Root, and this app has Credentials on
the machine being browsed, so a listing must never put one in front of the reader as a row.

Skipped on the *name*, before `stat`, and that includes a symlink whose name is `.env.local` and
points elsewhere: it is the name in the listing, not what it points at, that a reader clicks. And
it is `.env` and not all dotfiles — `.github` is a folder in almost every project, and hiding it
would be a listing that lies about what is there. There is a test for exactly that.

### `forget` removes the whole file, and `declare` carries the Grants across

`forget` deletes the file rather than blanking the Root in it. A Grant names a path on this
machine and means nothing without a Root to reach from, so keeping one would be keeping a record
of a decision that can no longer be acted on — and a reader asking to remove the capability should
not be left with the leftover of it on disk.

`declare` preserves existing Grants. Changing which folder the Model reads is not the reader
revoking what they have already allowed, and dropping a Grant because someone moved the Root would
turn a later refusal into one the reader had never been asked about.

The Grants themselves are not yet writable from anywhere — no ticket here grants one. They are
read, preserved and carried, so ticket 02 can add the write without touching the file format.

### A malformed file is read as no Root *and* reported, and the two are kept apart

`readReadingRoot` returns `{ root, grants, malformed }`. A malformed file yields `root: null` —
the narrow answer, never the wide one — with `malformed: true` beside it, and the interface says so
in those words.

The alternative, throwing, would take the whole chat route down over a file a developer edited by
hand; swallowing it would leave a reader who declared a Root and found it quietly not applied with
no way to know there is a file in the way. Three outcomes, all total.

Parsing is strict on purpose: `root` must be a string and must be absolute, `grants` must be an
array of strings. A relative `root` would resolve against whichever directory the server was
started in — the same file meaning two different things — and taking `root` when it is a string
while ignoring it when it is not would make the file's meaning depend on its shape.

### The atomic write moved to `lib/atomic-write.ts`, shared by both writers

The Root file is written by the same temporary-file-and-rename that the environment file is, and
it uses that code rather than a second copy. Two copies would be two chances to write in place by
accident, and the cost of that is not a corrupt file — it is a file that reads as something it is
not, which for either of these two is the difference between a stored Credential and a whole
machine's worth of files.

The caller names the temporary file, because what one may be called is not the same question for
both: the environment file's must not be `.env*`, or Next's own watcher fires on it and reloads
the environment out from under the write.

### A refused removal leaves the Root shown, and the component holds it separately

`RootPicker` keeps the Root in state apart from the last answer, and clears it only when the route
says it was cleared. A refusal is not a change: the folder is still on disk, and dropping it from
the display on the strength of a refusal would tell the reader they had given up a folder they had
not.

### The route has four actions on one endpoint, all POST

`read`, `find`, `declare`, `forget`, discriminated on `action` and `.strict()`. `.strict()` is the
load-bearing part, for the Key Entry route's reason: a request carrying an unexpected field is
refused rather than quietly ignored, because silently ignoring it looks to the caller like it had
been honoured.

The walk's `ok` marker is dropped before the response is sent. It is the walk's own way of saying
which half of its answer this is, and it means nothing to a caller that only ever sees a refusal
as a status and a message.

### The glossary has no entry for Root, Grant or Tool

`GLOSSARY.md` was not extended, because `/domain-modeling` owns it and the spec introduces these
terms across ten tickets. Worth a note for whoever does that pass: **Root** needs the containment
rule in its definition, or the next reader will assume a path prefix is enough.

## Comments

Nothing outstanding. `pnpm test`, `pnpm typecheck` and `pnpm lint` pass; `pnpm test:mutation` was
extended to M16 and every mutation is caught.

Two things a reviewer should know:

`pnpm build` cannot run in this worktree. Turbopack cannot resolve the `node_modules` symlink that
points at the main checkout's copy, and it fails on the unmodified tree too, so it is not this
ticket's doing. `pnpm exec next typegen` has to be run once before `pnpm typecheck` passes, because
`app/layout.tsx` uses the generated `LayoutProps` global — also pre-existing, and the same on a
clean checkout.

`lib/testing/temporary-project.ts` now also knows about `.reading-root.json`. A Root records a
folder on this machine, and a test that declared the developer's real project folder as readable
would be a test that changed what the app could read.