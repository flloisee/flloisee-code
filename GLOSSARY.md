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
An Endpoint served from the machine running the app. Requires no Credential.
_Avoid_: offline endpoint, self-hosted endpoint, on-prem endpoint

**Cloud Endpoint**:
An Endpoint served by a third party over the network. Requires a Credential.
_Avoid_: remote endpoint, hosted endpoint, online endpoint

**Registry**:
The full set of Endpoints the app offers: Cloud Endpoints drawn from the Catalog,
Local Endpoints declared alongside it. Endpoints are added through the interface or by
editing source, not by the app fetching a list at runtime.
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
the user enters their own key on their own machine.
_Avoid_: key setup, credential configuration, onboarding

**Catalog**:
The reviewed set of known Cloud Endpoints held in source control, supplying base URLs
and Credential variable names. Reviewed as code because it decides where Credentials are
sent. It does not cover Local Endpoints.
_Avoid_: registry, provider list, directory

## Models

**Model**:
A named AI model reachable through an Endpoint, addressed by the identifier that
Endpoint's server recognizes.
_Avoid_: engine, checkpoint, agent

**Model Discovery**:
Asking an Endpoint which Models it currently offers, so a Model is chosen from a list
rather than typed from memory. Every Endpoint need not support it.
_Avoid_: model enumeration, listing, scanning, probing

## Conversation

**Conversation**:
The ordered sequence of Turns currently held in the interface.
_Avoid_: chat, session, thread, history

**Turn**:
One user message together with the assistant response it produced.
_Avoid_: exchange, round trip, request, interaction

**Response**:
The assistant's answer within a Turn, reaching the interface incrementally as the
Endpoint produces it rather than all at once on completion.
_Avoid_: reply, completion, output

## Boundaries

**Proxying**:
Relaying a request from the app's server to an Endpoint. Every request in this app is
proxied: no request travels from the browser to an Endpoint directly.
_Avoid_: forwarding, passing through, relaying
