# Design Fee Calculator — Synology deployment

Requested on 2026-10-12. Deployment uses this repository's existing `Deploy Synology` GitHub Actions workflow on `main`, targeting the Invoice OS NAS container.

Entry URL: https://trianglejp14f.synology.me/design-fee-calculator

Custom-domain URL (same NAS application): https://invoice.kuremasato.com/design-fee-calculator

Editable quotation and PDF workflow: see `docs/quotation-editor.md`.

The entry redirects to `/design-fee-calculator/index.html`. The calculator is an independent static React/Vite app. It needs no login, database, server API or external credentials. It does not read or modify Invoice OS financial records. Existing Invoice OS authentication is unchanged.

## Update

```powershell
npm --prefix design-fee-calculator ci
npm --prefix design-fee-calculator test
npm run build:design-fees
npm run build
```

Commit the calculator source and generated `public/design-fee-calculator/` together. `scripts/copy-design-fee-assets.mjs` copies the build without removing previous hashed assets, allowing cached pages to finish loading safely. The existing Invoice OS `postbuild` copies `public/` into the standalone server bundle on the NAS.

Push `main` only after an explicit deployment request. Verify the workflow's exact commit, NAS build/restart, `/login` health, and calculator HTML/asset hashes before reporting completion. GitHub Actions owns the deployment credentials; no secrets are added to the calculator.

Settings: `design-fee-calculator/src/pricing.ts`. App usage and tests: `design-fee-calculator/README.md`.

The initially mistaken Sites registration remains an unused, unpublished shell. Its ID is recorded in `design-fee-calculator/docs/unused-sites-registration.json`; it is not a deployment target and received no app code.
