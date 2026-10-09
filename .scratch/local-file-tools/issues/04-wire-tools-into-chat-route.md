# 04: Wire the Tools into the chat route

**What to build:** The Tools reach the Model, the step loop is bounded, and a read outside the
Root stops and asks.

The chat route stays what it is — one POST, proxying to the chosen Endpoint — with the Tools
added to it rather than a second route beside it. Chat and reading are one Turn.

**Blocked by:** 03 — The three Tools

**Status:** ready-for-agent

- [ ] With a Root chosen, the route passes `tools`, an approval policy, and a step limit to
      `streamText`
- [ ] With no Root chosen, it passes none of them and the Turn behaves exactly as it did in v1 —
      pinned by a test, because a mode that only exists when configured is easy to break without
      noticing
- [ ] No filesystem path is ever read from the request. The Root comes from the file of ticket
      01 and nowhere else, so a caller posting a path to `/api/chat` reaches nothing
- [ ] `stopWhen: isStepCount(8)` is set explicitly, because `streamText` defaults to
      `isStepCount(1)` — one step means the Model produces a tool call and the loop stops without
      ever reading the result, so omitting it leaves the Tools inert rather than merely slow. The
      20 that the SDK's documentation calls the default belongs to `ToolLoopAgent`
- [ ] Instructions naming the Tools are sent when a Root is set, and not otherwise
- [ ] The instructions tell the Model not to retry a read that was denied, so a refusal ends the
      line rather than becoming a loop
- [ ] An Endpoint whose Model cannot call Tools fails with a message naming the Endpoint and the
      Model, and quoting nothing from the provider — a case added to `lib/chat/failure.ts`, which
      exists so that nothing derived from a failure reaches the reader
- [ ] A Turn whose history carries a tool call with no result fails readably rather than raw. This
      is a real failure mode, not a hypothetical one: the SDK throws `MissingToolResultsError`
      while converting messages, and it arrives as an error inside a 200 stream rather than as a
      status the existing status-based cases in `lib/chat/failure.ts` can see
- [ ] The approval policy is deterministic for a given path, because the policy is re-evaluated on
      every replay of a history — a policy that asked twice for one path would ask the reader
      again for a decision they had already made
- [ ] Stop still aborts the server's work during a tool loop, not only during generation — the
      `abortSignal` the route already passes covers it
- [ ] A Tool failure leaves the Conversation intact, as every other failure in this app does
- [ ] The route's `maxDuration` still covers a multi-step Turn, since eight steps against a
      loaded local Model is not one generation
- [ ] Tests: no Tools without a Root; the step limit is what is configured; a path in the
      request body reaches no file; a provider refusing Tools produces the reader-safe message
      and echoes nothing

## Decisions

_Recorded once resolved._

## Comments