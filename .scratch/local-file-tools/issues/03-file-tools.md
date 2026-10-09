# 03: The three Tools

**What to build:** The Model can list a directory, read a file, and search the Root — the
three things it needs to find an answer in a folder it has never seen.

Read-only. That is a decision rather than an omission, and it is recorded as such so a later
ticket adding a writing Tool has to argue for it rather than inherit it.

**Blocked by:** 02 — Containment

**Status:** resolved

- [x] `list_files({ path })` — names, kinds and sizes of the entries in one directory, bounded,
      never silently truncated
- [x] `read_file({ path, offset, limit })` — contents with line numbers, so the Model can cite a
      line the reader can then find
- [x] `read_file` reads in pieces rather than refusing a file that is longer than one read
- [x] `search_files({ query, path, glob })` — matching lines as `path:line`, by plain text, over
      a bounded walk of the Root
- [x] Every one of the three goes through containment, and a refusal is a result the Model can
      read rather than an exception that ends the Turn
- [x] Every refusal explains itself: outside the Root, not found, not text, too large, beyond
      the search cap
- [x] Binary content is refused rather than truncated, so it cannot reach the transcript looking
      like content
- [x] A file is truncated at the cap with a pointer to where the rest of it is, so a partial
      read is never mistaken for the whole file
- [x] An empty file is an empty result, not an error
- [x] The walk skips `node_modules`, `.git`, and `.env*`; skips files over the size cap without
      opening them; honours `.gitignore`
- [x] The walk has a result cap, and the cap is stated in the result — a partial search must
      read as partial
- [x] The walk cannot be pointed outside the Root by `path`
- [x] Descriptions say what each Tool is for in terms a small Model can act on, since the
      description is often the only thing it reads
- [x] Tests: listing a populated and an empty directory; reading a known file; reading with an
      offset; a file above the cap truncating with a pointer; binary refused; the walk's skips;
      the walk's cap being reported; a Tool asked for a path outside the Root being refused
      through containment and not by its own check

## Decisions

**Where the code lives.** `lib/tools/`, not `lib/roots/`. `lib/roots/` is where the Root is
declared and where a path is admitted, and neither of those knows a Model exists. The Tools are
the other end of the feature — they take a path the Model wrote and give back something it can
read — and putting them beside containment would make that directory look like the place a Tool
is written, which is where the next ticket will look first.

`lib/roots/` gained three files, and each is a thing the Tools needed that was not the Tools:
`text.ts` (is this text, and how are its lines numbered), `glob.ts` (the pattern language a
`.gitignore` is written in, which `glob` is too), and `scan.ts` (the bounded walk). `scan.ts` is
where the spec's "the `@` menu and `search_files` share one walk" is satisfied — ticket 08 builds
its menu on `walkFiles` rather than on a second one. `walk.ts` now takes its `.env*` rule from
`scan.ts` so there is one answer to "is this a Credential" rather than two.

**The Tools are a factory, not a module-level constant.** `fileTools(reading)` builds them
against one `ReadingRoot`, which the chat route reads from the file per Turn. A module-level
constant would capture the Root when the module loaded and a reader who changed it would not see
the change until a restart — and NOTES already warns about caching a Root in a module variable.

**`path` is optional on `list_files` and `search_files`, and required on `read_file`.** A Model
that wants the whole project says nothing rather than writing `.`, and small local Models omit
optional fields readily. The cost is that a Tool Call's input is not uniformly `{path: string}`,
which is why `askedPath(input)` is exported: ticket 06's policy is one function over every call
and needs the path out of any of the three.

**Paths come back relative to the Root, and absolute only under a Grant.** Both round-trip
through `mayRead`, and the reader's own home directory does not appear spelled out in their own
Conversation. The Root is resolved before anything is subtracted from it, because on macOS the
path as written and the path as the disk has it are different strings under `/var` and `/tmp`.

**Every result carries a `note`.** A structured field is what the interface renders; the sentence
is what the Model reads, and on a small local Model it is often the only part it reads. So the
caps, the truncation and every refusal appear twice — once as data, once as a sentence naming what
to pass next.

**`MAX_MATCH_CHARS = 500` on a matching line.** Not in the ticket, and not a small thing: a
minified bundle is one line of a hundred thousand characters, and two hundred of those would be
twenty megabytes of transcript that is saved, re-sent every later Turn and forwarded to an
Endpoint. The result says when a line was cut and how to read it whole.

### Things the ticket or spec did not anticipate

