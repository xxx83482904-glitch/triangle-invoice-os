# Dependency security update, 2026-10-09

## Changes

- Next.js and eslint-config-next: 16.2.6 -> 16.3.8. This uses the security-patched
  16.3 release instead of introducing the newer 16.4 feature release.
- Prisma CLI and client: aligned and pinned to 7.10.0.
- Refreshed vulnerable transitive dependencies through non-force npm audit fixes,
  including proxy-addr 2.0.8, sharp 0.35.5, PostCSS, Hono and the MCP SDK.
- Scoped overrides replace Prisma 7.10.0's pinned mysql2 with 3.24.5 and
  @prisma/config 7.10.0's deepmerge-ts with 8.0.0. Remove these overrides once
  upstream uses patched versions. deepmerge-ts 8 changes Map merge semantics;
  the repository's plain-record Prisma config, schema validation and client
  generation were verified. Database migrations and live database connections
  were not run.
- Next dev refreshed its managed AGENTS.md block to the installed-version form.
- No application logic, financial data, API credentials or NAS configuration changed.

## Audit results and remaining risk

`npm audit --json` before: 33 package warnings (2 critical, 23 high, 6 moderate,
2 low). After a clean `npm ci --include=dev`: 9 high, 0 critical, 0 moderate,
0 low. Package warning counts include dependent packages, not nine independent
root vulnerabilities.

All remaining warnings originate from braces <=3.0.3, for which the registry
and advisory currently report no patched release. It is used by micromatch,
fast-glob, eslint-config-next and shadcn tooling. The nine affected package
entries are braces, micromatch, fast-glob, @next/eslint-plugin-next,
eslint-config-next, @shadcn/registry, shadcn, @ts-morph/common and ts-morph.

Do not use `npm audit fix --force` to make the counter disappear: npm proposes
incompatible downgrades of the current tools. Do not suppress this advisory.
Do not pass untrusted patterns or repositories to these tools. Recheck the
upstream fix before the next dependency refresh.

The inspected application server trace files (*.nft.json) contain no references
to the standalone braces/micromatch/fast-glob packages. The app uses shadcn's CSS
at build time and does not import the shadcn CLI at runtime. This is a limited
reachability check, not proof that every dependency is safe. Synology's current
self-deploy installation still includes build tools on disk.

## Verification before deployment

- Clean `npm ci --include=dev` succeeds with the committed lockfile.
- 193 unit tests pass, including PDF generation, status/accounting consistency,
  role scoping, banking, reconciliation and AI request guards.
- ESLint and the Next.js production build (including TypeScript) pass.
- `prisma validate` and `prisma generate` pass with a dummy localhost database
  URL. Neither command connects to or migrates the production database.
- Isolated HTTP checks for AI authorization/settings/consent/no-key guards pass.
- Isolated HTTP reconciliation checks pass: permissions, company/version/amount
  guards, partial/full payment, linked mail, existing payment reuse, unlink and
  persisted Undo. No production data or live AI provider was used.
- Browser click-based workflows remain unverified in the available automation
  session. Production deployment status is recorded in GitHub Actions.

## Sources

- [Next.js 16.3.8 security release](https://github.com/vercel/next.js/releases/tag/v16.3.8)
- [proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
- [deepmerge-ts 8.0.0 release and compatibility notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)
- [Remaining braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
