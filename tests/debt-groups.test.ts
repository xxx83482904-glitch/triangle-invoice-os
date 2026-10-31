import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, sourceKey } from "../src/lib/banking";
import { assignDebtGroup, debtGroupCandidates, debtGroupView, isPayableReceivedInvoice, payableDebtDocument, removeFromDebtGroup, updateDebtRole } from "../src/lib/debt-groups";
import { bankReconciliationOverview, confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import { recordPayment } from "../src/lib/payment-records";
import { dashboardSummary } from "../src/lib/dashboard";
import type { BankTransaction } from "../src/lib/banking-types";
import type { AppData } from "../src/lib/types";

const office = "office", today = "2026-10-08";
function setup() {
  const data = fixture();
  const base = data.receivedInvoices[0];
  Object.assign(base, { status: "SCHEDULED", mailProcessed: false, issueDate: "2026-08-01", dueDate: "2026-08-31", originalFileName: "制作費_8月.pdf" });
  data.mailDocuments[0].mailProcessed = false;
  data.receivedInvoices.push(
    { ...base, id: "received-2", issueDate: "2026-09-10", dueDate: "2026-09-30", originalFileName: "制作費_8月_再発行.pdf", createdAt: "2026-09-10T00:00:00.000Z" },
    { ...base, id: "received-3", issueDate: "2026-09-12", dueDate: "2026-09-30", originalFileName: "督促状.pdf", total: 8000, createdAt: "2026-09-12T00:00:00.000Z" },
    { ...base, id: "received-other", vendorId: "other-vendor", issueDate: "2026-09-05", originalFileName: "別会社_請求書.pdf" },
    { ...base, id: "received-far", issueDate: "2025-01-05", originalFileName: "古い請求書.pdf" },
  );
  data.vendors.push({ ...data.vendors[0], id: "other-vendor", companyName: "Other supplier" });
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行", serviceName: "三菱UFJ銀行", isManual: false }], [{ id: "outsourcing", name: "外注費", group: "EXPENSE", available: true }]);
  const bank: BankTransaction = { id: "bank-expense", company: "JAPAN", officeCode: office, sourceId: "bank-expense", bankAccountId: sourceKey("JAPAN", office, "account", "bank"), transactionDate: today, amount: 8000, side: "EXPENSE", content: "Test supplier", sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp };
  data.bankTransactions = [bank];
  return data;
}
const invoice = (data: AppData, id: string) => data.receivedInvoices.find((row) => row.id === id)!;

test("candidates are same-vendor documents within half a year with a matching amount or a reissue word", () => {
  const data = setup();
  const candidates = debtGroupCandidates(data, "JAPAN", invoice(data, "received-1"));
  assert.deepEqual(candidates.map((row) => row.id).sort(), ["received-2", "received-3"]);
  assert.ok(candidates.find((row) => row.id === "received-2")!.reasons.includes("同じ金額"));
  assert.ok(candidates.find((row) => row.id === "received-3")!.reasons.includes("再請求・督促・領収・合計の語を含む"));
  assert.equal(debtGroupView(data, "JAPAN", invoice(data, "received-1")).payable, true);
});

test("bundling makes only the latest payable document payable, and the others leave reconciliation, payments, dashboard and reports", () => {
  const data = setup(), before = JSON.stringify(data.bankTransactions);
  assert.throws(() => assignDebtGroup(data, admin, "JAPAN", { invoiceIds: ["received-1", "received-other"] }), /同じ支払先/);
  assert.throws(() => assignDebtGroup(data, { id: "guest", role: "GUEST" }, "JAPAN", { invoiceIds: ["received-1", "received-2"] }), /権限/);
  const result = assignDebtGroup(data, admin, "JAPAN", { invoiceIds: ["received-1", "received-2", "received-3"], roles: { "received-2": "REISSUE", "received-3": "REMINDER" } });
  assert.equal(result.payableId, "received-3"); assert.equal(result.memberIds.length, 3);
  assert.deepEqual(["received-1", "received-2", "received-3"].map((id) => isPayableReceivedInvoice(data, invoice(data, id))), [false, false, true]);
  assert.equal(invoice(data, "received-1").debtRole, "INVOICE");
  const view = debtGroupView(data, "JAPAN", invoice(data, "received-1"));
  assert.deepEqual([view.payable, view.payableId, view.members.map((row) => row.roleLabel)], [false, "received-3", ["請求書", "再請求", "督促"]]);
  assert.deepEqual(view.candidates, []);
  const overview = bankReconciliationOverview(data, "JAPAN", today);
  assert.deepEqual(["received-1", "received-2", "received-3"].map((id) => overview.invoices.find((row) => row.id === id)!.eligible), [false, false, true]);
  const bank = data.bankTransactions[0];
  assert.throws(() => confirmBankReconciliation(data, admin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: "received", invoiceId: "received-1", invoiceUpdatedAt: invoice(data, "received-1").updatedAt, amount: 8000, mode: "new", acknowledged: true }, today), /支払対象外/);
  assert.throws(() => recordPayment(data, admin, "JAPAN", { kind: "received", invoiceId: "received-2", amount: 8000, paymentDate: today }, today), /支払対象外/);
  const dashboard = JSON.stringify(dashboardSummary(data, admin, "JAPAN", today));
  assert.ok(dashboard.includes("received:received-3")); assert.equal(dashboard.includes("received:received-1"), false); assert.equal(dashboard.includes("received:received-2"), false);
  recordPayment(data, admin, "JAPAN", { kind: "received", invoiceId: "received-3", amount: 8000, paymentDate: today }, today);
  assert.equal(invoice(data, "received-3").status, "PAID");
  assert.equal(JSON.stringify(data.bankTransactions), before);
});

