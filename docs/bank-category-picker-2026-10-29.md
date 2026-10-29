# Bank Category Picker

## Scope

Japan application only. Not deployed. No production records or category master
definitions were changed. The existing explicit Save All flow is retained.

## Interface

- Desktop: a persistent searchable category list to the right of bank details.
- Mobile/tablet: the same list opens in a right-hand dialog with a close button.
- Broad groups: expenses/purchases, revenue, assets, liabilities, equity, other.
  Existing MF `REVENUE` and `CAPITAL` metadata map to revenue and equity for
  display only; IDs and source groups are unchanged.
- All groups and supplementary categories start expanded. Users can collapse
  individual groups or supplementary lists. Searching includes supplementary categories.
- Categories use compact, horizontally flowing selection tabs that wrap to the
  available width. A parent with supplementary categories starts a new row;
  its supplementary tabs wrap together beneath it, separate from other parents.
  Supplementary accessible names include the parent category name.
  Selection indicators reserve space to avoid moving tabs when selected.
- Each broad group has a full-width heading on its own line, with its tabs on
  the following row and spacing between groups.
- The category cell selects one transaction, or retains an existing selection
  when the clicked transaction is already selected. The list applies to the
  explicitly displayed selection count, including Shift/Ctrl selections.
- Parent selection clears the prior supplementary category. Manual changes
  reset review, preserve memo/treatment/version, and remain drafts until saved.
- Only active categories compatible with every selected company/office appear.
- Category filters, rule editors and category settings use the same broad groups.
- Transaction date and account name are combined with the description to keep
  amounts and categories visible alongside the new list.

## Verification

- 52 focused tests passed, including 5 new category catalog/draft tests.
- ESLint, TypeScript and Next.js production build passed.
- Browser checks at 1440/1280 desktop, 820 tablet and 390 mobile widths.
- Shift selected three rows; Ctrl deselected the middle row. Supplementary
  classification saved exactly the remaining two rows, with no pre-save writes.
- Single-row selection, group expansion, search, mobile application/close,
  settings group headings, and incremental loading from 50 to 65 rows verified.
- Tests used 65 synthetic bank transactions in `tmp/category-picker-data` with
  external integrations unconfigured. Production data was never written.
- Local preview: `http://127.0.0.1:3041/banking?company=JAPAN`.

Screenshots are in `tmp/category-picker-desktop.png`,
`tmp/category-picker-tablet.png`, and `tmp/category-picker-mobile.png`.
