# Banking UI Deployment

## Status

Deployment requested on 2026-10-29 after approval of the ledger redesign and
dark theme. Release preparation passed; production deployment has NOT started.
Do not claim the UI is live or trigger the workflow until the hostname is
confirmed to point to the intended application again.

## Prepared Scope

- Desktop banking ledger with horizontal navigation and fiscal month tabs.
- Expanded, grouped category catalog on the right; responsive category drawer.
- Review tags instead of review checkboxes, draft-only bulk confirmation, and
  explicit Save All. Existing selection, filtering and reconciliation retained.
- Light/dark styling scoped to the banking detail screen.
- No production records, authentication settings or China deployment changes.
- Excluded from the release: unrelated `docs/ui-ux-changes.md` and all of `tmp/`.

## Preflight Results

- Local `main` and `origin/main` matched at `0d2499a` before release preparation.
- `npm run build`: passed, including standalone asset copy.
- `npm run lint`: passed.
- Focused ledger/catalog/selection/navigation/banking tests: 47 passed.
- Previous implementation verification: 147 banking tests and 28 focused UI
  helper/navigation tests passed; screenshots and interaction checks are in
  `design-qa.md`.
- Last successful production workflow found: `40802368569`, commit
  `05ce1d22e7d1943b4cbc958505dbaaf2670b5706`.

## Deployment Blocker

Read-only checks at about 2026-10-29 09:43 UTC:

- HTTPS GET to `https://invoice.kuremasato.com/login` timed out. No deployment
  token or other authentication header was sent.
- Local DNS and resolver `1.1.1.1` both returned `160.251.64.80` for the host.
- Nameservers for `kuremasato.com` were `dns1.onamae-expired.com` and
  `dns2.onamae-expired.com`, not the intended Cloudflare delegation.
- Verisign RDAP independently returned those nameservers. It reported status
  `active`, expiration `2027-10-28T10:47:25Z`, and last change
  `2026-10-29T08:14:17Z`. The registry date alone does not establish whether
  registrar payment/renewal and DNS restoration have completed.

The existing GitHub Actions workflow sends its secret to the configured public
deployment URL and skips certificate verification. Pushing `main` would start
that workflow. Therefore no push, workflow dispatch, deployment POST, DNS edit,
payment, NAS restart, or production modification was performed.

The user was asked to check renewal/status in Onamae.com. Official guidance
describes automatic nameserver changes after expiry and restoration after
renewal; do not infer payment status from registry expiration alone:

- https://help.onamae.com/answer/14359
- https://help.onamae.com/answer/14357

## Resume Safely

The user subsequently confirmed renewal. Registry delegation returned to
`anderson.ns.cloudflare.com` / `anna.ns.cloudflare.com`. A strict-TLS request
to the authoritative Cloudflare address returned HTTP 200 and the Invoice OS
login. Recursive DNS caches still briefly returned the old address.
The deployment workflow now verifies TLS, uses bounded connection/request
timeouts, and requires the expected unauthenticated deployment-endpoint response
before sending its token. Deployment completion must still be verified below.

1. Confirm the registrar status and restoration of the intended Cloudflare DNS.
2. Check strict-TLS HTTPS and verify the intended Invoice OS application responds.
   Never send a deployment secret to the current expiry destination.
3. Fetch `origin/main`; inspect any new commits before pushing this prepared
   change. Do not overwrite another contributor's changes.
4. Push only the approved code/test/documentation commit to `main`, using the
   existing Japan-only Synology workflow.
5. Verify the workflow's exact commit, completed NAS build/restart, and strict-TLS
   production response. Inspect the deployed UI read-only; do not alter bank data.
6. Record the successful run and report the production URL. China remains a
   separate deployment.
