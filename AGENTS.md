<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

`.scratch/` is allowlisted in `.gitignore`: only `spec.md`, `map.md`, and `issues/**` are committable, and anything else under `.scratch/` is ignored by default. This repo is public, so anything committed there is permanent. Treat a file as committable only if it is one of those three artifact types and you have read it back and confirmed it holds no Credential, env dump, log tail, or transcript. If a throwaway file must be committed, `git add -f` it deliberately.

### Triage labels

Default five-role vocabulary, recorded as `Status:` lines. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
