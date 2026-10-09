# 04: Catalog-backed Cloud Endpoints

**What to build:** I choose a Cloud Endpoint from a catalog of known providers — OpenRouter, Gemini, and the rest — by name, rather than typing a base URL. The catalog is committed to source control and reviewed like code, because it decides where my Credential is sent.

**Blocked by:** 03 — Model Discovery

**Status:** ready-for-agent

- [ ] A catalog of known Cloud Endpoints is committed to source control, sourced from the community-maintained models.dev database: provider name, base URL, documentation link, known models, and capability flags
- [ ] The catalog is snapshotted into the repository, never fetched at runtime — a live catalog would make Credential forwarding depend on a third party's integrity at request time
- [ ] The catalog covers only providers that speak the OpenAI-compatible format, since one integration serves all of them and a per-provider adapter would not
- [ ] Local Endpoints are declared by hand alongside the catalog, because the catalog contains no entry for Ollama and local servers are the priority here
- [ ] Catalog and hand-declared Local Endpoints present as one unified list in the interface
- [ ] A structural check fails loudly if any catalog entry lacks a base URL or an environment variable name, or if two entries collide — the catalog is trusted input that decides where Credentials are sent, so malformed entries are worth catching rather than discovering at request time
- [ ] A Cloud Endpoint with no Credential yet appears in the list but is visibly not Configured, so its absence is diagnosable rather than silent
- [ ] The interface names the specific environment variable a Cloud Endpoint needs, so I know what to set without reading source
