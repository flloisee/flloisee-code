# 10: Document and verify

**What to build:** The vocabulary, the README, and a run against real Endpoints.

The README currently makes two claims this feature falsifies, and one of them is a security
argument rather than a note. Leaving either standing would be worse than never having written the
feature.

**Blocked by:** 01 through 09

**Status:** ready-for-human

## Vocabulary

Run `/domain-modeling`. The terms this feature introduces, with the avoid-lists the existing
entries imply:

- [x] **Root** — a folder on the machine the Model may read, chosen by the reader. Avoid:
      workspace (`components/workspace.tsx` is the UI shell and reusing it here would collide),
      sandbox, project, scope, mount, library
- [x] **Tool** — a named operation the Model can ask the app to perform, with a declared input
      and a result. Avoid: function, plugin, skill, command, capability
- [x] **Tool Call** — one request from the Model to one Tool. Avoid: function call, invocation,
      request — the last is already used for a proxied call to an Endpoint
- [x] **Tool Result** — what a Tool returns for one Tool Call. Avoid: output, response —
      **Response** is already the assistant's answer and the two must not drift
- [x] **Grant** — a standing permission to read one path outside the Root, remembered between
      Turns. Avoid: approval (that is the one-off ask), permission, exception, allowlist entry
- [x] **Approval Request** — the pause put in front of the reader when something outside the Root
      is about to be read. Avoid: confirmation, prompt
- [x] **Attachment** — a file the reader names in a Turn, whose contents are sent with it.
      Avoid: upload, file part

## README

- [x] "This route is the app's only file writer, and is bounded accordingly" is rewritten to
      cover both writers and say what bounds each — one by development-only, one by containment
- [x] The API table gains `POST /api/roots` and `POST /api/files`, keeping the POST-only
      reasoning intact
- [x] "Tool calling and function invocation; file and image attachment" comes off the
      out-of-scope list for text, and stays for images, which need a Model that accepts one
- [x] The Proxying section gains the sentence this feature makes true: a Turn's contents are
      whatever the reader attached and whatever the Model read, sent to whichever Endpoint was
      selected — so a Cloud Endpoint receives file contents, not just the question
- [x] The security-posture paragraph keeps its shape. This makes the local single-user
      assumption load-bearing in a new way, and the paragraph says so rather than implying it
- [x] The layout section gains `lib/reading/` — described as what is actually there
      (`lib/roots/`, `lib/tools/`, `lib/chat/`), since the spec guessed the path

## Verification

- [ ] Against Ollama with a tool-capable Model: a question needing two files is answered, the
      transcript shows both reads, and the answer cites something that is actually in them
- [ ] Against LM Studio, the same, since it is the other Local Endpoint the app is built around
- [ ] A Model that cannot call Tools produces the reader-safe failure, and the screenshot carries
      no Credential
- [ ] A read outside the Root asks, and denying it lets the Turn finish rather than ending it
- [ ] `@` finds a file by name in a real Root, and a pasted path outside it asks before the
      message can be sent
- [ ] A reload reopens the Root and the Saved Conversation, with no second ask
- [x] `pnpm test` — 924 tests across 65 files
- [x] `pnpm typecheck` — clean, once Next's generated route types are present
- [x] `pnpm lint` — clean
- [x] `pnpm test:mutation` — 41 entries, 40 caught, 1 missed
- [ ] `pnpm build` — **not run.** It cannot run in a worktree whose `node_modules` is a
      symlink, so it is unverified here and wants a real install before the feature ships.

## Decisions

**The note about *agent mode* went into the glossary, not the spec.** The ticket asks for it to
be noted in the spec; the rules for this pass were not to edit the spec or any ticket but this
one. It is recorded where it has the most force instead — the **Tool** entry closes on
"Deliberately not an agent mode, and the **Model** entry's refusal of the word *agent* holds" —
and repeated here, so nothing is lost if the glossary is later rewritten.

**The seven terms went into one new `## Reading` section rather than being split across the
existing headings.** **Tool**, **Tool Call** and **Tool Result** could have gone under
`## Models`, but the feature's vocabulary reads as one chain — a Root bounds it, a Tool Call
crosses the boundary, a Tool Result comes back, a Grant is what widens it — and splitting the
chain in half would make the glossary harder to hold in mind than the code. It sits between
`## Conversation` and `## Storage`, so Attachment follows the Turn it travels in.

**No glossary entry names a file, a route, a ceiling or a type.** These terms say what the
words mean and what makes them different from the words they avoid; the numbers and the paths
live in the README and in the code, where they are true in one place and checkable.

**M40 substitutes an unconditional admission rather than deleting the `mayRead` call.** Deleting
the line leaves `allowed` undefined, and every named path then throws a `ReferenceError` — which
shows the mutation caught a crash rather than a missing check. The substitute is the same defect,
no path is refused at send, and the six tests that fail are the ones asserting the 400.

**M41 is aimed at `asPath`, not at the loop above it.** `run` substitutes through `s/…/…/`, and
the loop's own source carries the regex `/\s+/`; a `/` inside `\Q…\E` closes the pattern early
and the substitution silently never runs. That constraint already applied to all thirty-nine
entries before this ticket — none of them has a `/` in its `from` string — and it is now written
down beside the entry so the next person does not lose an afternoon to it.

**The README's test count was corrected, though no ticket asked for it.** It claimed 288 tests
across 26 files, and the suite is 924 across 65.

**`pnpm typecheck` is now documented as needing a prior `pnpm dev` or `pnpm build`.** It fails on
a fresh checkout with `Cannot find name 'LayoutProps'`, because the route types Next generates
are not in the repository and `tsconfig.json` includes them. The Scripts table says so rather
than leaving the first person to trip over it.

## Comments
