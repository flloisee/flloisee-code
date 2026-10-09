# Multi-Endpoint Chatbot

Status: ready-for-agent

## Problem Statement

A developer wants to talk to whichever AI model is most convenient at the moment —
a large model they downloaded and run on their own machine, or a hosted one they have
an account with — without maintaining a separate tool for each.

Today that means picking a client per backend. LM Studio has its own app, Ollama has
its own CLI, and each hosted provider has its own web console. None of them hold a
conversation the way the developer wants, and none of them let the model be swapped
mid-conversation.

The existing codebase cannot help at all: it is an unmodified `create-next-app`
scaffold with a placeholder home page and no AI integration of any kind.

## Solution

A chat interface, built in this Next.js application, that holds a Conversation with
whichever Endpoint the developer selects.

Cloud Endpoints are offered as a reviewed catalog, so a provider is picked by name
rather than by typing a base URL. Their Credentials are entered once through the
interface, written to the environment, and applied immediately. Local Endpoints —
Ollama, LM Studio — need no Credential and are usable the moment they are running.

Model Discovery removes the need to remember model identifiers: the developer asks an
Endpoint what it has loaded and picks from the answer.

## User Stories

### Connecting to an Endpoint

1. As a developer, I want to select an Endpoint from a list, so that I can start talking without configuring anything first.
2. As a developer, I want to see every configured Endpoint in one place, so that I know what I can talk to.
3. As a developer, I want Local Endpoints to require no Credential, so that a running Ollama or LM Studio instance is usable with no setup.
4. As a developer, I want each Endpoint to carry its own base URL, so that endpoints on non-default ports work.
5. As a developer, I want to switch Endpoints and Models without losing the current Conversation, so that I can compare models on the same question.
6. As a developer, I want an Endpoint whose Credential is missing to still appear in the list, so that I can tell it exists but is unusable.
7. As a developer, I want to see at a glance which Endpoints are Configured, so that I do not discover a missing key by hitting a failed request.
8. As a developer, I want the interface to name the specific environment variable a Cloud Endpoint needs, so that I know what to set without reading the source.
9. As a developer, I want to enter a Cloud Endpoint's key in the interface, so that I do not have to hand-edit a file.
10. As a developer, I want a Cloud Endpoint to work immediately after I enter its key, so that I am not left waiting for a restart.
11. As a developer, I want the known set of Cloud Endpoints offered as a catalog, so that I pick a provider instead of typing base URLs.
12. As a developer, I want the catalog reviewed as source code, so that a changed base URL shows up in a diff before it can redirect my key.

### Choosing a Model

13. As a developer, I want to ask an Endpoint which Models it has loaded, so that I do not have to remember exact identifiers.
14. As a developer, I want discovered Models presented as a selectable list, so that I can pick one without typing.
15. As a developer, I want to select a Model when discovery is unavailable, so that endpoints which do not support discovery remain usable.
16. As a developer, I want to type a Model identifier manually when I know it, so that a model missing from the discovered list is still reachable.
17. As a developer, I want to re-run discovery on demand, so that I can pick up a model I just loaded without restarting.
18. As a developer, I want to be told when discovery fails or returns nothing, so that I can fall back to typing an identifier.
19. As a developer, I want the currently selected Model to be visible while chatting, so that I always know which model produced a Response.
20. As a developer, I want each Endpoint to remember its own selected Model, so that switching back and forth does not reset my choice.
21. As a developer, I want Model Discovery to work against a Local Endpoint with no Credential, so that Ollama and LM Studio behave like any other endpoint.
22. As a developer, I want Local Endpoints available without appearing in any catalog, so that a model on my own machine is reachable with no account or key.

### Holding a Conversation

