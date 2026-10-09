# 02: Containment

**What to build:** Nothing outside the Root can be read, whatever the Model asks for and
whatever the caller sends.

This is the ticket the rest of the feature leans on. It is the app's own logic, it is the only
thing between a document on disk and a Cloud Endpoint, and it is worth more tests than anything
else here.

**Blocked by:** 01 — Declare a Root

**Status:** resolved

- [x] One function decides whether a path may be read. Every caller goes through it — the Tools,
      the `@` menu, the pasted-path check, and the send-time recheck
- [x] The path is resolved with `path.resolve` and then with `fs.realpath`, in that order, and
      only then compared — so a symlink inside the Root pointing out of it is refused rather
      than followed
- [x] Admitted only when the real path is the Root itself, or sits under `Root + sep`
- [x] A path that merely shares a prefix string with the Root is refused — `/Users/me/project-old`
      against a Root of `/Users/me/project`
- [x] A Grant is an additional admitted prefix, held as an absolute resolved path, put through
      the same comparison. A path is admitted by being under the Root or under a Grant, and by
      nothing else
- [x] A Grant cannot be walked out of: `grant/../secrets` is resolved before the comparison
- [x] Symlinks are not followed out of the Root even when a Grant names their target
- [x] The decision says *why* it refused — outside the Root, outside every Grant, or not found —
      because each asks the reader something different and the Model reports it back
- [x] Tests for each of: `..` climbing out; an absolute path elsewhere; a shared-prefix path; a
      symlink out; a symlink chain out; the Root itself; a path inside a descendant directory; a
      path under a Grant; a sibling of a Grant; a path above a Grant reached by `..`
- [x] Every one of those guards is added to `scripts/mutation-check.sh`, one mutation per guard,
      because a containment test that passes whether or not the check is there is worse than no
      test — it reads as evidence

## Decisions

### `lib/roots/readable.ts` — `mayRead`, and the shape later tickets call

```ts
export type Boundary = "root" | "grant";

export type Readable =
  | { readable: true; path: string; under: Boundary }
  | { readable: false; reason: Refusal };

export function resolveAgainstRoot(root: string, asked: string): string
export async function mayRead(reading: ReadingRoot, asked: string): Promise<Readable>
```

One thing to be honest about on the first checkbox: the four callers it names — the three Tools,
the `@` menu, the pasted-path check and the send-time recheck — **do not exist yet**. They are
tickets 03, 04, 08 and 09. What this ticket delivers is that there is exactly one function that
can answer the question, nothing else in the app answers it, and the two functions that do touch
the disk on a path a caller named (`walk.ts` and `app/api/roots/route.ts`) are answering a
different question and say so. A ticket that wants to reach the disk on the Model's behalf now has
one place to go, and that place is the point of the ticket.

`mayRead` takes the whole `ReadingRoot` rather than a Root and a list of Grants, because reading
the file and answering from it is one step and every caller would otherwise repeat the same two
lines. It answers about the **Root's** reach, and the three refusal reasons carry through from
`containment.ts` untouched: `unusable`, `unreadable`, `outside`.

A caller must open `answer.path` and nothing else. On a yes that is the **resolved** path, not
the string the Model sent — a path reached through a link may stop pointing where it did between
the check and the read, so a caller that opens what it was *asked about* can be moved in the gap
and one that opens what it was *handed* cannot. There is a test that says so.

`under` is on the answer because the reader's next step is not the same either way: a read inside
the Root happens without asking, and one under a Grant is shown as already allowed (ticket 06
builds the ask; this is the fact it asks about). It costs one field and it is not recoverable by
a caller afterwards — see the next decision.

### `admitUnder` now names which boundary answered

`Admission`'s admitted variant carries `boundary: string` beside `path`, and it is the boundary
**as the caller wrote it**, not as the disk has it. Two reasons, and both are load-bearing:

- A caller told only the resolved path cannot tell which of its boundaries answered. On this
  machine they are different strings for every temporary directory in every test (`/var` ->
  `/private/var`), so this is not a rare edge.
- "Inside the Root" and "under a Grant" are different decisions for the reader, and `mayRead`
  cannot re-derive which one happened without asking the question a second time — which is
  exactly the second set of answers the ticket is trying not to create.

Boundaries are tried in the order given, so `[root, ...grants]` names the Root wherever the two
overlap. That is why the ordering matters and why `mayRead` builds the list itself rather than
letting a caller pass a Grant before the Root.

This is an addition to ticket 01's `Admission`, not a change to what it decides. Every existing
caller is a walk with one boundary and ignores the field.

### The boundary list is one list, `[root, ...grants]`, and not a Root checked then each Grant

A Grant is an addition to the boundary and never a substitute for it, and the failure mode of
asking the question twice is specific: a caller who checks the Grants and forgets the Root reads
**nothing** while believing it reads the folder the reader chose — a silent refusal, which is the
one failure a reader cannot diagnose. `admitUnder(root, …) or admitUnder(grant, …)` cannot
express "and by nothing else"; `[root, ...grants]` cannot express anything else. That is the
whole reason ticket 01 made the primitive take a list, and this is the ticket it was waiting for.

With no Root, `mayRead` returns `outside` and admits nothing — including where a Grant would
have. A Grant is reached *from* the Root, and a machine with no Root is a machine that has granted
nothing, which is the answer v1's behaviour depends on. There is a test that says so, and M24 is
the mutation that removes it.

### `path.join` is not used to resolve a relative path, and the difference is a test

`admitUnder` refuses a relative path as `unusable`, on purpose: resolving one there would resolve
it against the server's working directory, which is inside the Root when the server was started in
it and outside on every other machine — one call meaning two different things. So the caller
resolves it, and `resolveAgainstRoot` is the one function that does.

