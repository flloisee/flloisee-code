# 08: `@` picks a file from the Root

**What to build:** I can type `@` in the composer and pick a file from the folder I chose,
rather than typing its path from memory.

**Blocked by:** 01 — Declare a Root, 03 — The three Tools (for the walk it shares)

**Status:** resolved

- [x] Typing `@` in the composer opens a menu of files from the Root
- [x] The menu filters as I keep typing, on the part of the path after the `@`
- [x] Arrow keys move through it, Enter picks, Escape closes it — and the keys do what they
      normally do in a textarea when the menu is closed
- [x] Directories are listed alongside files, and picking one inserts its path rather than its
      contents
- [x] Paths are inserted relative to the Root, so what appears in the message is short enough to
      read and is not the reader's home directory spelled out in their own Conversation
- [x] The menu never offers anything outside the Root, and the search it performs is bounded the
      same way `search_files` is
- [x] It reuses the Root walk rather than growing a second implementation of "look through the
      Root"
- [x] With no Root chosen, `@` says so rather than opening an empty menu
- [x] With a Root that has nothing matching, the menu says so rather than closing silently
- [x] The menu does not steal the caret: typing, selecting and undoing still behave in the
      composer underneath it
- [x] The menu is reachable by keyboard alone, and announced as a listbox — it is the only way to
      name a file without typing a path, so it cannot be mouse-only
- [x] Tests: `@` filters to the Root; keyboard navigation and selection; Escape closes and
      restores the composer text; inserting a path that then resolves; nothing outside the Root
      is ever offered; the empty and no-Root cases say so

## Decisions

_Recorded once resolved._

**The route is `app/api/files/route.ts`, POST only, two actions: `find` and `resolve`.** It
writes nothing and has no development guard, because the thing that bounds it is the Root rather
than the build: a deployed server cannot declare a Root, so it cannot widen one, and every path it
is about went through `mayRead` before anything was read. That is the difference from
`app/api/roots/route.ts` stated exactly rather than as "reading is safe, writing is not" — that
route records a folder on the developer's machine, which is a capability a deployed build must not
have. **Nothing in this ticket wanted a write**, and if a later one does, it belongs in the Root
route; reaching across for one is the signal that the action is in the wrong place.

**`find` never puts the Root's own address on the wire.** Every path it answers with is
Root-relative, so the browser is not told where the folder is at all, and what lands in a
Conversation is what the reader chose to point at. The ticket asked for short paths in the
message; withholding the address entirely is the same property with a second benefit, and it is
why `find`'s answer carries no `root` field at all.

**The contract, in full, because ticket 09 builds on it.** Both actions take one field beyond
`action` and refuse anything else with a 400.

```
POST {"action":"find", "query": string}          query is the words after the `@`, "" allowed
  200 {"rootDeclared": boolean,
       "matches": [{"name": string, "path": string, "kind": "file"|"directory"}],
       "complete": boolean,
       "note": string}
  400 {"error": string}                          outside | unreadable | unusable | the Root is gone

POST {"action":"resolve", "path": string}
  200 {"path": string, "under": "root"|"grant", "kind": "file"|"directory", "size": number|null}
  400 {"error": string}
```

`path` is Root-relative when `under` is `"root"` and **absolute** when `under` is `"grant"`. The
asymmetry is deliberate: `path.relative` against a path outside the Root produces a `../..` way
out of the folder the reader chose, which is both a confusing thing to put in a message and one
the Tools would have to resolve before they could trust. `size` is `null` for a folder.

**`rootDeclared` exists so "no folder chosen" and "nothing matched" are different answers.** They
are the same list of nothing on the wire, and they are opposite things for the reader: one is
something they can go and fix. `note` is a sentence in every case, because a ceiling applied
silently is a ceiling that reads as "there is nothing else".

**`lib/roots/scan.ts` grew an `onEntry`, and `visit` became optional.** That is the whole of how
one walk serves two callers. The menu is told about every entry the walk reaches — folders
included — **without the file being opened**, and returns `false` at the ceiling so the walk stops
there rather than being handed the rest and truncated. The same skip rules, the same order and the
same folder ceiling apply on either path: `node_modules`, `.git`, `.env*` and `.gitignore` are the
walk's answers, and a name the walk hides from a search is hidden from a menu. `lib/roots/scan.ts`
had no test file of its own, so `scan.test.ts` is new and pins this second way of being read.

**A file the walk would not open is still offered, because naming one is not reading one.** The
walk skips a binary or oversized file when it is looking for text in it; a menu is looking for a
name. Offering `assets/logo.png` is the difference between a picker that can do its job and one
that silently loses every image on the machine. Whether the file can be read is `read_file`'s
answer, in its own voice, at the moment it matters — not a hidden row in a list of names.

**The menu is a popup over the composer, and the composer never stops being a textarea.** The
`<textarea>` takes `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-autocomplete`
and `aria-activedescendant` — the APG combobox-with-listbox wiring — while holding focus and the
caret throughout. The popup is `role="listbox"` with `role="option"` rows that are never
focusable, and one chosen row is named from the composer. The reader never leaves the field, which
is the only way "does not steal the caret" and "announced as a listbox" can both be true: a
dialog would take the focus, and a menu of focusable rows would take it on every arrow press.

