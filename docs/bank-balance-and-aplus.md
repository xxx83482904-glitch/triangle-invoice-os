# Automatic bank balances and Aplus settlements

Updated: 2026-10-28. Local changes only; not deployed.

## Balance calculation

- A manually entered balance remains an immutable calculation baseline until explicitly edited.
- Calculation: saved day-end balance + acquired later income - acquired later expenses, through today.
- Baseline-day transactions are already included in the baseline and are not added again.
- The calculation is independent of fiscal-year, month, direction, category, and search filters. Fiscal activity remains September through August.
- Missing coverage or missing/invalid source rows produce an explicitly provisional calculation. This is not a bank-reported real-time balance.
- Transfers, excluded bookkeeping transactions, and card debits remain actual bank cash movements.
- Card purchases, invoice payment records, and transfer/reconciliation link records are not added to bank cash a second time.
- Accounts without registered bank baselines are excluded from balance totals, with counts displayed.
- Reconnected account settings, company/office scope, zero and negative balances retain existing safeguards.

## AP Aplus

- The user identified bank debit descriptions `口座振替 ... APアプラス` as monthly Aplus credit-card settlements.
- A local deterministic matcher handles width/case/spacing variants and requires a Japanese bank expense. Refunds, fees, ordinary purchases and card-account transactions are not treated as settlements.
- An unsaved `TRANSFER` candidate replaces unconfirmed AUTO/HISTORY expense guesses. Import, preview and AI do not silently save it.
- Manual/reviewed/rule classifications and existing confirmed links remain intact. Conflicts are visible instead of being overwritten.
- Save All explicitly persists the transfer treatment. Bank cash still decreases; normal expense analytics exclude the settlement amount and retain card purchases.
- The card-settlement tab shows the debit and same-company/office Aplus account candidates, with links to their full history.
- Billing periods and individual purchase lines are not guessed or marked matched. Neither an unrelated received invoice nor an equal incoming bank transfer can be confirmed against this debit.

## Verification

- Production build, lint, TypeScript and 323 unit tests passed.
- Synthetic fixture: `tests/prepare-document-preview.ts --selection --installments --issued-list --bank-balances`.
- UFJ baseline 1,000,000 plus 200,000 income minus 175,000 expenses calculated 1,025,000. The 120,000 Aplus debit is included once; card purchases are not counted again.
- Changing the baseline to 1,100,000 in the browser updated both overview and statement views to 1,125,000.
- A historical fiscal-year selection did not change the current calculated balance.
- PayPay's 300,000 baseline plus 50,000 transfer showed 350,000 and a provisional badge when coverage was absent.
- Verified Aplus remained NORMAL in fixture storage before Save All, then became TRANSFER afterward; the calculated bank balance did not change.
- Verified the card-settlement tab and blocked invoice/transfer matching, plus phone/tablet layouts.

No production financial records, credentials, external API usage or deployment were changed.
