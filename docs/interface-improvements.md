# Interface improvements, 2026-10-09

Local implementation only. No deployment, commit or production data changes.
Existing AI, bank reconciliation and spending work is preserved. The other AI's
`docs/ui-ux-changes.md` is unchanged.

## Screen review

The current product was inspected using the isolated synthetic preview on port 3018.
This was a review of rendered screens, not a completed interactive workflow audit.
Browser automation clicks had no effect, so modal submission, keyboard focus movement,
selection changes and drag/drop were not verified end to end in the browser.

1. Mail list: month folders and inline statuses already supported the task. The header
   mixed selection, deletion, folder creation, column sizing, and display modes; no
   search field was present. The nested page/card headings duplicated the title.
2. Issued invoices: editable project/status fields and a consistent document list were
   useful. Screen-navigation buttons competed with creation; selection actions mixed
   with filters, and clearing all filters was only obvious in the empty state.
3. Bank movements: monthly navigation and editable categories were useful. Navigation
   to reconciliation/analysis/forecast shared the same toolbar as saving/synchronizing.
   The mobile primary navigation did not expose banking for accounting users.

Captured evidence is in the local preview directory
`C:/Users/kure/AppData/Local/Temp/triangle-banking-preview-IVVHx8/`:

- `ui-01-mail-before.jpg`
- `ui-02-issued-before.jpg`
- `ui-03-bank-before.jpg`
- `ui-mail-after.jpg`, `ui-mail-mobile.jpg`
- `ui-issued-tablet.jpg`, `ui-bank-after.jpg`

These images contain synthetic records, not production financial data.

## Implemented changes

- Shared navigation is grouped into overview, documents/projects, money/analysis,
  and management. Every existing destination and permission gate is retained.
- Role-specific mobile shortcuts put mail, invoices and banking in reach for admins
  and accounting users. Billing-only and mail-only restrictions are unchanged.
- Related-page tabs connect projects/estimates/invoices, mail/received invoices,
  and bank movements/reconciliation/AI checks/spending/forecast. Selected company and
  compatible bank account/month filters carry across; row IDs and unrelated filters do not.
- Current destinations use `aria-current`; document modes use `aria-pressed`. A keyboard
  skip link targets the main content. New tabs and principal mail controls have 44px targets.
- Shared page headings are unframed and compact. Existing page bodies and financial
  calculations are preserved, rather than rewritten for a new visual style.
- Mail search matches sender, filename, project/vendor and the already loaded OCR excerpt;
  case and Japanese full-/half-width variations are normalized. It is not full OCR search.
- Mail status tabs show totals across all mail, classification supports all seven categories,
  and search/filter reset is always available when a filter is active.
- Folder creation is a dialog with error/pending states; it closes only on successful save
  or the close control, not outside click or Escape. The entered month survives a failed save.
- Selection actions appear separately; mail and document lists disclose selected records
  hidden by filters. Duplicate selection now respects the current mail filters.
- Column-width controls appear only in folder mode, where those controls have an effect.
- Issued/all-document lists show filtered/total counts, a persistent filter reset while
  filtered, and a separate bulk-action bar. Existing selection, save and payment confirmation
  logic is preserved. Bank movements also have a one-click filter reset with the existing
  unsaved-change protection.
- AI review is reached from the shared banking tab strip; the redundant inner AI tab was
  removed. Bank-side and invoice-side reconciliation remain available.

## Verification

- Unit tests: 193 passed, including seven navigation/scoping/search tests.
- TypeScript, ESLint and production build passed.
- Existing real-HTTP AI authorization/settings/no-key guard checks passed with no change
  to financial or AI-usage data.
- All 12 main-menu pages loaded with their expected heading at 390x844, 768x1024 and
  1440x1000. In each tested default state, document scroll width equaled client width.
  Internal horizontal scrolling of wide accounting tables remains intentional.
- Mail and issued-invoice screens were inspected visually on representative device sizes.
  Existing responsive behavior, account scoping, and lower-privilege navigation have unit coverage.
- Limits: not a claim of complete accessibility compliance or all-state layout coverage.
  Browser-click-based modal, search, filter and drag/drop flows still need interactive QA.
  No live AI request, upload, payment update or deployment was performed for this UI work.

## Main files

`src/lib/app-navigation.ts`, `src/lib/mail-search.ts`,
`src/components/app/company-switch.tsx`, `shell.tsx`, `documents-workspace.tsx`,
`banking-workspace.tsx`, `bank-reconciliation-workspace.tsx`, `bank-reconciliation-link.tsx`,
`src/app/mail-sorter/ocr-documents-table.tsx`, and `tests/app-navigation.test.ts`.
