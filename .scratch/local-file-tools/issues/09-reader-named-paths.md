# 09: Reader-named paths

**What to build:** I can paste a path into a message, and if it is outside the folder I chose I
am asked before the message is sent.

The other half of naming a file. `@` searches the Root; a pasted path is for a location the
reader already knows, which may well be outside it.

**Blocked by:** 02 — Containment, 04 — Wire the Tools into the chat route, 06 — Answer Approval
Requests

**Status:** ready-for-agent

- [ ] A pasted or typed path is recognised in the composer and checked as it is entered
- [ ] Inside the Root, or under a Grant, it resolves and says so — no interruption
- [ ] Outside both, the ask appears **in the composer, before the Turn exists**: allow, always
      allow, deny. The same three answers as a Tool Call's approval, and the same Grants
- [ ] The ask is a different moment from a Tool Call's approval and is presented as the
      reader's own decision, because the reader named the file and the Model did not ask
- [ ] The check happens again at send. A file deleted, or a Root changed, between paste and send
      is refused with a 400 naming the file — not sent with the contents silently missing
- [ ] A path outside the Root is never read before it is allowed, not even to tell the reader what
      kind of file it is
- [ ] A directory named this way sends its listing rather than its contents
- [ ] The file's contents are placed in the message as text, with a delimiter saying which file
      they came from — not sent as a file part, because most of the 189 Endpoints would not take
      one
- [ ] An unreadable file — deleted, a permission failure, binary, over the cap — is reported in
      the message rather than sending an empty block
- [ ] Several files can be named in one message
- [ ] The reader can see which files a message is about before sending it
- [ ] A Turn's bytes are whatever the reader attached and whatever the Model read, sent to
      whichever Endpoint was selected. The interface says which Endpoint that is at the moment
      the files are named, not only later in the transcript
- [ ] Tests: a path inside the Root resolves silently; one outside raises the ask before send;
      "always allow" records a Grant and the next message proceeds; a file deleted between paste
      and send is refused naming it; the same containment function refuses it as would refuse a
      Tool Call for the same path

## Decisions

_Recorded once resolved._

## Comments