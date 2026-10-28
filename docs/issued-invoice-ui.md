# Issued invoice workspace

Updated: 2026-10-28. Local changes only; not deployed.

## Interaction contract

- Banking and issued invoices share month navigation and the sticky Save All bar.
- Issued invoices open newest first. Search submits with Enter or the search button.
- Client, status, payment state, grouping, and sort order are independent filters.
- Groups can be collapsed. Scroll loads additional batches of 50, with a manual fallback button.
- Shift selects a range; Ctrl/Command toggles rows using the existing shared selection hook.
- Status, project, and optional OCR review changes remain drafts until Save All.
- Bulk project changes exclude invoices with recorded payments. The server remains authoritative.
- Clicking a document opens a dialog with edit/payment and original/OCR tabs. Closing it preserves drafts.
- Navigation with unsaved changes offers cancel, discard, or save before moving.
- Marking invoices paid retains the existing explicit payment-date confirmation and atomic server action.
- Displayed paid/outstanding amounts come from saved payment records, not speculative draft statuses.
- Aggregate amounts exclude drafts/canceled invoices and require the existing reports permission.
- The all-documents screen retains its existing grouping and side preview.

## Local verification

- Production build, lint, TypeScript, and 298 unit tests passed before the additional bank-balance changes.
- Test-only fixture: `tests/prepare-document-preview.ts --selection --installments --issued-list`.
- Verified month filtering, submitted search, Shift/Ctrl selection, bulk status/project/review changes.
- Confirmed that drafts did not modify fixture storage before Save All.
- Saved three invoices together, then saved a paid invoice through the navigation guard and payment confirmation.
- Verified 88 records load by scrolling, and client groups collapse.
- Verified invoice modal at 390px and table at 820px; fixed and reverified the shared page header's mobile width constraint in the final build.
- Billing-editor login hides aggregate totals and banking navigation.
- Original-file tab preserves the existing PDF endpoint/iframe. The in-app browser does not paint the embedded PDF in this environment; visual PDF rendering is not claimed.

Production data and authentication settings were not changed.

Final combined validation, including bank balances and Aplus settlements: production build, lint, TypeScript and 323 tests passed.
