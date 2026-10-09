# Multi-Endpoint Chat

A chat application that talks to whichever AI backend the user points it at — a model
running on their own machine, or a hosted service — without the app caring which.

## Endpoints

**Endpoint**:
A configured address for an AI backend that the app can hold a conversation with. Each
Endpoint names a base URL, an optional Credential, and one or more Models.
_Avoid_: provider, connection, backend, target, server

**OpenAI-Compatible**:
An Endpoint that accepts the shared chat request format, so it can be driven without
Endpoint-specific code. Nearly every cloud and local server qualifies, which is what
makes a single integration cover all of them.
_Avoid_: OpenAI API, compatible provider, standard endpoint

**Local Endpoint**:
An Endpoint served from the machine running the app. Requires no Credential. Declared by
hand rather than drawn from the Catalog, which reaches no local server: Ollama and LM
Studio are the two the app is built around.
_Avoid_: offline endpoint, self-hosted endpoint, on-prem endpoint

**Cloud Endpoint**:
An Endpoint served by a third party over the network. Requires a Credential.
_Avoid_: remote endpoint, hosted endpoint, online endpoint

Note that Local and Cloud describe where an Endpoint is served, which is not the
same question as whether it needs a Credential — a Declared Endpoint may be either,
and is grouped as the reader's own rather than by where it happens to run.

**Registry**:
The full set of Endpoints the app offers: Cloud Endpoints drawn from the Catalog, Local
Endpoints declared alongside it, and Declared Endpoints read from `.endpoints.json`. The
first two are added through the interface or by editing source; the third is added only
through the interface. None is fetched from a list at runtime, so an Endpoint that stops
working stops working visibly rather than quietly changing. One answer about it is read
at a time and shared by every view: a reader adding an Endpoint sees the picker and the
chat header change together, never one ahead of the other.
_Avoid_: endpoint list, config, collection

**Configured**:
An Endpoint is Configured when its Credential is present, so it can receive messages.
A Local Endpoint requires no Credential and is therefore always Configured. A Cloud
Endpoint becomes Configured through Key Entry, taking effect immediately without a
restart. An unconfigured Endpoint stays visible in the interface so the absence is
diagnosable rather than silent.
_Avoid_: active, ready, enabled, available, connected

**Credential**:
The secret authorizing requests to a Cloud Endpoint. Held in the app's environment and
used by the server when proxying. It reaches the browser exactly once — as the user
types it into Key Entry — and is never persisted there.
_Avoid_: API key, secret, token, password

**Key Entry**:
The act of a user supplying a Cloud Endpoint's Credential through the interface, which
writes it to the environment and makes that Endpoint Configured. A single-user local act:
the user enters their own key on their own machine. Writing a Credential and having it in
use are separate facts, and Key Entry reports which one happened: a shell export serving a
different value, and a process that has not picked the name up, are each told apart from a
Credential that is stored and live.
_Avoid_: key setup, credential configuration, onboarding

**Catalog**:
The reviewed set of known Cloud Endpoints held in source control, supplying base URLs
and Credential variable names. Reviewed as code because it decides where Credentials are
sent. It does not cover Local Endpoints, or Endpoints the reader has added for themselves.
One Credential variable names exactly one service: where a vendor runs a service per region,
each gets its own name rather than sharing one, so entering a Credential Configures the one
Endpoint the reader chose. It is not edited through the interface.
_Avoid_: registry, provider list, directory

**Declared Endpoint**:
An Endpoint the reader added through the interface, for a server the app has no entry for —
something on their own machine or their own network. Held in `.endpoints.json` rather than
in the Catalog, and checked at the point of entry instead: http or https, no Credential
inside the URL, no id the Registry already holds. It needs no Credential to be Configured,
because a server on the reader's own machine usually wants none. Its Credential is written
to the environment file, never to the file holding the Endpoint. The name is the third
source of an Endpoint, after the Catalog and the Local Endpoints, and the only one a file
rather than source control holds.
_Avoid_: custom endpoint, user endpoint, added endpoint, manual endpoint, own endpoint

**Added by you**:
The group a Declared Endpoint is offered under, and the first in the list. Named for whom
the Endpoints in it belong rather than for where they run, because a server on the reader's
own machine and one across their network are equally theirs.
_Avoid_: custom, mine, my endpoints, local

## Models

**Model**:
A named AI model reachable through an Endpoint, addressed by the identifier that
Endpoint's server recognizes. One is chosen per Endpoint, and that choice is kept
in the Preference Store, so switching back to an Endpoint brings its Model with
it rather than starting again from the one it declares.
_Avoid_: engine, checkpoint, agent

**Model Discovery**:
Asking an Endpoint which Models it currently offers, so a Model is chosen from a list
rather than typed from memory. Every Endpoint need not support it.
_Avoid_: model enumeration, listing, scanning, probing

## Conversation

**Conversation**:
The ordered sequence of Turns currently held in the interface. A Conversation
can be **Saved** — kept in the reader's own browser between visits — and Saved
Conversations are listed by name so one can be reopened.
_Avoid_: chat, session, thread, history

