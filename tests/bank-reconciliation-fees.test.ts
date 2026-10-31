import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, sourceKey, bankDisplayRows } from "../src/lib/banking";
import { bankReconciliationOverview, confirmBankReconciliation, confirmBankReconciliationBatch, reconciliationCandidates, reconciliationIssue, reconciliationReaffirmBlocker, type ReconcileInput } from "../src/lib/bank-reconciliation";
import { allocationPreview, feeDifference } from "../src/lib/bank-reconciliation-allocation";
import { paymentRecordsFor } from "../src/lib/payment-records";
import { integrityReport } from "../src/lib/integrity";
import type { BankTransaction } from "../src/lib/banking-types";
import type { AppData } from "../src/lib/types";

const office = "office", today = "2026-10-08";
const cat = (id: string) => sourceKey("JAPAN", office, "category", id);
const account = sourceKey("JAPAN", office, "account", "bank");
const row = (id: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: office, sourceId: id, bankAccountId: account, transactionDate: today, amount: 1000, side: "EXPENSE", content: `明細 ${id}`, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "MANUAL", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });

function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行", serviceName: "三菱UFJ銀行", isManual: false }], [
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true }, { id: "outsourcing", name: "外注費", group: "EXPENSE", available: true }, { id: "sales", name: "売上高", group: "INCOME", available: true },
  ]);
  data.bankTransactions = [
    row("income-short", { side: "INCOME", amount: 11340, content: "Test customer INV-001" }),
    row("expense-plus", { amount: 8660, content: "Test supplier", categoryId: cat("outsourcing") }),
    row("expense-nocat", { amount: 8660, content: "Test supplier again" }),
  ];
  data.issuedInvoices.forEach((invoice) => { invoice.status = "ISSUED"; invoice.needsReview = false; });
  data.receivedInvoices[0].status = "SCHEDULED"; data.receivedInvoices[0].mailProcessed = false; data.mailDocuments[0].mailProcessed = false;
  return data;
}
const input = (data: AppData, bankId: string, kind: "issued" | "received", invoiceId: string, amount: number, extra: Partial<ReconcileInput> = {}): ReconcileInput => {
  const bank = data.bankTransactions.find((item) => item.id === bankId)!, invoice = (kind === "issued" ? data.issuedInvoices : data.receivedInvoices).find((item) => item.id === invoiceId)!;
  return { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: kind, invoiceId, invoiceUpdatedAt: invoice.updatedAt, amount, mode: "new", acknowledged: true, ...extra };
};

test("a payer-deducted fee completes the invoice: payment = receipt + fee, link = receipt, everything reads as matched", () => {
  const data = setup();
  const result = confirmBankReconciliation(data, admin, "JAPAN", input(data, "income-short", "issued", "issued-1", 11340, { fee: { amount: 660, categoryId: cat("fees") } }), today);
  assert.deepEqual(result.fee, { amount: 660, borneBy: "payer", note: "" });
  const payment = data.payments[0], link = data.bankReconciliations[0];
  assert.deepEqual([payment.amount, payment.feeAmount, payment.feeCategoryId, payment.method], [12000, 660, cat("fees"), "銀行明細照合（手数料差額処理）"]);
  assert.deepEqual([link.amount, link.fee], [11340, { amount: 660, categoryId: cat("fees"), borneBy: "payer" }]);
  assert.equal(data.issuedInvoices[0].status, "PAID");
  const view = bankReconciliationOverview(data, "JAPAN", today);
  const bank = view.banks.find((item) => item.id === "income-short")!, invoice = view.invoices.find((item) => item.key === "issued:issued-1")!;
  assert.deepEqual([bank.state, bank.remaining, invoice.unmatched, invoice.recordedUnmatched, invoice.outstanding, invoice.payments[0].available], ["matched", 0, 0, 0, 0, 0]);
  assert.equal(view.links[0].fee?.borneBy, "payer");
  assert.equal(reconciliationIssue(data, link, today), ""); assert.equal(reconciliationReaffirmBlocker(data, link, today), "");
  assert.equal(paymentRecordsFor(data, "JAPAN", "issued", "issued-1", today)[0].feeAmount, 660);
  assert.equal(paymentRecordsFor(data, "JAPAN", "issued", "issued-1", today)[0].linkedAmount, 12000);
  assert.equal(integrityReport(data, "JAPAN", { today }).counts.paid_without_bank, 0);
  // The fee cannot push the record past the invoice, and it is not available for existing payments.
  const other = setup();
  assert.throws(() => confirmBankReconciliation(other, admin, "JAPAN", input(other, "income-short", "issued", "issued-1", 11340, { fee: { amount: 661 } }), today), /手数料を含めた記録額/);
  assert.throws(() => confirmBankReconciliation(other, admin, "JAPAN", input(other, "income-short", "issued", "issued-1", 11340, { fee: { amount: 660, categoryId: "nope" } }), today), /手数料の科目/);
  assert.throws(() => confirmBankReconciliation(other, admin, "JAPAN", input(other, "income-short", "issued", "issued-1", 11340, { mode: "existing", paymentId: "x", paymentUpdatedAt: "y", fee: { amount: 660 } }), today), /新しい支払記録/);
});