**"Too large" is two different refusals, and the spec reads as though it were one.**
`spec.md:337-338` puts "files larger than the read cap" out of scope and says they are "refused
with a reason rather than truncated into an answer", while `spec.md:193` and the ticket's own
"reads in pieces rather than refusing a file that is longer than one read" say the opposite for
the same file. Both are honoured by splitting the ceiling in two:

- `MAX_READ_LINES = 2000` is on what one **call** returns. Over it, the read is **cut**, with
  `continuesAtLine` naming the line to ask for next.
- `MAX_FILE_BYTES = 1 MiB` is on the **file**. Over it, `read_file` refuses with `too-large`,
  and `search_files` passes it over without opening it.

A file longer than one read is therefore never refused, which is what the ticket asks for, and
"too large" is still a refusal that explains itself, which is also what the ticket asks for. The
split is defensible on its own terms: a megabyte is already a page of prose the Model did not ask
to be handed, and pointing a Model at the first two thousand lines of a bundle produces a
confident answer about a file nobody could have read.

**`list_files` does not skip `.env*`, though the walk does.** The spec asks for the skip on
`search_files`, and a listing that hides a file is a listing that lies about the folder — which
matters because the reader has already chosen that folder, and the listing's job is to tell the
Model what is there. The argument the other way is real: a `.env.local` inside the chosen Root is
still a file the reader did not point at, and a Model that wanders into one puts a Credential in
the transcript. **This is a judgement the spec did not make, and it is the one line here a later
ticket is most likely to want to overturn.** If it is, the change is one predicate in
`file-tools.ts` and one test.

**The walk follows no links at all.** Not just no link out of the Root — none, including one
pointing at a file inside it. Two mutations in `scripts/mutation-check.sh` cover the two halves
(M31 walks into one, M32 opens one). The cost is real and is stated in the walk's own comment: a
project that keeps its sources in links will not find them. The alternative — resolving each entry
through `mayRead` — was rejected because it would put a containment check inside the walk, and a
walk whose containment is a second implementation of `mayRead` is a second thing to keep in step.

**`.gitignore` is honoured in substance, not in full.** `lib/roots/glob.ts` implements git's
rules for one file at a time: any-depth matching for a pattern with no separator, anchoring for
one with a separator, trailing `/`, `*`, `?`, `**`, character classes, `!` re-inclusion, and the
innermost file deciding. Not implemented: precedence between several files at different depths
beyond "the innermost with something to say decides", and escapes beyond a leading `\#`. A walk
that reads a few files a pathological pattern told it not to is a walk that reads more, not one
that reaches outside the Root.

**The walk's order is decided here.** `readdir` answers in filesystem order, which would give a
different transcript on a different machine and a different order on the same one after a
rebuild. Entries are sorted folders-then-files-then-links, each group by name — the same order
`list_files` uses.

**The search does the size and binary checks inside the walk, not after it.** The walk has to
open a file to know whether it is text, so handing back paths would mean every caller opens
everything twice and then has to decide what "files read" means. The `glob` filter is passed into
the walk for the same reason: a caller that filtered afterwards would open every file in the Root
to discard most of them. `filesRead` and `filesSkipped` are therefore true counts rather than
flattering ones.

**`scripts/mutation-check.sh` gains M25–M34.** The spec requires every containment guard to be
there, and one of these — M31, the walk descending into a link — was *missed* on the first run,
which is exactly what the script exists to find: the test for it only covered a link to a folder,
and a walk that refuses to descend but opens link-files would have passed it. Both halves are
pinned now. The script's `run` takes an optional sixth argument, `g`, for a guard that one line
enforces in all three Tools; mutating one of the three would otherwise be caught by the tests for
the others and read as evidence that all three are guarded.

## Comments

Ticket 03. `pnpm test` 597 passing, `pnpm typecheck` and `pnpm lint` clean,
`pnpm test:mutation` 34/34 CAUGHT with the tree restored.

Verified by use rather than by a mocked model, per the spec: driven through `streamText` against
a throwaway OpenAI-compatible server that asked for all three Tools in one step. The three
results came back as `tool-result` parts with an empty error stream — a refusal really is a
result and does not end the Turn. `FileTools` was also type-checked against
`GenericToolApprovalFunction<FileTools, {}, {}>` and `streamText({ tools, stopWhen:
isStepCount(8), toolApproval })`, so tickets 04 and 06 are written against a shape that compiles.

For whoever picks this up: `list_files` and `read_file` hand back `Entry.kind: "link"` rather
than the kind of what the link points at. Whether a link can be followed is not known until
`mayRead` resolves it, and claiming otherwise in a listing is a claim the Model would rely on.