**Saved Conversation**:
A Conversation held in the browser's own storage rather than only in the
interface, so it survives a reload. It has a **Name**, and the reader can rename
or delete it. Saved entirely on the reader's machine: there is no account and no
copy anywhere else, which is also how the reader gets rid of them.
_Avoid_: session, saved chat, thread, archive

**Name**:
What a Saved Conversation is called in the list. Derived once from the message
that opened the Conversation — a cut of it, long enough to recognise the
question and short enough to scan — and kept thereafter, so a rename sticks
rather than being overwritten by the next Turn.
_Avoid_: title, subject, label, preview

**Turn**:
One user message together with the assistant response it produced.
_Avoid_: exchange, round trip, request, interaction

**Response**:
The assistant's answer within a Turn, reaching the interface incrementally as the
Endpoint produces it rather than all at once on completion.
_Avoid_: reply, completion, output

## Reading

**Root**:
A folder on the machine the Model may read, chosen by the reader. What makes a path inside
one is resolution rather than spelling: it has to follow through any links to the Root itself
or to something under it, so a sibling folder whose name begins the Root's is outside, and a
path inside the Root that points back out through a link is outside too. One at a time, and
held on the server rather than in the browser, because the browser resends every Turn and can
post anything at all.
_Avoid_: workspace (`components/workspace.tsx` is the interface's shell, and reusing the word
for a folder would collide), sandbox, project, scope, mount, library

**Tool**:
A named operation the Model can ask the app to perform, with a declared input and a result —
listing a folder, reading a file, searching a folder for text. There are none until a Root
has been declared: a reader who has chosen no folder is sent no Tools, and a Turn behaves
exactly as it did before. Deliberately not an agent mode, and the **Model** entry's refusal
of the word *agent* holds — what the Model may do is three named operations over a folder
the reader chose, and nothing else.
_Avoid_: function, plugin, skill, command, capability

**Tool Call**:
One request from the Model to one Tool. A Turn is a sequence of them, and each is answered
before the next is made, so a Turn that reads three files has three Tool Calls in it rather
than one that does three things. The reader's own half of a Turn is an **Attachment**, which
is a different thing and is not one of these.
_Avoid_: function call, invocation, request (already the name for a proxied call to an
Endpoint)

**Tool Result**:
What a Tool returns for one Tool Call — a listing, a file's lines, or matches. It stays in
the Saved Conversation and is re-sent on every later Turn, so one can hold the contents of
files off this machine, in the reader's own storage, and be worth naming before sharing it.
_Avoid_: output, response (**Response** is the assistant's answer, and the two must not
drift)

**Grant**:
A standing permission to read one path outside the Root, remembered between Turns. An
addition to the boundary and never a substitute for it: a path is read if it is under the
Root or under a Grant and by nothing else, and with no Root there are no boundaries at all
rather than the Grants alone. Recorded in a file of the app's own, so widening what the
Model may read takes an answer the server has to agree to.
_Avoid_: approval (that is the one-off ask), permission, exception, allowlist entry

**Approval Request**:
The pause put in front of the reader when something outside the Root is about to be read.
Answering one Turn's worth covers that read; answering always records a **Grant**. It is
also raised by a path the reader named themselves, which is a different moment — the reader
asked, the Model did not — and is not dressed up as the first.
_Avoid_: confirmation, prompt

**Attachment**:
A file the reader names in a Turn, whose contents are sent with it. The contents are placed
in the message as a delimited block of text naming the file, never as a file part, because
most Endpoints in the Catalog would not take one and one code path across all of them is
what this app is built on.
_Avoid_: upload, file part

## Storage

**Store**:
Where the app keeps what it needs between visits. Two of them, on different
axes and neither sharing anything: the **Preference Store** holds the Theme and
the Endpoint and Model the reader last chose, and the Conversation Store holds
Saved Conversations. Only the first is a name-and-value slot; the second is a
database, because a Conversation is a growing list of Turns rather than a
string.
_Avoid_: storage, persistence layer, backing store

**Preference Store**:
The browser's own small key-and-value storage, holding the Theme and the chosen
Endpoint and Model. Shared across versions of the app and readable by hand, so
what comes back out is treated as untrusted and anything unusable falls back to
the default. Everything held here is a preference rather than content: it says
how the app is set up, and no Turn is lost by it going missing.
_Avoid_: settings, prefs, local storage

**Conversation Store**:
The reader's browser database of Saved Conversations. Chosen over key-and-value
storage for three reasons that agree: a Conversation outgrows a string budget,
reading it needs no synchronous parsing on the way to first paint, and a write is
all-or-nothing, so a Conversation cannot be observed half-saved.
_Avoid_: database, IndexedDB, persistence

Where storage will not open at all — a reader who has blocked it, or a browser
that will not — the interface says so and carries on without saving. Losing a
Saved Conversation never costs the reader the Turns already on screen.

## Boundaries

**Proxying**:
Relaying a request from the app's server to an Endpoint. Every request in this app is
proxied: no request travels from the browser to an Endpoint directly.
_Avoid_: forwarding, passing through, relaying
