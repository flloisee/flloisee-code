# 04: Catalog-backed Cloud Endpoints

**What to build:** I choose a Cloud Endpoint from a catalog of known providers — OpenRouter, Gemini, and the rest — by name, rather than typing a base URL. The catalog is committed to source control and reviewed like code, because it decides where my Credential is sent.

**Blocked by:** 03 — Model Discovery

**Status:** resolved

- [x] A catalog of known Cloud Endpoints is committed to source control, sourced from the community-maintained models.dev database: provider name, base URL, documentation link, known models, and capability flags
- [x] The catalog is snapshotted into the repository, never fetched at runtime — a live catalog would make Credential forwarding depend on a third party's integrity at request time
- [x] The catalog covers only providers that speak the OpenAI-compatible format, since one integration serves all of them and a per-provider adapter would not
- [x] Local Endpoints are declared by hand alongside the catalog, because the catalog contains no entry for Ollama and local servers are the priority here
- [x] Catalog and hand-declared Local Endpoints present as one unified list in the interface
- [x] A structural check fails loudly if any catalog entry lacks a base URL or an environment variable name, or if two entries collide — the catalog is trusted input that decides where Credentials are sent, so malformed entries are worth catching rather than discovering at request time
- [x] A Cloud Endpoint with no Credential yet appears in the list but is visibly not Configured, so its absence is diagnosable rather than silent
- [x] The interface names the specific environment variable a Cloud Endpoint needs, so I know what to set without reading source

## What landed

`lib/endpoints/catalog.ts` — 187 Cloud Endpoints, 80KB, filtered from a 5.4MB
models.dev snapshot (225 providers) by `scripts/refresh-catalog.mjs`. What was
dropped, and why, is recorded in the file's own header.

`validateCatalog` runs at module load, so `pnpm build` refuses a malformed
Catalog rather than waiting to be discovered at request time. Verified by
injecting a templated base URL, an empty variable name and a duplicate id: the
build fails naming all of them.

`POST /api/endpoints` reports the Registry with each Endpoint's Configured
state. It reads no request body, so no base URL can arrive from a caller.
`EndpointPicker` renders one list, marking Cloud Endpoints with no Credential
and naming the variable to set.

## Judgement calls worth a reviewer's eye

- **The filter is broader than models.dev's own flag.** `npm:
  "@ai-sdk/openai-compatible"` alone would have dropped OpenRouter and every
  `@ai-sdk/openai` gateway. The snapshot takes all three OpenAI-shaped SDKs.
- **Four entries are hand-written** (`handAdded: true`): OpenAI, Gemini, Groq and
  Mistral. Each publishes a first-party SDK rather than the compatibility one,
  and three of them carry no base URL in models.dev at all. Their addresses are
  the least machine-checked thing in the file and are the first place to look
  when reviewing.
- **Five providers were dropped for carrying a `${...}` base URL template**
  (Cloudflare Workers AI, Databricks, Snowflake Cortex, Neon, Infomaniak). Each
  needs an account-specific value; completing one here would have meant guessing
  where a Credential goes. They can be added by hand with the account filled in.
- **LM Studio appears in models.dev but is excluded.** Its address is loopback,
  which makes it a Local Endpoint by the glossary's definition, and the Catalog
  does not cover Local Endpoints. It is therefore not offered by the app. Adding
  it to `LOCAL_ENDPOINTS` is a one-line change and was left out of this ticket.