It **concatenates** rather than using `path.join`, and this is the decision most worth arguing
with. `path.join(root, "link/../src")` collapses to `root/src`, but the disk does not read it that
way: it follows `link` first and applies the `..` where the link landed. So with a symlink
`root/link -> <elsewhere>`, `link/../src` resolves to `<elsewhere>/../src` — outside — and
`path.join` would have substituted the Root's own `src` for it and admitted that instead. Joining
by concatenation leaves the `.` and the `..` in the string for `realpath`, which resolves them the
way the kernel will.

`.` is left in the string for the same reason. `realpath` handles it; there is nothing to gain by
tidying one case of a path that has to be handed over untidied in the other.

### The walk deliberately does **not** go through `mayRead`

`walk.ts` and `app/api/roots/route.ts` both call `admitUnder` directly with a single boundary, and
that is correct rather than an oversight. The walk is how the reader *chooses* a Root, so it
necessarily happens before any Root exists — and its boundary is the reader's home folder, which
is wider than the Root by construction. Routing it through `mayRead` would mean the walk reads
nothing at all until a Root has been declared, and the Root picker would have nothing to pick from.

So there are two boundaries and one comparison, not two comparisons. The split is by *question*,
not by accident: `mayRead` answers "may the Model read this", and it is the only function that
answers it. `admitUnder` answers "is this path under one of these", and knows nothing about
Roots, Grants or Tools — which is what keeps a change to what a Root is from widening anything.

### `path.resolve` is not used to resolve the candidate, and the reason is the order

The ticket and the spec both say `path.resolve` then `fs.realpath`. Ticket 01 recorded `realpath`
on its own, and that decision stands: `resolve` is a lexical operation, so `resolve(root/link/../x)`
collapses the `..` before the link is ever followed — the same substitution `path.join` would
make, in a place where it is harder to see. `realpath` resolves `..` the way the kernel does
because it *is* the kernel's resolution.

What the ticket is actually asking for, and what is tested, is the **order**: resolve with the
disk first, compare second, never the reverse. `lib/roots/readable.test.ts` has a test where a
link inside the Root points at a folder beside it and `link/../src` arrives outside, and a second
one where the same link points at a folder a Grant covers and the read is admitted *as the
Grant's* — reported as `under: "grant"`, never as `under: "root"`, because the path is not inside
the Root and saying otherwise would let the reader believe it is.

### A path through a file is `unusable`, and the test for it was missing until the mutation was

`resolveOrRefuse` distinguishes `ENOENT` (nothing there — a typo) from anything else (a path that
could not be read as written). The null-byte case and the relative case both reach that `else`
via the guard above `realpath`, so the *branch* was covered and the **ternary** was not: M19
replaced `codeOf(error) === "ENOENT" ? "unreadable" : "unusable"` with a flat `"unreadable"` and
**nothing failed**, because no test produced a non-`ENOENT` error from `realpath` itself.

Fixed by adding the case that produces one — a path that goes *through* a file answers `ENOTDIR`,
and `<root>/README.md/notes.md` is refused as `unusable` rather than as "there is nothing there".
The reader's next step differs: something is at that path and it is a file, so a refusal saying
nothing is there sends them looking for a folder that was never going to be there either. M19 is
now caught, and it is caught by a test that would have failed for the right reason.

### Ticks: what was already met, and how I checked

Most of the comparison is ticket 01's, verified by reading `lib/roots/containment.ts` and its 233
lines of tests rather than assumed. The real-path-before-compare rule (M13), `Root + sep` (M14),
the boundary-itself admission, `..` climbing out, a shared-prefix sibling, a symlink out, a
symlink chain out, a relative-path refusal, a null byte, and a boundary that cannot be resolved
were all present and covered before this ticket started. Each is in the mutation script and each
mutation is caught.

What ticket 02 added: `mayRead` and `resolveAgainstRoot`; the Grant in the boundary list; `under`
on the answer; `boundary` on `admitUnder`'s answer; the `..`-after-a-link test; the Grant tests
(sibling of a Grant, above a Grant, through a link into a Grant, the Grant alone not being enough);
the no-Root cases; the `ENOTDIR` case; and M17–M24 in the mutation script.

Two things the ticket did not anticipate, recorded here rather than decided silently:

**A Grant nested inside the Root.** Nothing forbids it, and the answer is that the Root wins,
because the list is ordered Root-first and the first boundary to answer is the one reported. The
reason is the reader's: a read inside the Root needs no approval, so calling it a Grant's would
raise an ask the reader has already answered by choosing the Root. Tested in `containment.test.ts`
("names the first boundary that answered") and in the Grant section of `readable.test.ts`.

**A Grant that is not a path.** `readReadingRoot` validates that the Root is absolute but only
that a Grant is a string, because no ticket grants one until 06. `admitUnder` skips a boundary it
cannot resolve, so a relative Grant in the file admits nothing rather than resolving against the
working directory — the narrow answer, for the same reason the relative candidate is refused. That
is the correct behaviour today and it is *also* the behaviour a later ticket gets for free, so the
test asserts it. Ticket 06 should still write absolute resolved paths, which it will get from
`mayRead`'s own answer.

The glossary has no entry for Root, Grant or Tool, as ticket 01 recorded. `/domain-modeling`
still owns it. Worth carrying forward: **Root** needs the containment rule in its definition, and
Grant needs "an addition to the Root, never a substitute for it" — the code says both in comments,
but a reader who meets the word in a test name first will assume a path prefix is enough.

## Comments