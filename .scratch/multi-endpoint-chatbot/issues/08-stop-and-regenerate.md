# 08: Stop and regenerate

**What to build:** I can abandon a Response that is taking too long, and retry the last one when an answer disappoints me.

**Blocked by:** 01 — Chat with a Local Endpoint

**Status:** ready-for-agent

- [ ] Stopping an in-progress Response halts generation and leaves the partial text visible
- [ ] A Stop control appears while a Response is in progress
- [ ] After stopping, I can send a new message
- [ ] Regenerating the last Response re-runs it and replaces the previous answer
- [ ] Regenerate is available only when no Response is in progress
- [ ] Stopping or regenerating does not disturb the rest of the Conversation