test("a bank-charged fee on an outgoing transfer counts toward the bank row and splits it when the row has a category", () => {
  const data = setup();
  const result = confirmBankReconciliation(data, admin, "JAPAN", input(data, "expense-plus", "received", "received-1", 8000, { fee: { amount: 660, categoryId: cat("fees") } }), today);
  assert.equal(result.fee?.borneBy, "bank"); assert.match(result.fee!.note, /分割しました/);
  const bank = data.bankTransactions.find((item) => item.id === "expense-plus")!;
  assert.deepEqual(bank.bookkeeping?.splits?.map((split) => [split.categoryId, split.amount]), [[cat("outsourcing"), 8000], [cat("fees"), 660]]);
  assert.notEqual(bank.updatedAt, timestamp);
  assert.equal(data.payments[0].amount, 8000); assert.equal(data.payments[0].feeAmount, undefined);
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.deepEqual([view.banks.find((item) => item.id === "expense-plus")!.state, view.banks.find((item) => item.id === "expense-plus")!.remaining], ["matched", 0]);
  assert.equal(view.invoices.find((item) => item.key === "received:received-1")!.unmatched, 0);
  assert.equal(bankDisplayRows(data, data.bankTransactions).find((item) => item.id === "expense-plus")!.linkLabel, "請求書");
  assert.equal(reconciliationReaffirmBlocker(data, data.bankReconciliations[0], today), "");
  // Without a category on the row the link still absorbs the fee, but the row is left for the person to split.
  const plain = setup();
  const note = confirmBankReconciliation(plain, admin, "JAPAN", input(plain, "expense-nocat", "received", "received-1", 8000, { fee: { amount: 660, categoryId: cat("fees") } }), today).fee!.note;
  assert.match(note, /科目が未設定/);
  assert.equal(plain.bankTransactions.find((item) => item.id === "expense-nocat")!.bookkeeping, undefined);
  assert.equal(bankReconciliationOverview(plain, "JAPAN", today).banks.find((item) => item.id === "expense-nocat")!.remaining, 0);
  const over = setup();
  assert.throws(() => confirmBankReconciliation(over, admin, "JAPAN", input(over, "expense-plus", "received", "received-1", 8000, { fee: { amount: 661 } }), today), /銀行明細の未照合額/);
});

test("batches carry at most one fee and keep working after the fee split bumps the bank row", () => {
  const data = setup();
  data.issuedInvoices[1].total = 11340; data.issuedInvoices[1].subtotal = 11340;
  const bank = data.bankTransactions.find((item) => item.id === "expense-plus")!;
  const received = data.receivedInvoices[0];
  const result = confirmBankReconciliationBatch(data, admin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, acknowledged: true, allocations: [
    { invoiceKind: "received", invoiceId: received.id, invoiceUpdatedAt: received.updatedAt, amount: 8000, mode: "new", fee: { amount: 660, categoryId: cat("fees") } },
  ] }, today);
  assert.equal(result.allocations.length, 1); assert.equal(data.bankTransactions.find((item) => item.id === "expense-plus")!.bookkeeping?.splits?.length, 2);
  const two = setup(), bank2 = two.bankTransactions.find((item) => item.id === "expense-plus")!;
  two.receivedInvoices.push({ ...two.receivedInvoices[0], id: "received-2", total: 4000, subtotal: 4000 });
  assert.throws(() => confirmBankReconciliationBatch(two, admin, "JAPAN", { transactionId: bank2.id, transactionUpdatedAt: bank2.updatedAt, acknowledged: true, allocations: [
    { invoiceKind: "received", invoiceId: "received-1", invoiceUpdatedAt: two.receivedInvoices[0].updatedAt, amount: 4000, mode: "new", fee: { amount: 330 } },
    { invoiceKind: "received", invoiceId: "received-2", invoiceUpdatedAt: two.receivedInvoices[1].updatedAt, amount: 4000, mode: "new", fee: { amount: 330 } },
  ] }, today), /1件の配賦/);
});

