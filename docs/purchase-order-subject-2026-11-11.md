# Import Purchase Orders and Document Subjects

## Scope

- Import shipment details have a Purchase Order tab with PDF/JPEG/PNG upload, existing original preview and attachment management.
- `PURCHASE_ORDER` is an optional import document kind, not a new required customs checklist item.
- Explicit purchase-order uploads remain customs paperwork, never automatically create received invoices, and never fill customs amounts.
- Invoice creation/detail editing and estimate creation/editing expose a subject field (500 characters).
- Subjects use the existing `pdfText.subject` storage, so the PDF editor and ordinary form agree. Clearing the field restores the project-derived default; omitted fields preserve existing wording.
- Estimate conversion carries the subject to the invoice without copying estimate-specific headings. Existing uploaded originals are not rewritten.
- No data migration, credentials or infrastructure configuration changes.

## Verification

- 163 targeted tests passed, including intake persistence, classification, access control, estimate conversion and PDF tests.
- TypeScript checked all `src` and `tests` successfully. The ordinary repository-wide check also includes an unrelated old build under untracked `tmp`; that copy was excluded from this check without changing the shared tsconfig.
- ESLint passed for the changed implementation and test files checked.
- Production compilation, type checks and static generation passed in a clean temporary worktree. Dependencies were junction-linked locally, producing standalone tracing warnings; no local build artifact is deployed. NAS builds its own artifact.
- Playwright on isolated synthetic data: purchase-order upload/reload; estimate create/edit/convert; invoice subject save/reload; no browser runtime errors.
- Layout inspected at 1440, 820 and 390 pixels for the purchase-order tab and desktop/mobile estimate editor. No page-width overflow.
- Preview: http://127.0.0.1:3042 (synthetic data only).

## Deployment

Japan deployment requested by the user. Use the existing `Deploy Synology` main-push workflow and verify the exact commit at `/api/version` plus HTTPS login response. Do not include unrelated dirty notes or `tmp` files. China deployment is not part of this change.
