import assert from "node:assert/strict";
import test from "node:test";
import { bankLedgerMonths, bankLedgerYearMonth, bankSelectionAmount, reviewBankDrafts } from "../src/lib/bank-ledger";
import { bankFiscalYear } from "../src/lib/bank-account-overview";
import type { BankTransaction } from "../src/lib/banking-types";

const row = (id: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({
  id, company: "JAPAN", createdAt: "2026-10-01", updatedAt: "version-1", officeCode: "office", sourceId: id,
  bankAccountId: "bank", transactionDate: "2026-10-29", amount: 1100, side: "EXPENSE", content: id,
  sourceMemo: "", sourceStatus: "", sourceMissing: false, categoryId: "fees", treatment: "NORMAL",
  classificationSource: "HISTORY", classificationConfidence: "HISTORY", reviewed: false, memo: "Keep memo", ...patch,
});

test("ledger tabs follow the September to August fiscal year", () => {
  assert.equal(bankFiscalYear("2026-08"), 2026);
  assert.equal(bankFiscalYear("2026-09"), 2027);
  assert.deepEqual(bankLedgerMonths(2027), ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08"]);
  assert.equal(bankLedgerYearMonth(2026, ["2026-07", "2025-11", "2026-10"]), "2026-07");
  assert.equal(bankLedgerYearMonth(2025, []), "2024-09");
});

test("selected amount is signed and includes every selected row", () => {
  assert.equal(bankSelectionAmount([row("a"), row("b", { amount: 2200 }), row("c", { amount: 3300 })]), -6600);
  assert.equal(bankSelectionAmount([row("a"), row("b", { amount: 2400, side: "INCOME" })]), 1300);
  assert.equal(bankSelectionAmount([]), 0);
});

test("review changes are draft-only and preserve prior edits and optimistic versions", () => {
  const rows = [row("a"), row("b")];
  const drafts = { a: { ...rows[0], memo: "Edited", updatedAt: "draft-version" }, other: { ...row("other") } };
  const before = JSON.stringify({ rows, drafts });
  const next = reviewBankDrafts(rows, drafts, true);
  assert.equal(next.a.reviewed, true);
  assert.equal(next.b.reviewed, true);
  assert.equal(next.a.memo, "Edited");
  assert.equal(next.a.updatedAt, "draft-version");
  assert.equal(next.a.classificationConfidence, "HISTORY");
  assert.equal(next.other, drafts.other);
  assert.equal(JSON.stringify({ rows, drafts }), before);
  assert.equal(reviewBankDrafts(rows, next, false).a.reviewed, false);
});

test("invalid selected rows cannot produce partial review changes", () => {
  const drafts = {};
  assert.throws(() => reviewBankDrafts([row("ok"), row("missing", { sourceMissing: true })], drafts, true));
  assert.throws(() => reviewBankDrafts([row("empty", { categoryId: undefined })], drafts, true));
  assert.deepEqual(drafts, {});
  assert.equal(reviewBankDrafts([row("excluded", { categoryId: undefined, treatment: "EXCLUDED" })], {}, true).excluded.reviewed, true);
});

test("review respects existing confirmed transfers and skips unchanged rows", () => {
  const transfer = { ...row("transfer", { treatment: "TRANSFER", reviewed: true }), linkLabel: "資金移動" };
  assert.deepEqual(reviewBankDrafts([transfer], {}, true), {});
  assert.throws(() => reviewBankDrafts([transfer], {}, false));
  assert.deepEqual(reviewBankDrafts([row("done", { reviewed: true })], {}, true), {});
});
