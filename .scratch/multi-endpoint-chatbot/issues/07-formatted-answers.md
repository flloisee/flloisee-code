# 07: Formatted answers

**What to build:** Answers render as formatted text rather than a wall of unstyled characters, so lists, headings, and code in a Response are legible.

**Blocked by:** 01 — Chat with a Local Endpoint

**Status:** resolved

- [x] Formatted answers render as formatted text: lists, headings, emphasis, and links are visually distinct
- [x] Code blocks in a Response are readable, and a snippet can be copied out of the Conversation
- [x] Streaming still works with formatting — text renders progressively rather than appearing only once complete
- [x] Long code blocks do not break the layout on a narrow window
- [x] A malformed or partially-streamed Response does not break rendering or throw

## Notes

`components/markdown.tsx` renders a Response; `Turn` in `components/chat.tsx` uses it
for the assistant side only, so what the user typed is still shown verbatim.

A Response is treated as untrusted text: `rehype-raw` is deliberately absent, URLs go
through an allowlist, and images are not rendered. See the header comment there.

`remark-gfm` was added for tables and strikethrough — model output emits pipe tables
constantly and they are unreadable without it.

Narrow-window layout and progressive appearance were verified by running the app, not
by an automated browser test: no browser automation is available in this environment.