# あきらくんと おりょうり

This is an independent static Next.js app, served by the existing Synology host at /akira-kitchen/.
Read the relevant bundled Next.js guides before editing framework code.
Keep every runtime asset URL and Service Worker within /akira-kitchen/.
Do not include source photos, credentials, invoice records, or server APIs in the static export.
Build with npm run build; publish with the parent scripts/copy-akira-kitchen-assets.mjs.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
