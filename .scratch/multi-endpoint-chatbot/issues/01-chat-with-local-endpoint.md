# 01: Chat with a Local Endpoint

**What to build:** I pick a Local Endpoint — a model running on my own machine — and hold a Conversation with it. I type a message, the answer appears progressively as it is generated, and I can stop it if it takes too long. No account, no key, no setup beyond the model server already running.

This is the tracer bullet: it cuts a narrow but complete path through the chat route, the provider layer, and the interface. Everything later is an addition to a path that already works.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A Local Endpoint (Ollama, at its conventional address) can be declared alongside its model identifier, needing no Credential
- [ ] Sending a message produces a Response that streams to the interface progressively rather than appearing all at once on completion
- [ ] My own messages and the model's are visually distinguishable
- [ ] The send control is disabled while a Response is in progress, so Turns cannot interleave
- [ ] A Response can be stopped mid-stream
- [ ] The input clears after sending, and Enter sends
- [ ] A second message produces an answer that accounts for the first, so the Conversation has continuity
- [ ] I can start a fresh Conversation, clearing prior context
- [ ] Every request is proxied through the server; the browser never contacts an Endpoint directly
- [ ] The text-generation call is invoked synchronously (not awaited) while the UI-message conversion call is awaited — the AI SDK's current major version requires both, and getting either wrong fails silently or breaks the build
- [ ] The app passes type checking, lint, and build
