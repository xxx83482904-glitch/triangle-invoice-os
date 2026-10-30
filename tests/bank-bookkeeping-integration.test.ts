import assert from "node:assert/strict";
import test from "node:test";
import { fixture, admin } from "./document-fixture";
import { bankDisplayRows, bankFilters, mergeBankMasters, mergeBankTransactions, saveBankEdits, selectBankTransactions, deleteBankDefinition } from "../src/lib/banking";
import { saveBankBookkeeping } from "../src/lib/bank-bookkeeping";
import { bankSpendingInsights } from "../src/lib/bank-insights";
import { sectionExport, bankExportCsv } from "../src/lib/section-export";
import { restoreUndoState } from "../src/lib/store";
import { bankClassificationLabel, createBankSuggester } from "../src/lib/bank-classification";

function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", "office", [{ id: "bank", name: "Test bank", serviceName: "Bank", isManual: false }], [{ id: "rent", name: "地代家賃", group: "EXPENSE", available: true }, { id: "fee", name: "支払手数料", group: "EXPENSE", available: true }]);
  mergeBankTransactions(data, "JAPAN", "office", [{ id: "row", connected_account_id: "bank", date: "2026-10-20", value: 110000, side: "EXPENSE", content: "家賃と手数料", journalizing_status: "none" }], { start: "2026-10-20", end: "2026-10-20" });
  const row = data.bankTransactions[0], before = structuredClone(row);
  const [rent, fee] = data.accountingCategories;
  saveBankBookkeeping(data, admin, "JAPAN", { id: row.id, updatedAt: row.updatedAt, splits: [{ id: "a", categoryId: rent.id, amount: 100000, memo: "家賃" }, { id: "b", categoryId: fee.id, amount: 10000, memo: "手数料" }], hold: null, invoiceRequirement: "REQUIRED", memo: "", reviewed: true });
  return { data, row, before, rent, fee };
}
test("splits reconcile category insights, filtered subtotal and export without doubling cashflow", () => {
  const { data, row, rent } = setup();
  const insights = bankSpendingInsights(data, "JAPAN", row.bankAccountId, "2026-10", "2026-10-30");
  assert.equal(insights.current.amount, 110000);
  assert.equal(insights.categories.reduce((sum, item) => sum + item.amount, 0), 110000);
  assert.equal(insights.unclassified.count, 0);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ category: rent.id })).summary.expense, 100000);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ status: "unclassified" })).total, 0);
  const bundle = sectionExport(data, admin, { company: "JAPAN", scope: "banking", start: "2026-10-01", end: "2026-10-31", basis: "document", undated: "1" });
  assert.equal(bundle.bank.length, 1); assert.equal(bundle.bank[0].amount, 110000);
  assert.match(bankExportCsv(bundle), /100000円/); assert.match(bankExportCsv(bundle), /10000円/);
});
test("bulk edit cannot silently override splits and undo restores bookkeeping", () => {
  const { data, row, before, rent } = setup();
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [{ ...row, categoryId: rent.id }]), /分割/);
  saveBankEdits(data, admin, "JAPAN", [{ ...row, memo: "changed" }]);
  assert.equal(row.bookkeeping?.splits?.length, 2);
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [{ collection: "bankTransactions", id: row.id, index: 0, before }] });
  assert.equal(data.bankTransactions[0].bookkeeping, undefined);
});
test("hold filter works and bulk review cannot bypass hold", () => {
  const { data, row } = setup();
  row.bookkeeping!.hold = { reason: "MISSING_DOCUMENT", question: "原本待ち" }; row.reviewed = false;
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ status: "held" })).total, 1);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [{ ...row, reviewed: true }]), /保留/);
  const displayed = bankDisplayRows(data, [row])[0];
  assert.equal(displayed.predictionPending, undefined);
});
test("source amount corrections invalidate split totals without losing their evidence", () => {
  const { data, row } = setup(); row.amount = 120000; row.reviewed = false;
  const insights = bankSpendingInsights(data, "JAPAN", row.bankAccountId, "2026-10", "2026-10-30");
  assert.equal(insights.unclassified.amount, 120000);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [{ ...row, reviewed: true }]), /一致/);
  assert.equal(row.bookkeeping?.splits?.length, 2);
});
test("categories referenced by split allocations cannot be deleted", () => {
  const { data, rent } = setup(); delete rent.sourceId;
  assert.throws(() => deleteBankDefinition(data, admin, "JAPAN", "category", rent.id, rent.updatedAt), /使用中/);
});

test("prediction and labels preserve unreviewed splits and holds", () => {
  const { data, row } = setup(); row.reviewed = false; row.classificationSource = "UNASSIGNED";
  const suggest = createBankSuggester(data, { allowGuesses: true });
  assert.equal(suggest(row), undefined);
  assert.equal(bankClassificationLabel(row).label, "科目分割・未確認");
  row.bookkeeping = { hold: { reason: "CATEGORY_UNCLEAR", question: "用途確認" } };
  assert.equal(suggest(row), undefined);
  assert.equal(bankClassificationLabel(row).label, "保留・要確認");
});
