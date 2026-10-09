# 03: The three Tools

**What to build:** The Model can list a directory, read a file, and search the Root — the
three things it needs to find an answer in a folder it has never seen.

Read-only. That is a decision rather than an omission, and it is recorded as such so a later
ticket adding a writing Tool has to argue for it rather than inherit it.

**Blocked by:** 02 — Containment

**Status:** ready-for-agent

- [ ] `list_files({ path })` — names, kinds and sizes of the entries in one directory, bounded,
      never silently truncated
- [ ] `read_file({ path, offset, limit })` — contents with line numbers, so the Model can cite a
      line the reader can then find
- [ ] `read_file` reads in pieces rather than refusing a file that is longer than one read
- [ ] `search_files({ query, path, glob })` — matching lines as `path:line`, by plain text, over
      a bounded walk of the Root
- [ ] Every one of the three goes through containment, and a refusal is a result the Model can
      read rather than an exception that ends the Turn
- [ ] Every refusal explains itself: outside the Root, not found, not text, too large, beyond
      the search cap
- [ ] Binary content is refused rather than truncated, so it cannot reach the transcript looking
      like content
- [ ] A file is truncated at the cap with a pointer to where the rest of it is, so a partial
      read is never mistaken for the whole file
- [ ] An empty file is an empty result, not an error
- [ ] The walk skips `node_modules`, `.git`, and `.env*`; skips files over the size cap without
      opening them; honours `.gitignore`
- [ ] The walk has a result cap, and the cap is stated in the result — a partial search must
      read as partial
- [ ] The walk cannot be pointed outside the Root by `path`
- [ ] Descriptions say what each Tool is for in terms a small Model can act on, since the
      description is often the only thing it reads
- [ ] Tests: listing a populated and an empty directory; reading a known file; reading with an
      offset; a file above the cap truncating with a pointer; binary refused; the walk's skips;
      the walk's cap being reported; a Tool asked for a path outside the Root being refused
      through containment and not by its own check

## Decisions

_Recorded once resolved._

## Comments