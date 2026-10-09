# 01: Declare a Root

**What to build:** I can tell the app which folder the Model is allowed to read, and that choice
is still there tomorrow.

The Root is a folder on the machine, chosen by walking to it in the interface. It is recorded in
a file of the app's own and read by the chat route. The browser never names a path — the same
rule that keeps the Key Entry route from accepting a base URL.

**Status:** ready-for-agent

- [ ] `.reading-root.json` beside `.env.local`, holding the Root and the Grants, and excluded
      from version control
- [ ] Written atomically, by temporary file and rename, so an interrupted write cannot leave a
      half-written Root that then reads as unrestricted
- [ ] Missing file means no Root, not an error — the app opens exactly as it did in v1
- [ ] A malformed file is reported as such and treated as no Root, rather than being parsed
      leniently into something that reads wider than what was written
- [ ] `POST /api/roots` walks directories for the reader: given a path, it answers with the
      entries, and it never accepts a path in the request that it did not itself offer
- [ ] `POST /api/roots` declares a Root, and refuses anything that is not a directory that
      currently exists
- [ ] `POST /api/roots` forgets a Root
- [ ] The route refuses to run outside development, as the Key Entry route does — reading a Root
      works in any build, declaring one does not
- [ ] Writing a Root is the only thing in the app that writes outside `.env.local`, and
      `README.md`'s "this route is the app's only file writer" is updated in ticket 10 to cover
      both
- [ ] The folder name is shown in Settings, with a control to change it and one to remove it
- [ ] With no Root chosen, the interface says so rather than offering an empty picker
- [ ] The walk skips `.env*`, so directory listings never put a Credential's filename in front
      of the browser as a row that could be clicked by accident
- [ ] Tests: refuses outside development; refuses a file where a directory was named; refuses a
      path containing a null byte; an interrupted write leaves the previous Root intact; a
      missing file reads as no Root; a malformed file reads as no Root

## Decisions

_Recorded once resolved._

## Comments