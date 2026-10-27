# List Selection

The shared selection hook and checkbox components cover bank transactions, postal documents (both layouts), issued invoices, all documents, received invoices, estimates, projects, clients and vendors.

- Ctrl/Command-click toggles an individual row without discarding other selections.
- Shift-click adds a range in the current visible order. The original anchor remains fixed during consecutive Shift selections. Ctrl/Command+Shift has the same additive range behavior.
- A checkbox toggles independently; Shift-check checks a range, Shift-uncheck clears a range.
- Space toggles a focused row or checkbox, including Shift+Space range selection. Enter keeps existing preview behavior, except modifier+Enter selects.
- The shared 44px checkbox hit target, partial-selection indicator, selected count and clear action are consistent on desktop and mobile.
- Select all affects rendered, expanded rows only, not unloaded or collapsed items. Existing selections outside the visible scope are retained and counted explicitly.
- Text inputs, selects, status/review checkboxes, action menus and real links retain their own behavior. Preview buttons explicitly opt in to modifier selection. Selection never saves records, changes statuses, confirms payments or expands permissions.
- Reconciliation remains a deliberate one-at-a-time workflow; selection shortcuts never bypass confirmation or turn it into bulk payment confirmation. Settings toggles and single-record editors are not record-selection checkboxes.

## Verification

`node --conditions=react-server --import tsx --test tests/*.test.ts`

`npm run lint` and `npm run build`

Disposable browser fixture: `node --conditions=react-server --import tsx tests/prepare-document-preview.ts --selection`. Use only its temporary `DATA_DIR` and local test credentials. Check Ctrl/Command, Shift forward/backward, range uncheck, Space, select all/partial state, filters/collapse, appended rows, controls and preview isolation, existing bulk drafts and postal drag/drop. Do not run financial mutation tests against production.

Verified 2026-10-27: 274 tests, ESLint and production build passed. Browser checks passed for Ctrl/Command toggles, Shift ranges, Shift-uncheck, Space/Shift+Space and clear across the eight primary routes plus the vendor tab. Postal folder mode also passed modifier selection. Touch selection, 44px checkbox targets and absence of page-level horizontal overflow were checked at 390, 820 and 1440px. Bank selection survived 50-to-75-row loading and a range across that boundary. Collapsed postal folders were excluded from new ranges and select-all; existing hidden selections were counted. Preview modifier clicks and bank memo controls did not trigger unintended actions. The fixture data hash remained unchanged through selection and bulk-classification draft checks. A later explicit two-row postal month move changed only the selected rows. Native drag synthesis did not complete a drop in this browser; existing drag handlers were retained, and the same selected-row move path was verified via the bulk month control.
