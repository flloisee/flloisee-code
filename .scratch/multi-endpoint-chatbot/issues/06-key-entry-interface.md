# 06: Key entry interface and Configured status

**What to build:** I enter a Cloud Endpoint's key in a modal in the app, and that Endpoint immediately becomes usable. The interface shows which Endpoints are Configured without ever displaying a stored value.

**Blocked by:** 05 — Key entry route

**Status:** ready-for-agent

- [ ] A modal accepts a Credential for a chosen Cloud Endpoint and submits it to the key entry route
- [ ] The Endpoint becomes Configured and usable immediately, with no dev server restart
- [ ] A diagnostic route reports which environment variable names are set, never their values
- [ ] The interface shows at a glance which Endpoints are Configured, so a missing key is not discovered by hitting a failed request
- [ ] A stored Credential is never rendered back into the interface — the field does not pre-fill with the stored value
- [ ] Local Endpoints require no Credential and are Configured from the start, with no key entry offered for them
- [ ] The interface stays usable on a narrow window, so it can sit beside a terminal
