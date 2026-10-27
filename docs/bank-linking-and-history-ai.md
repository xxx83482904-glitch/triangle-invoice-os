# Bank linking and history-assisted classification

## Entry point

Each banking row opens a dialog with invoice and internal-transfer tabs.
The same invoice confirmation service is used by the reconciliation desk and
the banking dialog. Partial payments, multiple invoices, existing payments,
conflict detection, status updates and unlink protections remain authoritative.
Japan invoice matching remains limited to UFJ and the eligible PayPay account.
No payment or classification is saved by merely choosing a candidate.

## Internal transfers

- Explicitly confirmed pairs link one outgoing and one incoming bank movement.
- Require the same company/office, distinct physical accounts and equal amounts.
- The user confirms ownership, currency and transaction identity. Equal amounts
  are only suggestions; differences, fees and FX conversions are not written off.
- Cards, missing/excluded/future records, existing invoice links and already
  paired movements cannot be confirmed as a new transfer.
- Both records become TRANSFER, excluded from operating income/expense totals
  and spending insights. Actual account cash movements and forecasts retain them.
- Source fields and invoice/payment records are never rewritten by transfer actions.
- Unlink restores the previous treatment on both sides, preserving later source
  updates and memos. Corrected/missing source data requires review.
- Links are stored in the backward-compatible bankTransfers collection, audited
  and included in Undo. Classification changes require unlinking first.

## Manual history AI refresh

- The history button supports displayed, selected and all-period scopes.
- It can revisit unconfirmed predictions, including saved provisional predictions.
  Explicit manual selections, reviewed records and rules are protected.
- Only earlier reviewed, non-excluded NORMAL records from the same account,
  company, office and direction are examples. Conflicting descriptions are omitted.
- At most five masked examples per transaction are sent, with explicit consent.
  Account names/numbers, memos, files and original internal record IDs are omitted.
- The server validates history references, category compatibility and the revision
  before and after the provider request. Examples never become confirmations.
- Yellow: supported historical proposal; pale yellow: inferred; red: low-confidence
  guess; blue: explicit classification confirmation. Results stay unsaved until Save.
- No scheduler, Money Forward classification writeback or automatic AI send added.

## Verification

Unit tests cover invoice/payment/mail consistency, transfer validation, duplicate
and stale requests, rollback, cash-flow treatment, history scope, conflicting
examples, protected manual edits, evidence validation and provider safety.
Local synthetic browser testing covers invoice confirmation, received invoice/mail
status updates, transfer pairing from both sides, unlink and history preview.
Live AI transmission is not exercised against production financial data.
