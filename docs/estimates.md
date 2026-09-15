# Estimates

- `/estimates?company=JAPAN` lists quotations separately from invoices. Create/edit includes project, customer, date, validity, status, variable line items, customer notes and private notes.
- Saved quotations support PDF preview, right-click/overflow menus and soft deletion. The PDF shares the invoice's ruled A4 layout, bundled font and private company seal. Company name precedes the address. Quotes contain validity rather than bank/payment instructions; internal notes never print.
- Conversion asks for invoice, transaction and due dates, preserves amounts and line items, and creates a linked DRAFT invoice. The source quote remains readable but locked. A retry returns the same invoice; a deleted target is not silently recreated.
- `AppData.estimates` is normalized to an empty array for older JSON/Postgres records. There is no Prisma migration. Undo patches include estimates; legacy snapshots without estimates leave that collection intact.
- Estimates and converted invoice drafts are excluded from invoiced/payment totals. Estimates also appear in the canonical all-documents list. Permissions follow issued-invoice roles and project scope. BILLING_EDITOR sees Japan only; MAIL_EDITOR has no access.
- Tests: `npm run test:estimates`, `npm run test:documents`, `npm run test:invoice-pdf`.
- The PDF route's standalone tracing must include `public/fonts/BIZUDMincho-Regular.ttf`. The real seal stays outside Git, at `DATA_DIR/company-seal.png`; tests use a synthetic red fixture.
