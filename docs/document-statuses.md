# Document Statuses

Updated: 2026-09-15

## Issued Invoices

- Shared labels live in `src/lib/invoice-status.ts`: draft, issued, sent,
  unpaid, partially paid, paid, overdue, canceled, and reissued.
- The list, preview, and bulk selection edit statuses through the existing
  Save All action. Paid/unpaid filters are available in the issued list and
  in All Documents when the issued-invoice kind is selected.
- Marking paid requires a payment date. A confirmation shows the remaining
  amount before creating an INCOME payment tagged `source: INVOICE_STATUS`.
- Original-document confirmation is optional when saving edits. Issue date,
  due date and amount can remain empty; entered dates must still be valid.
  Paid status requires a positive amount and a date for any new income record.
  Saving never silently checks the OCR confirmation box or invents document dates.
- Repeating paid never adds the same amount twice. Stale versions are rejected.
- Returning to unpaid soft-deletes only active payments with that source tag.
  Separately recorded income is retained; remaining partial income yields
  partially paid. A fully paid manual payment cannot be canceled this way.
- Partial payment is derived from actual payment records, not set arbitrarily.
- New manually created invoices can start as paid using the same validation.
- Paid invoice amounts and projects cannot be changed while income remains.
- Batches validate on isolated copies and commit invoice/payment arrays together.
  One invalid row prevents the entire batch from being saved.

## Consistency and Access

- Invoice lists, All Documents, project details, payment management, guest
  invoice views and invoice CSV exports derive payment status from active income.
- Existing financial calculations use those same payment records. Draft,
  canceled and zero-amount invoices remain excluded from billable totals.
  OCR warnings are informational: an explicitly selected issued/payment status
  is included even without OCR confirmation. Paid filters and labels likewise
  keep such invoices visible; their OCR warning remains separately displayed.
- Historical status fields are not mass-rewritten on deployment. A conflicting
  displayed status is resolved from actual payment records at read time.
- Received-invoice PAID still means payment made, not income received.
  Mail processing and received-invoice payment behavior are unchanged.
- Status updates retain company, assignment, role and version checks.
  Japan billing staff can update their permitted issued invoices; this does not
  grant access to dashboards, payment management, China, or other document kinds.
- Audited updates participate in existing Undo, including their payment changes.

## Estimates

- Draft, sent, accepted and declined are directly selectable in the list,
  preview and All Documents, using a shared status control.
- These estimate-only changes save immediately and never affect financial totals.
- Converted estimates are locked. Conversion remains idempotent and creates a
  draft invoice; changing an estimate status does not create income.

## Verification

- `npm run test:statuses`: nine focused tests covering payment reconciliation,
  reversal protection, duplicate/stale requests, atomic batches, scope, historical
  status consistency, incomplete/unreviewed saves and estimate status restrictions.
- Document, estimate and PDF suites: 43 tests total including status tests.
- Isolated local browser checks: paid confirmation/cancel, unpaid reversal,
  paid/unpaid filters, paid-on-create, SHIFT bulk update, Undo of income,
  estimate preview/list/All Documents synchronization, and converted locks.
- Desktop 1440px, tablet 768px and phone 390px layouts inspected. Status controls
  are 44px high; no page-level horizontal overflow was observed.
- Production verification must be read-only. Do not create test income or
  change real document statuses during deployment checks.
