# 03: Model Discovery

**What to build:** I ask an Endpoint which Models it has and pick one from the resulting list, instead of remembering exact identifiers. When discovery is unavailable or returns nothing, I can still type a Model identifier by hand.

**Blocked by:** 01 — Chat with a Local Endpoint

**Status:** ready-for-agent

- [ ] A models route returns the identifiers an Endpoint currently offers
- [ ] Discovered Models are presented as a selectable list in the interface
- [ ] I can type a Model identifier manually when discovery fails or returns nothing
- [ ] I can re-run discovery on demand, so a Model I just loaded appears without restarting
- [ ] I am told when discovery fails or returns nothing, rather than seeing an empty control with no explanation
- [ ] Discovery works against a Local Endpoint with no Credential
- [ ] Discovery is a POST, because with Cache Components enabled a GET route handler would be prerendered at build time and every Endpoint would report identical models — a silent wrong answer rather than a visible failure
- [ ] Discovery is a separate seam from the chat route, since its failures (bad address, absent Credential) are different in kind from a generation failure and collapsing them would make every failure look like a chat failure
- [ ] The Model currently selected stays visible while chatting, so I know which model produced a Response
- [ ] Each Endpoint remembers its own selected Model, so switching back and forth does not reset my choice
- [ ] Verified against a real running Endpoint during development — start Ollama or LM Studio and confirm discovered identifiers match what is loaded
