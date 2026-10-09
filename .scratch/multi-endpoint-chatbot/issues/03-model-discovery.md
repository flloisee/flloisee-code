# 03: Model Discovery

**What to build:** I ask an Endpoint which Models it has and pick one from the resulting list, instead of remembering exact identifiers. When discovery is unavailable or returns nothing, I can still type a Model identifier by hand.

**Blocked by:** 01 — Chat with a Local Endpoint

**Status:** resolved

- [x] A models route returns the identifiers an Endpoint currently offers
- [x] Discovered Models are presented as a selectable list in the interface
- [x] I can type a Model identifier manually when discovery fails or returns nothing
- [x] I can re-run discovery on demand, so a Model I just loaded appears without restarting
- [x] I am told when discovery fails or returns nothing, rather than seeing an empty control with no explanation
- [x] Discovery works against a Local Endpoint with no Credential
- [x] Discovery is a POST, because with Cache Components enabled a GET route handler would be prerendered at build time and every Endpoint would report identical models — a silent wrong answer rather than a visible failure
- [x] Discovery is a separate seam from the chat route, since its failures (bad address, absent Credential) are different in kind from a generation failure and collapsing them would make every failure look like a chat failure
- [x] The Model currently selected stays visible while chatting, so I know which model produced a Response
- [x] Each Endpoint remembers its own selected Model, so switching back and forth does not reset my choice
- [x] Verified against a real running Endpoint during development — start Ollama or LM Studio and confirm discovered identifiers match what is loaded

## Verification notes

Verified against **LM Studio**, which was already installed on this machine with
eight Models loaded; it was started, exercised, and stopped again. Discovery
returned exactly the eight identifiers `lms ls` reported, including the embedding
Model, and a chat Request naming one of the discovered identifiers produced a
real streamed Response from it. Ollama was not installed and was not used.

Two things are worth recording because they are easy to get wrong later:

- **The POST is load-bearing, not stylistic.** A test stands up two Endpoints on
  two ports serving different Models and asserts each reports its own, in both
  orders. It was checked against a deliberately broken `modelsURL` to confirm it
  actually fails when an Endpoint's own address is ignored. `next build` also
  reports `/api/models` as `ƒ (Dynamic)`, so it is never prerendered.
- **Two tests needed arranging, not assuming, an Endpoint that is not running.**
  They originally relied on port 11434 being free, and duly failed once a stub
  was listening there. They now claim and release a port deliberately, so the
  suite passes whether or not the developer happens to have Ollama running.

Tests cover parsing across the shapes real servers return (OpenAI-compatible
`data[].id`, Ollama's native `models[].name`, a bare array), the discovery
request against a real HTTP Endpoint, per-Endpoint Model memory, the interface's
offered list and stated outcomes, and the route driven against a running
Endpoint. Nothing in the model layer is mocked: Endpoints are addressed over real
sockets.

Not verified: the interface was driven through its own tests and confirmed
rendering by hand against a running Endpoint, but no browser automation was
available, so pointer-level interaction (opening the typed-identifier field by
clicking the list) was exercised via the DOM rather than by a real click.