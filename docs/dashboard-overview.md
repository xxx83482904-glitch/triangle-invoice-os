# Dashboard overview (2026-10-28)

- The default fiscal year is the current September-August year, independent of the latest imported bank month.
- Bank cash uses manually registered day-end balances plus subsequent bank movements. Card purchases are not cash accounts; missing statement coverage remains visibly provisional.
- Unpaid totals are calculated per invoice from saved payments. Overpayments cannot offset another invoice. Canceled/draft issued invoices and rejected/archived received invoices are excluded from financial totals.
- Paid status without supporting payment records is shown as a review issue, not an overdue collection reminder.
- Open receivables/payables, overdue/soon/undated filters, and review tasks link directly to the relevant document or banking page.
- The chart switches between bank cash movements and invoice issue amounts. Historical year selection does not alter current balances or unresolved tasks.
- Banking classification, reconciliation and transfer changes invalidate the dashboard.

## Verification

- 332 tests pass across the full suite, including 9 dashboard-specific tests.
- TypeScript, ESLint and production build pass.
- Synthetic browser data: top bank balance agrees with account detail; fiscal selection, overdue payable filter and direct document navigation verified.
- Browser work uses isolated temporary data. No production financial records were changed.