test("the allocation preview offers the fee only for small differences and accounts for it per side", () => {
  const data = setup();
  const view = bankReconciliationOverview(data, "JAPAN", today);
  const income = view.banks.find((item) => item.id === "income-short")!, issued = view.invoices.find((item) => item.key === "issued:issued-1")!;
  const expense = view.banks.find((item) => item.id === "expense-plus")!, received = view.invoices.find((item) => item.key === "received:received-1")!;
  assert.equal(feeDifference(income, issued), 660); assert.equal(feeDifference(expense, received), 660);
  assert.equal(feeDifference({ ...income, remaining: 5000 }, issued), 0);
  const incomePreview = allocationPreview(income, [issued], [{ id: "a", invoiceKey: issued.key, mode: "new", paymentId: "", amount: "11340", duplicateAcknowledged: false, fee: { amount: "660", categoryId: cat("fees") } }]);
  assert.deepEqual([incomePreview.valid, incomePreview.bankRemaining, incomePreview.fees, incomePreview.outstanding(issued)], [true, 0, 660, 0]);
  const tooMuch = allocationPreview(income, [issued], [{ id: "a", invoiceKey: issued.key, mode: "new", paymentId: "", amount: "11340", duplicateAcknowledged: false, fee: { amount: "661", categoryId: cat("fees") } }]);
  assert.match(tooMuch.allocations[0].error, /未入金・未払い額/);
  const expensePreview = allocationPreview(expense, [received], [{ id: "a", invoiceKey: received.key, mode: "new", paymentId: "", amount: "8000", duplicateAcknowledged: false, fee: { amount: "660", categoryId: cat("fees") } }]);
  assert.deepEqual([expensePreview.valid, expensePreview.bankRemaining, expensePreview.invoiceRemaining(received)], [true, 0, 0]);
  const existing = allocationPreview(income, [issued], [{ id: "a", invoiceKey: issued.key, mode: "existing", paymentId: "x", amount: "1", duplicateAcknowledged: false, fee: { amount: "1", categoryId: cat("fees") } }]);
  assert.match(existing.allocations[0].error, /新しい支払記録/);
});

test("withholding: the net payable becomes a candidate target when the stored total disagrees", () => {
  const data = setup();
  const invoice = data.receivedInvoices[0];
  Object.assign(invoice, { subtotal: 10000, taxTotal: 1000, grossAmount: 11000, withholdingAmount: 1021, total: 11000 });
  data.bankTransactions.push(row("net-payment", { amount: 9979, content: "Test supplier" }));
  const view = bankReconciliationOverview(data, "JAPAN", today);
  const target = view.invoices.find((item) => item.key === "received:received-1")!;
  assert.deepEqual([target.withholdingAmount, target.netPayable, target.withholdingMismatch], [1021, 9979, true]);
  const candidate = reconciliationCandidates(view.banks.find((item) => item.id === "net-payment")!, view.invoices).find((item) => item.key === target.key)!;
  assert.ok(candidate.reasons.includes("源泉徴収後の差引支払額と一致"));
  assert.ok(candidate.warnings.some((warning) => warning.includes("差引支払額")));
  // A consistent invoice (total already net) carries the info without a mismatch.
  invoice.total = 9979;
  const consistent = bankReconciliationOverview(data, "JAPAN", today).invoices.find((item) => item.key === "received:received-1")!;
  assert.deepEqual([consistent.netPayable, consistent.withholdingMismatch], [9979, false]);
  assert.ok(reconciliationCandidates(bankReconciliationOverview(data, "JAPAN", today).banks.find((item) => item.id === "net-payment")!, bankReconciliationOverview(data, "JAPAN", today).invoices).find((item) => item.key === target.key)!.reasons.includes("未入金・未払い額と一致"));
});