23. As a developer, I want to send a message and receive an answer, so that I can use the model as a chatbot.
24. As a developer, I want the answer to appear progressively as it is generated, so that I can read while the model is still working.
25. As a developer, I want to send a second message and receive an answer that accounts for the first, so that the Conversation has continuity.
26. As a developer, I want to stop a Response that is taking too long, so that I am not held waiting.
27. As a developer, I want to regenerate the last Response, so that I can retry a disappointing answer.
28. As a developer, I want to see a clear indication that the model is working, so that a silent pause is not mistaken for a broken app.
29. As a developer, I want the send control disabled while a Response is in progress, so that I do not accidentally interleave turns.
30. As a developer, I want my own messages visually distinguished from the model's, so that I can follow the Conversation.
31. As a developer, I want to start a fresh Conversation, so that I can change subject without the old context influencing the answer.
32. As a developer, I want the input to clear after sending, so that the same text is not sent twice by accident.
33. As a developer, I want to press Enter to send, so that composing feels like a normal chat box.
34. As a developer, I want formatted answers to render as formatted text, so that lists, code, and headings are legible.
35. As a developer, I want code blocks in an answer to be readable, so that I can copy a snippet out of the Conversation.
36. As a developer, I want the interface to remain usable on a narrow window, so that I can keep it beside a terminal.

### When things go wrong

37. As a developer, I want a clear message when an Endpoint is unreachable, so that I know to start Ollama rather than retrying.
38. As a developer, I want to be told when a Credential is missing or invalid, so that I know to re-enter it in the interface.
39. As a developer, I want to be told when a Model identifier is not recognised, so that I can pick a different one.
40. As a developer, I want to retry after a failure without retyping my message, so that a transient error is cheap.
41. As a developer, I want failure messages that do not expose my Credential, so that an error can be shown or screenshotted safely.
42. As a developer, I want a failed Request to leave the Conversation intact, so that I keep the context I had built up.
43. As a developer, I want an error surfaced when the response arrives in an unexpected form, so that I am not left with a blank bubble.

### Entering keys safely

44. As a developer, I want my key stored in the environment rather than in browser storage, so that it is not sitting in local storage or a cookie.
45. As a developer, I want the key-entry capability to exist only in development, so that a deployed build has no way to write my secrets.
46. As a developer, I want key entry to accept only variables the catalog already declares, so that it cannot be used to write arbitrary settings or redirect my key to an address I did not choose.
47. As a developer, I want to see which environment variables are set without seeing their values, so that I can confirm configuration without exposing secrets.
48. As a developer, I want my Credential file excluded from version control, so that it is never committed or pushed.
49. As a developer, I want the app to fail with an actionable message when no Credential is configured, so that setup is obvious to someone new.
50. As a developer, I want the app to never echo a stored Credential back to the interface, so that the value is write-only from my point of view.

### Fitting the existing app

51. As a developer, I want the app to build without type errors, so that I can trust the setup.
52. As a developer, I want the app to pass lint, so that conventions are upheld as the code grows.
53. As a developer, I want the existing application shell and styling preserved, so that the chat replaces the placeholder rather than fighting it.
54. As a developer, I want the chat reachable at the application's root address, so that I land straight in the Conversation.
55. As a developer, I want this to run on my own machine, so that I can reach Local Endpoints that no hosted deployment could.
56. As a developer, I want it possible to add Endpoints later without reworking how keys are handled, so that the design does not paint us into a corner.

## Implementation Decisions

### Endpoints come from a reviewed catalog plus hand-declared local ones

Cloud Endpoints are drawn from a Catalog snapshot of the community-maintained models.dev
database — provider name, base URL, documentation link, known models, capability flags.
The snapshot is committed to source control rather than fetched at runtime.

Snapshotting is a security requirement, not a convenience. The Catalog decides where a
Credential is sent, so a remotely-fetched Catalog would make credential forwarding
dependent on a third party's integrity at request time. A changed base URL must arrive
as a reviewable diff. The alternative sources considered were hand-curation alone, which
drifts as model identifiers shift, and LiteLLM's pricing database, which is comparably
complete but oriented to cost accounting.

The Catalog does not include Ollama, so Local Endpoints are declared by hand alongside
it. This split is deliberate: the Catalog is strong on cloud providers and absent on the
local servers that matter most here.

An earlier draft treated every Endpoint as hand-declared in one registry. The Catalog
subsumes the cloud half; Local Endpoints keep their own declaration.

### Credentials are entered through the interface and written to the environment

A Cloud Endpoint's Credential is typed into a modal, posted to a development-only route,
written to the local environment file, and applied immediately. The interface never
displays a stored value back.

An earlier draft required hand-editing the environment file. That was reversed: the
earlier justification — that typing a key into a page exposes it to cross-site scripting
and shoulder-surfing — was argued from a hosted multi-user threat model that does not
apply to a single-user tool on the developer's own machine, where there is no shoulder to
surf. Trading a restart and a hand-edited file for direct entry is the better fit for
this app.

