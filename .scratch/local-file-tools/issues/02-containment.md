# 02: Containment

**What to build:** Nothing outside the Root can be read, whatever the Model asks for and
whatever the caller sends.

This is the ticket the rest of the feature leans on. It is the app's own logic, it is the only
thing between a document on disk and a Cloud Endpoint, and it is worth more tests than anything
else here.

**Blocked by:** 01 — Declare a Root

**Status:** ready-for-agent

- [ ] One function decides whether a path may be read. Every caller goes through it — the Tools,
      the `@` menu, the pasted-path check, and the send-time recheck
- [ ] The path is resolved with `path.resolve` and then with `fs.realpath`, in that order, and
      only then compared — so a symlink inside the Root pointing out of it is refused rather
      than followed
- [ ] Admitted only when the real path is the Root itself, or sits under `Root + sep`
- [ ] A path that merely shares a prefix string with the Root is refused — `/Users/me/project-old`
      against a Root of `/Users/me/project`
- [ ] A Grant is an additional admitted prefix, held as an absolute resolved path, put through
      the same comparison. A path is admitted by being under the Root or under a Grant, and by
      nothing else
- [ ] A Grant cannot be walked out of: `grant/../secrets` is resolved before the comparison
- [ ] Symlinks are not followed out of the Root even when a Grant names their target
- [ ] The decision says *why* it refused — outside the Root, outside every Grant, or not found —
      because each asks the reader something different and the Model reports it back
- [ ] Tests for each of: `..` climbing out; an absolute path elsewhere; a shared-prefix path; a
      symlink out; a symlink chain out; the Root itself; a path inside a descendant directory; a
      path under a Grant; a sibling of a Grant; a path above a Grant reached by `..`
- [ ] Every one of those guards is added to `scripts/mutation-check.sh`, one mutation per guard,
      because a containment test that passes whether or not the check is there is worse than no
      test — it reads as evidence

## Decisions

_Recorded once resolved._

## Comments