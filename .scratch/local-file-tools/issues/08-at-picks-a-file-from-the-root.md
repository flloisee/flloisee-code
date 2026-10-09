# 08: `@` picks a file from the Root

**What to build:** I can type `@` in the composer and pick a file from the folder I chose,
rather than typing its path from memory.

**Blocked by:** 01 — Declare a Root, 03 — The three Tools (for the walk it shares)

**Status:** ready-for-agent

- [ ] Typing `@` in the composer opens a menu of files from the Root
- [ ] The menu filters as I keep typing, on the part of the path after the `@`
- [ ] Arrow keys move through it, Enter picks, Escape closes it — and the keys do what they
      normally do in a textarea when the menu is closed
- [ ] Directories are listed alongside files, and picking one inserts its path rather than its
      contents
- [ ] Paths are inserted relative to the Root, so what appears in the message is short enough to
      read and is not the reader's home directory spelled out in their own Conversation
- [ ] The menu never offers anything outside the Root, and the search it performs is bounded the
      same way `search_files` is
- [ ] It reuses the Root walk rather than growing a second implementation of "look through the
      Root"
- [ ] With no Root chosen, `@` says so rather than opening an empty menu
- [ ] With a Root that has nothing matching, the menu says so rather than closing silently
- [ ] The menu does not steal the caret: typing, selecting and undoing still behave in the
      composer underneath it
- [ ] The menu is reachable by keyboard alone, and announced as a listbox — it is the only way to
      name a file without typing a path, so it cannot be mouse-only
- [ ] Tests: `@` filters to the Root; keyboard navigation and selection; Escape closes and
      restores the composer text; inserting a path that then resolves; nothing outside the Root
      is ever offered; the empty and no-Root cases say so

## Decisions

_Recorded once resolved._

## Comments