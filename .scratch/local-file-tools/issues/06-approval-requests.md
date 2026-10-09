# 06: Answer Approval Requests

**What to build:** When something outside the Root is read, I am asked, and my answer sticks.

Automatic inside the Root, a question outside it — and an answer of "always" is remembered, so
the same question is not asked on every Turn.

**Blocked by:** 04 — Wire the Tools into the chat route

**Status:** ready-for-agent

- [ ] The policy is one function over the parsed tool input, so the answer depends on the path
      the Model actually asked for rather than on which Tool it reached for
- [ ] Inside the Root: no approval metadata, the Tool runs
- [ ] Under a Grant: an automatic approval carrying a reason, so the read is recorded in the
      transcript as automatically approved rather than arriving unannounced
- [ ] Outside both: `'user-approval'`, and the request appears in the Turn
- [ ] The request shows the full resolved path, because the reader is being asked to allow a
      specific file and a relative version of it would not tell them which
- [ ] Three answers: allow once, always allow, deny
- [ ] Always allow records a Grant through the route of ticket 01 and then answers, so the two
      cannot disagree
- [ ] Answering resumes the Turn with no further typing from the reader
- [ ] Denying resumes the Turn too — the Model is told the read was refused and continues, rather
      than the Turn ending on a refusal
- [ ] `experimental_toolApprovalSecret` is set to a value generated once per server process, so a
      modified client cannot fabricate an approval for a read the server never asked about
- [ ] Granted paths are listed with a control to remove each, so an old Grant does not outlive the
      reason for it — and removing one takes effect on the next Turn
- [ ] While a request is unanswered, the composer's Send stays disabled, so a Turn cannot be
      started behind an open question
- [ ] Answering twice, or answering a request the server did not issue, is refused rather than
      half-applied
- [ ] Tests: each of the three policy answers, asserted against the policy function rather than
      through a mocked model; approving resumes; denying resumes; the secret is set; a Grant
      recorded by "always allow" makes the next read automatic; removing a Grant makes the next
      read ask again

## Decisions

_Recorded once resolved._

## Comments