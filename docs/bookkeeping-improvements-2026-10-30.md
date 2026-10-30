# Bookkeeping workflow improvements - 2026-10-30

## Scope

Implements the improvement backlog recorded in `bookkeeping-ux-observations-2026-10-30.md` after explicit user approval. Japan application only. No live classifications, payment allocations, source files, login settings, or China application data are migrated by this release.

## Selection, Classification, and Saving

- Separate display-only predictions from explicit edits. Merely loading more rows does not adopt their predictions.
- Save selected rows, reviewed edits, or all explicit edits independently, with a before/after preview and exact counts.
- Select the full filtered result without scrolling first; excluded rows are not implicitly selected. Explicit deselections remain visible in the save scope.
- Persistent bulk review and save controls, pending/result counts, and retained drafts after failures.
- Per-row optimistic versions and live authorization checks. A failed later save batch does not erase unsaved drafts; successful batches are identified separately.
- Exact-description and excluded-term search, highlighted matches, and composed filter edits.
- Continuous loading beyond 50 rows; CSS `content-visibility` defers offscreen paint without imposing paged navigation. This is not DOM virtualization.
- Stale/loading failures retain selections and edits, with explicit refresh/retry.
- Historical conflicts remain warnings, not automatic confirmation. Held and split rows are not overwritten by classification suggestions.

## Bookkeeping Detail

- Split one transaction into multiple categories with positive whole-yen allocations that must exactly balance to the source amount.
- Category totals, filters, review state, exports, and undo recognize splits without duplicating bank cashflow.
- Structured holds retain a reason and question. Held rows cannot be confirmed or reconciled until resolved.
- Invoice requirement is separate from accounting inclusion. Invoice-unnecessary expenses remain in expense totals but leave the normal reconciliation queue.
- Duplicate candidates show source identifiers and matching evidence. They are not automatically deleted or merged.
- Transfers cannot silently consume held or split transactions. Active transfer locks and corrected-source checks remain enforced.

## Reconciliation

- Allocate one bank movement across multiple invoices in one balancing editor, then validate and commit the batch atomically.
- Show bank remaining, invoice outstanding, recorded payments, bank-linked amounts, and originals together.
- Reuse existing payment records where appropriate; warn and require acknowledgement before potentially duplicating payments.
- Register reviewed payer aliases by company, account, and direction. Alias similarity never confirms payment automatically.
- Store installment schedules separately from actual receipts. Planned dates never create payments.
- Display document processing, payment recording, and bank reconciliation as distinct states.
- Card settlement and internal-transfer treatment remain separate from invoice payments.

## Received Invoices and Originals

- Validate issuer information separately from remittance-bank information and surface OCR field evidence.
- Distinguish invoice dates from due dates, warn on inconsistencies, and keep blank dates saveable for incomplete OCR.
- Represent gross, withholding, and net payable independently. `total` remains net payable for payment matching.
- Preserve legacy unknown breakdowns on unrelated edits; reject unbalanced explicit edits and reductions below recorded payments.
- Side-by-side original review, missing/invalid-file errors, retry, and open/download fallback when embedded PDF rendering is blank.

## History and Safety

- Scoped classification/bookkeeping history with before/current details and individual undo.
- Post-change fingerprints block undo after later edits or source corrections. Linked payments/transfers must be resolved before classification rollback.
- Retain canceled bank history within the existing 50-patch retention limit. Legacy logs without a post-change fingerprint are read-only.
- Existing source identifiers, imported amounts, reconciliations, and approved production classifications are not rewritten by deployment.

## Operational Limits

- Full matching selection is bounded at 5,000 rows; larger work should be narrowed by month/account/search.
- Classification saves are atomic per 100-row batch, not across every batch. The UI reports saved and remaining counts.
- Duplicate detection identifies candidates, not proof of duplication. Uncertain purposes still need source documents or user confirmation.
- PDF embedding depends on the browser PDF viewer; the original open/download fallback remains available.
- External AI/OCR providers are not called by synthetic verification; provider availability is not guaranteed by local tests.

## Verification

- Synthetic local data only; no production writes during browser testing.
- Selected single-row review/save verified against the fixture: exactly one row changed, an unselected prediction stayed unassigned.
- Select 149 filtered rows, exclude one, and preview exactly 148; two excluded search terms correctly removed their matching rows.
- Split 3,300 into 3,000 and 300; source cashflow unchanged.
- Allocate a 330,000 receipt to two invoices at 165,000 each; exactly two payment/link records and both invoices partially paid.
- Tested original-preview errors and blank-date saves with synthetic documents.
- Final tests: 434 passed, zero failures. Changed TypeScript/TSX files pass ESLint. Source typecheck passes with the existing unrelated `tmp` build copies excluded.
- Clean isolated `NODE_ENV=production` install (816 packages) and production/standalone build passed with no tracing omissions. No real `.env` or uploads were copied into this final build.
- Browser verified Shift selection of five rows, continuous scrolling/loading to all 149 matching rows, desktop light theme, mobile dark theme without horizontal page overflow, and tablet reconciliation layout.
- Local proof: `tmp/bookkeeping-improvements-desktop-20261030.jpg` (synthetic records, not committed).
- Deployment result will be recorded after GitHub Actions and production verification.
