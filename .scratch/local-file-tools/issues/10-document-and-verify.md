# 10: Document and verify

**What to build:** The vocabulary, the README, and a run against real Endpoints.

The README currently makes two claims this feature falsifies, and one of them is a security
argument rather than a note. Leaving either standing would be worse than never having written the
feature.

**Blocked by:** 01 through 09

**Status:** ready-for-agent

## Vocabulary

Run `/domain-modeling`. The terms this feature introduces, with the avoid-lists the existing
entries imply:

- **Root** — a folder on the machine the Model may read, chosen by the reader. Avoid: workspace
  (`components/workspace.tsx` is the UI shell and reusing it here would collide), sandbox,
  project, scope, mount, library
- **Tool** — a named operation the Model can ask the app to perform, with a declared input and a
  result. Avoid: function, plugin, skill, command, capability
- **Tool Call** — one request from the Model to one Tool. Avoid: function call, invocation,
  request — the last is already used for a proxied call to an Endpoint
- **Tool Result** — what a Tool returns for one Tool Call. Avoid: output, response — **Response**
  is already the assistant's answer and the two must not drift
- **Grant** — a standing permission to read one path outside the Root, remembered between Turns.
  Avoid: approval (that is the one-off ask), permission, exception, allowlist entry
- **Approval Request** — the pause put in front of the reader when something outside the Root is
  about to be read. Avoid: confirmation, prompt
- **Attachment** — a file the reader names in a Turn, whose contents are sent with it. Avoid:
  upload, file part

Note in the spec that this is deliberately not called agent mode: the existing **Model** entry
lists *agent* among the words to avoid, and that holds.

## README

- [ ] "This route is the app's only file writer, and is bounded accordingly" is rewritten to
      cover both writers and say what bounds each — one by development-only, one by containment.
      As written it reads as a security argument, so it cannot simply gain a clause
- [ ] The API table gains `POST /api/roots` and `POST /api/files`, keeping the POST-only
      reasoning intact
- [ ] "Tool calling and function invocation; file and image attachment" comes off the out-of-scope
      list for text, and stays for images, which need a Model that accepts one
- [ ] The Proxying section gains the sentence this feature makes true: a Turn's contents are
      whatever the reader attached and whatever the Model read, sent to whichever Endpoint was
      selected — so a Cloud Endpoint receives file contents, not just the question
- [ ] The security-posture paragraph keeps its shape. This makes the local single-user
      assumption load-bearing in a new way, and the paragraph should say so rather than be
      left to imply it
- [ ] The layout section gains `lib/reading/`

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
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test:mutation` all pass

## Decisions

_Recorded once resolved._

## Comments