**A menu cannot hear a key, so `useFileMenu` is a hook and `components/file-menu.tsx` is not a
component of its own.** `chat.tsx` owns the textarea and asks the hook what a key means; the hook
answers "did I take it", and a key it has no use for — Enter with nothing to choose, and every key
once the menu is closed — reaches the composer untouched. `insertPath` is the only thing in the
menu's reach that changes the composer's text, and the only moment it is allowed to.

**Picking replaces the words after the `@` and keeps the `@`.** What lands in the
message is `@src/util.ts` — a Root-relative path, so what the reader can check and what the
Model is asked for, carrying the mark the reader put on it. A trailing space follows, because a
name in a message ends there. Keeping the mark is what lets the composer draw a name heavier
than the words around it, and `lib/roots/named-path.ts` takes it off again on the way to the
route — so picking a file and typing its path stay one action.

**The composer draws the message a second time over the field, because a textarea cannot.**
`.hm-field--behind-mirror` makes the field's own text invisible and `.hm-mirror` draws the same
characters with the names emboldened. The field keeps the value, the caret, the selection, the
keyboard and the undo stack; the copy is `aria-hidden`, takes no pointer, and is held at the field's
scroll. It is drawn on top rather than behind, because `::selection` paints inside the field and a
copy behind it would put every selected word under a block of fill with nothing over it. The two
boxes share every measurement in `.hm-field` rather than restating it, and the wrapper is `flex`
because a `<textarea>` is `inline-block` and as the first thing in a plain block box it sits on a
line and puts seven pixels of nothing under the field.

**The names are emboldened with a stroke, because `font-weight: 600` puts the copy a line out of
step with the field.** A heavier run is a wider run, so the two boxes stop breaking their lines in
the same places: measured at 1400px down to 360px over short and long messages, a 600 copy wrapped
a line later than its field in four cases out of fifteen — every one a narrow window with a long
name in it, which is when a reader is most likely to be looking for the caret. `-webkit-text-stroke`
grows the glyphs without moving them, so the advance widths are the field's own and the line boxes
are the field's own. Re-measured after the change, 48 of 48 widths and messages agree, scroll
heights included. The cost is stated in `globals.css`: at 13px a stroke reads as heavier rather
than as a true weight, and it cannot be made heavier than 0.03em before the counters of the small
letters in a path start to close. **Not asserted in a test**, because jsdom lays nothing out and
the claim is about layout; it is asserted here and re-checked by hand after any change to
`.hm-mention`, `.hm-mirror`, `.hm-field` or the wrapper.

**The composer's selection is the app's accent taken back towards paper, measured to 4.5:1.** The
app fills a selection with `--color-accent` and puts white on it, which is right for prose; here
the words over the fill are the composer's ink, and ink on the accent fill measures 1.93:1 light and
1.64:1 dark — a selection you can see and cannot read. At 40% it is 5.77:1 light and 6.54:1 dark,
and still plainly a selection. `mentionRuns` is asked of `mentionAt` rather than of a second pair of
rules — a word the menu declines to open over must not be drawn as a name — and a bare `@`
mid-typing is not drawn, having no name behind it yet. Under forced colours the copy is removed
entirely, because a forced palette paints the field's own `transparent` text back in and the
message would be drawn twice.

**Escape dismisses and changes nothing.** "Restores the composer text" is read as *leaves it
exactly as typed*: the menu never edited the composer, so there is nothing to take back, and
deleting what a reader typed because they pressed Escape would be the menu deciding what their
message says. Dismissal lasts until the next keystroke and no longer — sooner would make Escape
useless, and it is a flag rather than a note of the words it was dismissed for, because two
mentions of the same file are two mentions.

**An `@` opens the menu only at the start of a word and only with no space after it.** Otherwise
`me@example.com` opens a menu over an address, and a mention is indistinguishable from a sentence
that happens to begin with a character.

**Enter picks only when there is something to pick**, and sends otherwise. A menu that held
Enter for a list of nothing would be a composer that could not send a message a reader had
finished writing.

**The note is the route's own sentence, and the composer shows it when there is no list to show
instead** — and when there is a list that is not everything there was. Under a complete list it is
not rendered at all: a line that only ever says "12 files and folders" is noise, and the ceiling
is the thing worth saying.

**What jsdom can and cannot see about "does not steal the caret".** Asserted: the field holds the
focus for the whole life of the menu; the value and the caret are where the reader left them;
arrow keys and Enter do nothing to the composer while the menu is closed; and after a pick the
caret lands after the inserted path so the reader carries on typing from it. **Not asserted: the
browser's native undo stack**, because jsdom implements no text editing at all — a Backspace there
changes nothing — and a controlled React textarea overwrites that stack on a value change
regardless. What can be seen is that the composer is still an ordinary textarea, and that is what
the ticket's claim is read as.

**Tested at three seams, each against the real thing.** `app/api/files/route.test.ts` drives the
real handler against a throwaway project (`temporaryProject`) with a Root written to disk.
`lib/roots/file-finder.test.ts` rewires `fetch` to that same handler rather than to a stubbed
answer, so the request shape, the response shape and the client's reading of them are pinned
together — a contract two tickets share is a contract one side must not know alone.
`components/composer-files.test.tsx` renders the real `Chat` with the same rewire, so every row in
the menu is one the shipping walk found on a real disk, and the last two tests put the two halves
to each other: the path the menu inserted is fed to `resolvePath`, and has to resolve.

## Comments