# 09: Failure messages

**What to build:** When something goes wrong, I am told what went wrong and what to do about it, without my Credential appearing in the message and without losing the Conversation I had built up.

**Blocked by:** 01 — Chat with a Local Endpoint, 04 — Catalog-backed Cloud Endpoints (the Credential-related failures only exist once Cloud Endpoints exist)

**Status:** ready-for-agent

- [ ] An unreachable Endpoint is reported distinctly, so I know to start Ollama rather than retry
- [ ] A missing or invalid Credential is reported distinctly, so I know to re-enter it in the interface
- [ ] An unrecognised Model identifier is reported distinctly, so I know to pick a different one
- [ ] No failure message exposes a Credential value, so an error can be shown or screenshotted safely
- [ ] A failed request leaves the existing Conversation intact — prior Turns are kept and I keep the context I had built
- [ ] I can retry after a failure without retyping my message
- [ ] A Response that arrives in an unexpected form surfaces an error rather than leaving an empty bubble
- [ ] Server-side error detail is not leaked to the browser; the interface shows a message safe to display
