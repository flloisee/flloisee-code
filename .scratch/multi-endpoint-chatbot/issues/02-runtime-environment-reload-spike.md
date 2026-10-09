# 02: Spike — confirm environment reload at runtime

**What to build:** A written answer to one question: after writing a Credential to the environment file, does the running server process pick it up immediately, or must it restart?

This is a spike, not user-visible behaviour. It exists because the whole key-entry path depends on the answer, and the assumption has already been wrong once — an earlier draft of the spec asserted a restart was unavoidable, which was incorrect.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The framework's environment loader is invoked at runtime and confirmed to replace the running process's environment in place
- [ ] Confirmed by execution, not by reading the export's signature or documentation — reading the signature is what produced the earlier wrong answer
- [ ] A variable written to the environment file is readable by a subsequent request without a dev server restart
- [ ] The behaviour is checked under `next dev`, which is how this app is actually run; if it differs under `next build`/`start`, that difference is recorded
- [ ] The finding is written down, including any conditions under which it stops holding
- [ ] If reload does not work, the fallback is recorded too: a clear in-interface prompt to restart, since ticket 05 depends on this answer