The key still transits the browser once, at the moment of entry, and is never persisted
there. It lives in the environment file, which remains excluded from version control.

### The environment is reloaded at runtime, so no restart is needed

The framework's environment loader is invoked after writing, which re-reads the
environment file and replaces the process environment in place. A newly entered
Credential therefore takes effect on the next request.

This was verified against the installed package rather than assumed: an earlier draft
asserted that a restart was unavoidable, which was wrong. The loader is exported and
callable at runtime.

### Key entry is the app's only file writer, and is constrained accordingly

Because this route writes secrets to disk, it is bounded to reduce blast radius rather
than trusted implicitly:

- **Development only.** The route refuses to run outside development, so no deployed
  build contains a secret-writing capability at all.
- **Append-only to declared names.** Only variables the Catalog already declares may be
  written. A caller-supplied variable name combined with a caller-supplied base URL would
  make this an arbitrary-write endpoint pointed anywhere, so neither is accepted from
  the request.
- **Atomic write.** The file is written to a temporary path and renamed, so an
  interrupted write cannot corrupt an existing set of keys.
- **Non-destructive.** Existing entries, comments, and unrelated variables are preserved.
- **Write-only.** Stored values are never returned to the interface; a diagnostic route
  reports which variable names are present and never their contents.

Base URLs come from the Catalog, never from the request, so an attacker who reached this
route could write a known variable's value but could not redirect where it is sent.

### All requests are proxied; none are browser-direct

Every Request travels to the app's server and out to the Endpoint. The browser never
contacts an Endpoint directly, so no Credential is ever placed in a request the browser
constructs, and no Credential is inlined into the browser bundle.

Calling CORS-capable Endpoints straight from the browser was considered and rejected.
It would keep Credentials off the server entirely, which is its real appeal, but it
requires storing those Credentials in the browser — behind client-side encryption with
an unlock step — and browser-side encryption does not survive cross-site scripting on a
page that is actively decrypting keys. Since Credentials now arrive through the
interface by choice, keeping them in the environment file rather than re-importing them
into the browser is the simpler and safer half of the trade.

Accepted cost: an extra network hop, and Local Endpoints must tolerate being called
from the server process.

### Model Discovery does not carry Credentials to the browser

Discovery for a Cloud Endpoint runs server-side using the stored Credential, so probing
a provider never requires the key in the browser. Discovery for a Local Endpoint needs no
Credential and may be requested directly, subject to that Endpoint's own origin rules.

### One integration covers nearly every Endpoint

Endpoints are driven through the Vercel AI SDK's OpenAI-compatible provider, configured
per Endpoint with its base URL and optional API key. Ollama, LM Studio, Gemini, and
OpenRouter all expose this format, so one code path serves them all rather than one
adapter per provider.

Anthropic's native message format is the known exception and is out of scope for this
spec.

### Model Discovery is a plain models-list fetch

The SDK exposes no listing operation, so discovery calls the Endpoint's conventional
models listing directly and returns identifiers. Endpoints that do not support it, or
return nothing, fall back to a free-text Model field.

Endpoints that require a Credential are queried server-side, since discovery would
otherwise need the key in the browser.

### Model listing is a POST, deliberately

With Cache Components enabled, GET Route Handlers follow the prerender model used by
pages. A GET models route varying by Endpoint would be prerendered at build time, so
every Endpoint would report the same models — a silent, wrong result rather than a
visible failure. Using POST sidesteps prerendering entirely.

### Discovery and chat are separate seams

Model Discovery is deliberately not routed through the chat endpoint. It has a
different failure surface — a bad URL or absent key rather than a generation problem —
and collapsing them would mean every failure looks like a chat failure.

### Streaming throughout

Responses stream from Endpoint to browser, giving a progressive answer rather than a
long pause followed by a wall of text. The AI SDK's UI message stream carries this,
and the interface renders message parts rather than plain strings, which keeps the door
open for reasoning and tool parts later.

### Verification was done against published packages

Library APIs were confirmed against the shipped type definitions rather than
documentation prose, because the AI SDK's current major version differs from commonly
cited examples in at least one way that silently breaks code: the text-generation call
returns its result synchronously and must not be awaited, while the UI-message
conversion call is async and must be. Model discovery's lack of a built-in listing
operation was likewise confirmed rather than assumed.