test("roles can change while the group keeps a payable document, and a paid document cannot be pushed out of the payable spot", () => {
  const data = setup();
  assignDebtGroup(data, admin, "JAPAN", { invoiceIds: ["received-1", "received-2"], roles: { "received-2": "REISSUE" } });
  assert.equal(payableDebtDocument(data.receivedInvoices.filter((row) => row.debtGroupId))!.id, "received-2");
  const second = invoice(data, "received-2");
  assert.throws(() => updateDebtRole(data, admin, "JAPAN", { invoiceId: second.id, expectedUpdatedAt: "stale", role: "RECEIPT" }), /更新されています/);
  updateDebtRole(data, admin, "JAPAN", { invoiceId: second.id, expectedUpdatedAt: second.updatedAt, role: "RECEIPT" });
  assert.equal(isPayableReceivedInvoice(data, invoice(data, "received-1")), true);
  // Both documents as receipts would leave nothing to pay.
  const first = invoice(data, "received-1");
  assert.throws(() => updateDebtRole(data, admin, "JAPAN", { invoiceId: first.id, expectedUpdatedAt: first.updatedAt, role: "RECEIPT" }), /支払対象となる書類/);
  assert.equal(first.debtRole, "INVOICE");
  // A statement keeps the amount billed this time apart from the carried-over balance.
  updateDebtRole(data, admin, "JAPAN", { invoiceId: first.id, expectedUpdatedAt: first.updatedAt, role: "STATEMENT", statementCurrentAmount: 8000, statementCarriedOver: 3000 });
  assert.deepEqual([first.debtRole, first.statementCurrentAmount, first.statementCarriedOver], ["STATEMENT", 8000, 3000]);
  assert.equal(debtGroupView(data, "JAPAN", first).members.find((row) => row.id === first.id)!.statementCarriedOver, 3000);
  // A paid document stays payable: making the receipt the payable one again is refused once payments exist.
  recordPayment(data, admin, "JAPAN", { kind: "received", invoiceId: first.id, amount: 8000, paymentDate: today }, today);
  const receipt = invoice(data, "received-2");
  assert.throws(() => updateDebtRole(data, admin, "JAPAN", { invoiceId: receipt.id, expectedUpdatedAt: receipt.updatedAt, role: "REISSUE" }), /支払記録のある書類/);
});

test("leaving a group restores the document, and a group of one dissolves", () => {
  const data = setup();
  assignDebtGroup(data, admin, "JAPAN", { invoiceIds: ["received-1", "received-2", "received-3"], roles: { "received-2": "REISSUE", "received-3": "REMINDER" } });
  const third = invoice(data, "received-3");
  removeFromDebtGroup(data, admin, "JAPAN", { invoiceId: third.id, expectedUpdatedAt: third.updatedAt });
  assert.equal(third.debtGroupId, undefined); assert.equal(isPayableReceivedInvoice(data, invoice(data, "received-2")), true);
  const second = invoice(data, "received-2");
  const result = removeFromDebtGroup(data, admin, "JAPAN", { invoiceId: second.id, expectedUpdatedAt: second.updatedAt });
  assert.equal(result.remaining, 0);
  assert.deepEqual([invoice(data, "received-1").debtGroupId, invoice(data, "received-1").debtRole], [undefined, undefined]);
  assert.throws(() => removeFromDebtGroup(data, admin, "JAPAN", { invoiceId: second.id, expectedUpdatedAt: second.updatedAt }), /属していない/);
  // Adding to an existing group reuses its id; mixing two groups is refused.
  assignDebtGroup(data, admin, "JAPAN", { invoiceIds: ["received-1", "received-2"] });
  assignDebtGroup(data, admin, "JAPAN", { invoiceIds: ["received-3", "received-far"] });
  assert.throws(() => assignDebtGroup(data, admin, "JAPAN", { invoiceIds: ["received-1", "received-3"] }), /別々の債務グループ/);
  const added = assignDebtGroup(data, admin, "JAPAN", { invoiceIds: ["received-1", "received-2"], groupId: invoice(data, "received-1").debtGroupId, roles: { "received-2": "RECEIPT" } });
  assert.equal(added.payableId, "received-1");
});
