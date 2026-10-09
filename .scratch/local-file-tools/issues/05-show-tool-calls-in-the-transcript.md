# 05: Show Tool Calls in the transcript

**What to build:** I can see which files went into the answer.

A Conversation that can read the disk and does not say so is the one failure this feature cannot
have. The reader has to be able to tell what the answer was based on, and which Endpoint it was
based on it at.

**Blocked by:** 03 — The three Tools

**Status:** ready-for-agent

- [ ] Tool parts render in the transcript rather than being filtered out — `Turn` currently
      keeps only text parts, so a Tool Call is invisible until this changes
- [ ] Each shows what was asked for, in a collapsed row that fits on one line: the Tool's name and
      the path
- [ ] It can be opened to show what came back, so a reader can check a cited line rather than
      taking it on trust
- [ ] A file outside the Root that was covered by a Grant appears marked as automatically
      approved, rather than arriving like a read inside the Root
- [ ] A file outside the Root that the reader denied appears as denied, with its path — so the
      reader can see what was refused and allow it next Turn if they were being cautious
- [ ] A Tool still running is visibly running, since a read of a large file is a pause that would
      otherwise look like a stalled app
- [ ] A Tool that failed says so in the transcript, in the same reader-safe voice as the rest of
      the app's failures
- [ ] Rows are identifiable by a structural hook the way `data-turn` already is, rather than by
      a class name or a radius, so a test does not pin the styling
- [ ] The rows sit inside the Response they belong to, not as Turns of their own — a Tool Call
      is part of one Turn's answer
- [ ] Tests: a completed read renders with its path; a denied read renders as denied; a running
      read renders as running; a failed read renders its message and no content

## Decisions

_Recorded once resolved._

## Comments