## Testing Decisions

A good test here asserts what a user can observe — which Models an Endpoint reports,
what the interface shows, whether a Response arrives — and never inspects internal
calls, imports, or component structure.

The chat surface is thin: nearly all behaviour lives in third-party libraries. Tests
that mock the model layer would assert that mocks were called, which tells us nothing
and breaks on every refactor. So the emphasis is on the parts that are genuinely ours —
the Endpoint registry and its Credential resolution — plus real manual verification
against live Endpoints, which is faster and more honest than a mocked harness.

Specifically:

- **Endpoint registry**: unit coverage that a Catalog Endpoint resolves to the right
  base URL, that a Local Endpoint resolves with no Credential present, and that a
  Cloud Endpoint missing its environment variable is reported as not Configured rather
  than failing obscurely. This is our own logic and the highest-value thing to pin down.
- **Key-entry route constraints**: the highest-risk code in the app, so it gets the most
  coverage. Assert that it refuses to run outside development; that it rejects a
  variable name the Catalog does not declare; that it ignores any base URL supplied in
  the request rather than acting on it; that unrelated entries and comments in the
  environment file survive a write; and that a value already stored is never returned
  in a response. Each of these is a way the route could become an arbitrary-write or
  credential-disclosure endpoint if left unguarded.
- **Atomic write**: confirm an interrupted write leaves the previous file intact, since
  corrupting it would lose every key the developer has entered.
- **Catalog integrity**: a cheap structural check that every Catalog entry declares a
  base URL and at least one environment variable name, and that no two entries collide.
  The Catalog is trusted input that decides where keys are sent, so malformed or
  duplicated entries are worth failing loudly rather than discovering at request time.
- **Model Discovery**: verify against real running Endpoints during development —
  start Ollama or LM Studio, confirm discovered identifiers match what is loaded. The
  fallback path when discovery returns nothing is worth a test of its own.
- **Streaming**: verified by use. Start a Response, confirm text appears progressively,
  confirm stop and regenerate work.
- **Build, lint, and types**: the standard gates, since they catch the async/sync
  mistake described above.

There is no existing test infrastructure to follow, so the first test establishes the
pattern.

## Out of Scope

- Anthropic and any Endpoint not speaking the OpenAI-compatible format
- Conversation persistence — Conversations live in memory and are lost on reload
- Multiple simultaneous Conversations, or naming and resuming them
- Tool calling and function invocation
- File or image attachment
- Creating arbitrary Endpoints through the interface — the interface offers known Cloud
  Endpoints from the Catalog and declared Local Endpoints, and does not accept a
  caller-supplied base URL
- Removing or editing the Catalog through the interface; it is source-controlled
- Key entry outside development, and any production-ready secret storage
- Streaming responses or reconnect-to-stream after a dropped connection
- Reasoning content and source citations
- Reasoning-token display for models that emit it
- Authentication and multi-user support; the app is single-user and local
- Deployment to hosted infrastructure, which would put Local Endpoints out of reach
- Mobile-specific layout beyond remaining usable on a narrow window

## Further Notes

**Build against a Local Endpoint first.** Ollama and LM Studio need no Credential and no
signup, so they give the fastest feedback loop. Cloud Endpoints can be verified
afterwards.

**A newly entered key takes effect immediately.** The environment is reloaded after
writing, so there is no restart to remember. An earlier draft of this spec asserted the
opposite; that was incorrect and has been verified against the installed package.

**The security posture depends on this staying local.** Credentials in the environment
are appropriate for single-user local use, and the key-entry route is development-only
precisely because of that. Two things would have to change before any hosted
deployment: an authentication story, since proxying means the server holds every user's
Credential — fine for one person, not for many; and the key-entry route, which is
excluded from production builds and would need replacing with proper multi-user secret
storage. The rejected browser-direct design is the one that would have carried less
risk here, so if multi-user hosting ever becomes the goal, that decision should be
reopened rather than patched.

**The Catalog is the highest-leverage file in the repo.** It decides where Credentials
are sent, and it is also the most likely to need maintenance as model identifiers shift.
Treat changes to it with the care of a dependency bump, not a copy edit.

**Deployment reachability.** Local Endpoints are only reachable because the app runs on
the same machine. This is why hosting was excluded rather than deferred.
