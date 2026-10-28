# Issued estimates: consistent document operations

## Behavior

- `/estimates` follows the issued-invoice list: client grouping by default, month/client/status filters, date/amount/project sorting, and collapsible groups.
- Document ordering, project-name normalization and selection behavior reuse the existing shared helpers. Shift selects a visible range; Ctrl/Command toggles individual rows. Folded or filtered rows do not join a new range. Previously selected hidden rows are counted explicitly.
- Project/status edits and preview date edits remain local until **Save all**. Bulk status changes use the same draft state. No automatic persistence is introduced.
- Changing a project also changes the estimate's client to that project's active client. Status-only edits preserve any explicitly selected client.
- Preview stays alongside the list on desktop and below it on smaller screens. PDF generation uses saved data; unsaved edits are identified above the PDF. Line-item editing remains in the protected dialog.
- Selected estimates can be soft-deleted after confirmation. Converted estimates cannot be edited, deleted, or converted a second time. Conversion still creates one draft invoice, without adding receivables or payments.
- Editing line items, creating, deleting and converting are blocked while list drafts exist, so pending changes cannot be silently discarded.
- Lists load 50 rows initially and progressively reveal the remaining rows on scroll, with a load-more button as fallback.

## Safety

Batch actions authenticate the actor, enforce role/company/source and destination project access, validate active destination clients, and check each record's version. Every target is validated before any record changes. A stale, duplicate, invalid or converted target rejects the entire batch. Existing audit/undo infrastructure is retained.

## Verification

- `node --conditions=react-server --import tsx --test tests/*.test.ts`: 292 passing tests, including 8 new batch-edit tests.
- Lint and production build.
- Local disposable fixture: `node --conditions=react-server --import tsx tests/prepare-document-preview.ts --selection --estimates`.
- Browser checks: Shift/Ctrl, draft-only bulk classification, Save all, filters, group collapse, progressive loading past 50, linked client changes, batch deletion, create with multiple line items, and conversion to a draft invoice.
- Responsive checks at phone, tablet and desktop widths; generated estimate PDF endpoint returns HTTP 200 with a valid PDF signature. The in-app browser does not paint the embedded PDF during this verification.
- Production data is not used for testing. This change has not been deployed.
