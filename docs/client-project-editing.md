# Client editing and invoice installment projects

Implemented and verified locally on 2026-09-28. The user requested deployment
on the same date through the existing main-branch Synology workflow. Future
changes still require an explicit deployment request.

## Behavior

- Partners: add clients, edit contact and company details with the pencil
  button, and soft-delete unused clients with the trash button. Used clients
  and default system clients cannot be deleted. Edits preserve IDs and links.
- Server-side validation checks role, company, version, names and email.
  Duplicate active names and billing installment descriptions are rejected.
  Both regular forms and the quick-create API use the same validation.
- Outgoing invoice OCR separates explicit installment suffixes from the
  project name. Numeric and Japanese numeral variants are supported.
  Installments are not client names. Ambiguous subjects remain provisional.
- Invoice and estimate records can store `billingLabel`. Lists and generated
  PDFs retain this description; estimate conversion copies it to the invoice.
- The issued-invoice page offers a project cleanup dialog only when safe
  candidates exist. No data is changed by loading the page. Each group must
  be explicitly confirmed. This is not an automatic production migration.
- Cleanup requires the same client, company and project access membership.
  Retired projects must be untouched OCR-created placeholders without
  contracts, custom metadata, expenses or project attachments. Ambiguous
  groups are omitted. Concurrent changes invalidate the preview signature.
- Cleanup retains document IDs, recipients, amounts, payment records, files,
  and soft-deleted history. It preserves installment descriptions before
  redirecting invoice/estimate project IDs and soft-deleting duplicates.
  Changes use the existing audited `mutateData` mechanism with Undo support.
- Invoice creation, estimate editing/conversion and client editing dialogs
  ignore outside clicks and Escape. The close icon remains available except
  while a controlled save is pending. Successful saves still close normally.

## Verification

```powershell
node --conditions=react-server --import tsx --test tests/documents.test.ts tests/estimates.test.ts tests/status-consistency.test.ts tests/document-editing.test.ts
npm.cmd run test:invoice-pdf
npm.cmd run build
```

For disposable browser fixtures:

```powershell
npx.cmd tsx tests/prepare-document-preview.ts --installments
```

The script prints an isolated temporary DATA_DIR with synthetic documents,
three installment projects and a test billing user. Never use production
DATA_DIR or real client data for these browser checks.

Verified client create/edit/delete, confirmed consolidation, preserved labels,
outside-click/Escape protection, explicit close, responsive layouts, and PDF
rendering. Production data and deployment configuration were not changed.
