import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { bankReconciliationOverview, confirmBankReconciliation, confirmBankReconciliationBatch, reaffirmBankReconciliation, reaffirmInvoiceReconciliations, reconciliationReaffirmBlocker, saveReconciliationAlias, saveReconciliationInstallments, reconciliationCandidates, reconciliationIssue, removeBankReconciliation, syncReconciledInvoiceStatus, type ReconcileInput, type ReconciliationBatchInput } from "../src/lib/bank-reconciliation";
import { allocationPreview, type AllocationDraft } from "../src/lib/bank-reconciliation-allocation";
import { confirmBankTransfer } from "../src/lib/bank-transfers";
import { bankCategoryAllocations } from "../src/lib/bank-bookkeeping";
import { restoreUndoState } from "../src/lib/store";
import { invoiceAccountScopeIssue } from "../src/lib/bank-reconciliation-accounts";
import { normalizeReconciliationName, reconciliationPaymentOptions } from "../src/lib/bank-reconciliation-matching";

const today = "2026-10-08";
function setup() {
  const data = fixture();
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "テスト銀行", serviceName: "三菱UFJ銀行", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
  data.bankTransactions = [{ id: "bank-income", company: "JAPAN", officeCode: "office", sourceId: "source-income", bankAccountId: "bank", side: "INCOME", amount: 12000, content: "Test customer INV-001", transactionDate: today, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp }];
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "bank-expense", sourceId: "source-expense", side: "EXPENSE", amount: 8000, content: "Test supplier" });
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; });
  data.receivedInvoices[0].status = "SCHEDULED"; data.receivedInvoices[0].mailProcessed = false;
  data.mailDocuments[0].mailProcessed = false;
  return data;
}
function input(data: ReturnType<typeof setup>, overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  const kind = overrides.invoiceKind || "issued", id = overrides.invoiceId || (kind === "issued" ? "issued-1" : "received-1");
  const invoice = (kind === "issued" ? data.issuedInvoices : data.receivedInvoices).find((row) => row.id === id)!;
  const bank = data.bankTransactions.find((row) => row.id === (overrides.transactionId || (kind === "issued" ? "bank-income" : "bank-expense")))!;
  return { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: kind, invoiceId: id, invoiceUpdatedAt: invoice.updatedAt, amount: Math.min(bank.amount, invoice.total), mode: "new", acknowledged: true, ...overrides };
}
const confirm = (data: ReturnType<typeof setup>, overrides: Partial<ReconcileInput> = {}) => confirmBankReconciliation(data, admin, "JAPAN", input(data, overrides), today);

function batch(data: ReturnType<typeof setup>, allocations: Partial<ReconcileInput>[]): ReconciliationBatchInput {
  const first = input(data, allocations[0]);
  return { transactionId: first.transactionId, transactionUpdatedAt: first.transactionUpdatedAt, acknowledged: true,
    allocations: allocations.map((row) => input(data, row)),
  };
}

test("one batch atomically allocates multiple invoices and leaves explicit bank and invoice remainders", () => {
  const data = setup(); data.bankTransactions[0].amount = 25000;
  const beforeBanks = structuredClone(data.bankTransactions);
  const request = batch(data, [{ amount: 12000 }, { invoiceId: "issued-2", amount: 8000 }]);
  const result = confirmBankReconciliationBatch(data, admin, "JAPAN", request, today);
  assert.equal(result.allocations.length, 2); assert.equal(result.amount, 20000);
  assert.equal(data.payments.length, 2); assert.equal(data.issuedInvoices[1].status, "PARTIALLY_PAID");
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.banks[0].remaining, 5000); assert.equal(view.invoices.find((row) => row.id === "issued-2")!.outstanding, 4000);
  assert.deepEqual(data.bankTransactions, beforeBanks);
  const saved = structuredClone(data);
  assert.throws(() => confirmBankReconciliationBatch(data, admin, "JAPAN", request, today)); assert.deepEqual(data, saved);
});

test("late batch failure rolls back every payment, invoice and related mail change", () => {
  for (const patch of [{ amount: 12001 }, { invoiceUpdatedAt: "stale" }, { invoiceId: "issued-cn" }, { invoiceKind: "received" as const }, { amount: 0.001 }]) {
    const data = setup(); data.bankTransactions[0].amount = 30000;
    const request = batch(data, [{ amount: 12000 }, { invoiceId: "issued-2", amount: 5000 }]);
    Object.assign(request.allocations[1], patch);
    const before = structuredClone(data);
    assert.throws(() => confirmBankReconciliationBatch(data, admin, "JAPAN", request, today)); assert.deepEqual(data, before);
  }
  const data = setup(); data.bankTransactions[1].amount = 16000;
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "received-2" });
  const request = batch(data, [{ invoiceKind: "received", amount: 8000 }, { invoiceKind: "received", invoiceId: "received-2", amount: 8001 }]);
  const before = structuredClone(data);
  assert.throws(() => confirmBankReconciliationBatch(data, admin, "JAPAN", request, today)); assert.deepEqual(data, before);
});

test("batch validates combined bank capacity, duplicate rows, acknowledgement and authority", () => {
  for (const kind of ["over", "duplicate", "ack", "actor", "company"] as const) {
    const data = setup(), request = batch(data, [{ amount: 8000 }, { invoiceId: "issued-2", amount: 8000 }]);
    if (kind === "duplicate") request.allocations[1] = { ...request.allocations[0] };
    if (kind === "ack") request.acknowledged = false as true;
    const before = structuredClone(data);
    assert.throws(() => confirmBankReconciliationBatch(data, kind === "actor" ? { id: "guest", role: "GUEST" } : admin, kind === "company" ? "CHINA" : "JAPAN", request, today));
    assert.deepEqual(data, before);
  }
});

test("batch can link distinct existing payments for one invoice without creating payments", () => {
  const data = setup();
  data.payments = ["p1", "p2"].map((id) => ({ id, type: "INCOME", issuedInvoiceId: "issued-1", amount: 6000, paymentDate: today, createdById: "admin", createdAt: timestamp, updatedAt: timestamp }));
  const request = batch(data, data.payments.map((payment) => ({ mode: "existing", paymentId: payment.id, paymentUpdatedAt: payment.updatedAt, amount: 6000 })));
  const payments = structuredClone(data.payments);
  confirmBankReconciliationBatch(data, admin, "JAPAN", request, today);
  assert.deepEqual(data.payments, payments); assert.equal(data.bankReconciliations.length, 2);
  assert.equal(bankReconciliationOverview(data, "JAPAN", today).invoices[0].matched, 12000);
});

test("duplicate payment warning requires explicit extra acknowledgement but never bypasses remaining amounts", () => {
  const data = setup();
  data.payments.push({ id: "manual", type: "INCOME", issuedInvoiceId: "issued-1", amount: 4000, paymentDate: today, createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
  const before = structuredClone(data);
  assert.throws(() => confirm(data, { amount: 4000 }), /別の実際の支払い/); assert.deepEqual(data, before);
  confirm(data, { amount: 4000, duplicateAcknowledged: true });
  assert.equal(data.payments.length, 2);
  const saved = structuredClone(data);
  assert.throws(() => confirm(data, { amount: 5000, duplicateAcknowledged: true })); assert.deepEqual(data, saved);
});

test("future payment records cannot stand in for actual bank evidence", () => {
  const data = setup(); data.payments.push({ id: "future", type: "INCOME", issuedInvoiceId: "issued-1", amount: 12000, paymentDate: "2027-01-01", createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
  const before = structuredClone(data);
  assert.throws(() => confirm(data, { mode: "existing", paymentId: "future", paymentUpdatedAt: timestamp }), /将来日/); assert.deepEqual(data, before);
});

test("installment schedules stay planned even after their dates; only actual partial receipts affect paid state", () => {
  const data = setup(), paymentBefore = structuredClone(data.payments), statusBefore = data.issuedInvoices[0].status;
  const installments = [{ id: "past", dueDate: "2026-01-01", amount: 4000 }, { id: "future", dueDate: "2027-01-01", amount: 8000, note: "planned" }];
  saveReconciliationInstallments(data, admin, "JAPAN", { invoiceId: "issued-1", invoiceUpdatedAt: timestamp, installments });
  assert.deepEqual(data.payments, paymentBefore); assert.equal(data.issuedInvoices[0].status, statusBefore);
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.invoices[0].paid, 0); assert.deepEqual(view.invoices[0].installmentSchedule, installments);
  confirm(data, { amount: 4000 }); assert.equal(data.issuedInvoices[0].status, "PARTIALLY_PAID");
  assert.deepEqual(data.issuedInvoices[0].installmentSchedule, installments);
});

test("installment edits reject invalid amounts, dates, duplicate IDs, stale versions and foreign company", () => {
  for (const installments of [[{ id: "a", dueDate: "2026-02-30", amount: 1 }], [{ id: "a", dueDate: today, amount: 12001 }], [{ id: "a", dueDate: today, amount: 0.001 }], [{ id: "a", dueDate: today, amount: 1 }, { id: "a", dueDate: today, amount: 1 }]]) {
    const data = setup(), before = structuredClone(data);
    assert.throws(() => saveReconciliationInstallments(data, admin, "JAPAN", { invoiceId: "issued-1", invoiceUpdatedAt: timestamp, installments })); assert.deepEqual(data, before);
  }
  const data = setup(), before = structuredClone(data);
  assert.throws(() => saveReconciliationInstallments(data, admin, "JAPAN", { invoiceId: "issued-1", invoiceUpdatedAt: "stale", installments: [] }));
  assert.throws(() => saveReconciliationInstallments(data, admin, "CHINA", { invoiceId: "issued-1", invoiceUpdatedAt: timestamp, installments: [] })); assert.deepEqual(data, before);
});

test("initial reviewed payer aliases improve candidates without recording or confirming payment", () => {
  const data = setup(); data.clients[0].companyName = "株式会社設計会社"; data.bankTransactions[0].content = "振込 ｶ)ｾｯｹｲｶﾞｲｼｬ";
  const request = { transactionId: "bank-income", transactionUpdatedAt: timestamp, invoiceKind: "issued" as const, invoiceId: "issued-1", invoiceUpdatedAt: timestamp, acknowledged: true as const };
  const before = structuredClone({ invoices: data.issuedInvoices, payments: data.payments, links: data.bankReconciliations });
  saveReconciliationAlias(data, admin, "JAPAN", request);
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.ok(reconciliationCandidates(view.banks[0], view.invoices).some((row) => row.reasons.includes("確認済みの名義対応と一致（照合は未確定）")));
  assert.deepEqual({ invoices: data.issuedInvoices, payments: data.payments, links: data.bankReconciliations }, before);
  assert.ok(!reconciliationCandidates({ ...view.banks[0], accountId: "other" }, view.invoices).some((row) => row.reasons.includes("確認済みの名義対応と一致（照合は未確定）")));
  saveReconciliationAlias(data, admin, "JAPAN", { ...request, removeId: data.clients[0].bankAliases![0].id }); assert.equal(data.clients[0].bankAliases!.length, 0);
});

test("payer alias validation rejects conflicting identities, generic descriptions, stale and unauthorized requests", () => {
  const data = setup(); data.bankTransactions[0].content = "振込 テストメイギ";
  const request = { transactionId: "bank-income", transactionUpdatedAt: timestamp, invoiceKind: "issued" as const, invoiceId: "issued-1", invoiceUpdatedAt: timestamp, acknowledged: true as const };
  saveReconciliationAlias(data, admin, "JAPAN", request);
  data.clients.push({ ...data.clients[0], id: "other", bankAliases: [] }); data.issuedInvoices[1].clientId = "other";
  const before = structuredClone(data);
  assert.throws(() => saveReconciliationAlias(data, admin, "JAPAN", { ...request, invoiceId: "issued-2" }), /別の取引先/);
  assert.throws(() => saveReconciliationAlias(data, admin, "JAPAN", { ...request, transactionUpdatedAt: "stale" }));
  assert.throws(() => saveReconciliationAlias(data, { id: "guest", role: "GUEST" }, "JAPAN", request)); assert.deepEqual(data, before);
  const generic = setup(); generic.bankTransactions[0].content = "振込"; assert.throws(() => saveReconciliationAlias(generic, admin, "JAPAN", request), /識別/);
});

test("no-invoice-needed differs from excluded and cannot silently allocate an invoice", () => {
  const data = setup(); data.bankTransactions[1].bookkeeping = { invoiceRequirement: "NOT_REQUIRED" };
  const before = structuredClone(data);
  const bank = bankReconciliationOverview(data, "JAPAN", today).banks[1];
  assert.equal(bank.state, "not_required"); assert.match(bank.issue, /経費集計には残/);
  assert.equal(data.bankTransactions[1].treatment, "NORMAL");
  assert.equal(bankCategoryAllocations(data.bankTransactions[1]).reduce((sum, row) => sum + row.amount, 0), 8000);
  assert.throws(() => confirm(data, { invoiceKind: "received" }), /請求書不要/); assert.deepEqual(data, before);
});

test("holds block both single and batch confirmations without invalidating existing payment evidence", () => {
  const data = setup(); confirm(data, { amount: 4000 });
  data.bankTransactions[0].bookkeeping = { hold: { reason: "AMOUNT_MISMATCH", question: "Confirm remaining allocation" } };
  const before = structuredClone(data);
  assert.throws(() => confirm(data, { amount: 2000 }), /保留中/);
  assert.throws(() => confirmBankReconciliationBatch(data, admin, "JAPAN", batch(data, [{ amount: 2000 }]), today), /保留中/);
  assert.deepEqual(data, before);
  assert.equal(reconciliationIssue(data, data.bankReconciliations[0], today), "");
  const overview = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(overview.invoices[0].matched, 4000); assert.match(overview.banks[0].issue, /保留中/);
  assert.deepEqual(reconciliationCandidates(overview.banks[0], overview.invoices), []);
});

test("batch confirmation and unlink preserve split bookkeeping and expense allocations exactly", () => {
  const data = setup();
  data.bankTransactions[1].bookkeeping = { invoiceRequirement: "REQUIRED", splits: [
    { id: "rent", categoryId: "rent", amount: 7000, memo: "rent" },
    { id: "fee", categoryId: "fee", amount: 1000, memo: "fee" },
  ] };
  const beforeBank = structuredClone(data.bankTransactions), beforeAllocation = bankCategoryAllocations(data.bankTransactions[1]);
  confirmBankReconciliationBatch(data, admin, "JAPAN", batch(data, [{ invoiceKind: "received", amount: 8000 }]), today);
  assert.deepEqual(data.bankTransactions, beforeBank); assert.deepEqual(bankCategoryAllocations(data.bankTransactions[1]), beforeAllocation);
  const link = data.bankReconciliations[0]; removeBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt);
  assert.deepEqual(data.bankTransactions, beforeBank); assert.deepEqual(bankCategoryAllocations(data.bankTransactions[1]), beforeAllocation);
});

test("card settlements and transfer counterpart links remain visible without inventing invoice payments", () => {
  const data = setup();
  data.bankAccounts.push({ ...data.bankAccounts[0], id: "other-bank", sourceId: "other-bank", name: "Other bank", serviceName: "Other bank" });
  data.bankTransactions[0].bankAccountId = "other-bank"; data.bankTransactions[0].amount = 8000;
  confirmBankTransfer(data, admin, "JAPAN", { transactionId: "bank-income", transactionUpdatedAt: timestamp, counterpartId: "bank-expense", counterpartUpdatedAt: timestamp, acknowledged: true }, today);
  let view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.banks[0].transferCounterpart?.id, "bank-expense");
  assert.equal(view.banks[1].transferCounterpart?.id, "bank-income");
  assert.equal(data.payments.length, 0);
  const cardData = setup(); cardData.bankTransactions[1].content = "口座振替 APアプラス";
  cardData.bankAccounts.push({ ...cardData.bankAccounts[0], id: "card", name: "アプラスカード", serviceName: "アプラスカード" });
  view = bankReconciliationOverview(cardData, "JAPAN", today);
  assert.equal(view.banks[1].settlement?.provider, "アプラス"); assert.equal(view.banks[1].settlement?.accounts[0].id, "card");
  assert.throws(() => confirm(cardData, { invoiceKind: "received" }), /カード精算/); assert.equal(cardData.payments.length, 0);
});

test("allocation preview balances in cents, retains remainders and requires duplicate acknowledgement", () => {
  const data = setup(); data.bankTransactions[0].amount = 20000;
  const view = bankReconciliationOverview(data, "JAPAN", today);
  const rows: AllocationDraft[] = [{ id: "a", invoiceKey: "issued:issued-1", mode: "new", paymentId: "", amount: "12000", duplicateAcknowledged: false }, { id: "b", invoiceKey: "issued:issued-2", mode: "new", paymentId: "", amount: "7000.01", duplicateAcknowledged: false }];
  const preview = allocationPreview(view.banks[0], view.invoices, rows);
  assert.equal(preview.valid, true); assert.equal(preview.bankRemaining, 999.99); assert.equal(preview.outstanding(view.invoices[1]), 4999.99);
  assert.equal(allocationPreview(view.banks[0], view.invoices, [...rows, rows[0]]).valid, false);
  assert.equal(allocationPreview(view.banks[0], view.invoices, [{ ...rows[0], amount: "NaN" }]).valid, false);
  view.invoices[0].status = "PAID";
  assert.equal(allocationPreview(view.banks[0], view.invoices, rows).valid, false);
  assert.equal(allocationPreview(view.banks[0], view.invoices, [{ ...rows[0], duplicateAcknowledged: true }, rows[1]]).valid, true);
  assert.equal(view.invoices[0].originalHref, "/api/files/issued.pdf");
});

test("confirmed income registers one payment and updates issued invoice without changing bank source", () => {
  const data = setup(), before = JSON.stringify(data.bankTransactions);
  const result = confirm(data);
  assert.equal(result.createdPayment, true); assert.equal(data.payments.length, 1);
  assert.equal(data.payments[0].source, "BANK_RECONCILIATION"); assert.equal(data.payments[0].paymentDate, today);
  assert.equal(data.issuedInvoices[0].status, "PAID"); assert.equal(data.issuedInvoices[0].paidAt, today);
  assert.equal(JSON.stringify(data.bankTransactions), before);
  assert.equal(reconciliationIssue(data, data.bankReconciliations[0], today), "");
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.banks[0].state, "matched"); assert.equal(view.invoices[0].matched, 12000);
  assert.equal(view.invoices[0].outstanding, 0);
});

test("already-recorded status/manual payments are linked without duplication or date overwrite", () => {
  const data = setup(); confirm(data);
  const old = data.bankReconciliations.shift()!, payment = data.payments[0];
  payment.source = "INVOICE_STATUS"; payment.paymentDate = "2026-10-01";
  const paymentBefore = JSON.stringify(payment);
  confirm(data, { mode: "existing", paymentId: payment.id, paymentUpdatedAt: payment.updatedAt });
  assert.equal(data.payments.length, 1); assert.equal(JSON.stringify(payment), paymentBefore);
  assert.equal(data.bankReconciliations[0].createdPayment, false);
  assert.equal(data.issuedInvoices[0].paidAt, "2026-10-01");
  assert.notEqual(data.bankReconciliations[0].id, old.id);
});

test("received payment completion updates every linked mail document without counting mail twice", () => {
  const data = setup(); data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-copy" });
  confirm(data, { invoiceKind: "received", amount: 3000 });
  assert.equal(data.receivedInvoices[0].status, "SCHEDULED");
  assert.ok(data.mailDocuments.every((row) => !row.mailProcessed));
  confirm(data, { invoiceKind: "received", amount: 5000 });
  assert.equal(data.receivedInvoices[0].status, "PAID"); assert.equal(data.receivedInvoices[0].paidAt, today);
  assert.ok(data.mailDocuments.every((row) => row.mailProcessed));
  const rows = bankReconciliationOverview(data, "JAPAN", today).invoices.filter((row) => row.kind === "received");
  assert.equal(rows.length, 1); assert.equal(rows[0].matched, 8000); assert.equal(rows[0].mailCount, 2);
});

test("one bank movement can cover multiple invoices and multiple movements can cover one invoice", () => {
  const data = setup(); data.bankTransactions[0].amount = 20000;
  confirm(data);
  confirm(data, { invoiceId: "issued-2", amount: 8000 });
  assert.equal(data.issuedInvoices[1].status, "PARTIALLY_PAID");
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "second-deposit", sourceId: "second", amount: 4000 });
  confirm(data, { transactionId: "second-deposit", invoiceId: "issued-2", amount: 4000 });
  assert.equal(data.issuedInvoices[1].status, "PAID");
  const overview = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(overview.invoices.find((row) => row.id === "issued-2")!.matched, 12000);
  assert.equal(overview.banks.filter((row) => row.side === "INCOME").every((row) => row.state === "matched"), true);
});

test("partial bank matching leaves fee-like differences visible and never writes off the gap", () => {
  const data = setup(); data.bankTransactions[0].amount = 11670;
  confirm(data, { amount: 11670 });
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.invoices[0].outstanding, 330); assert.equal(view.invoices[0].unmatched, 330);
  assert.equal(data.issuedInvoices[0].status, "PARTIALLY_PAID"); assert.equal(data.payments[0].amount, 11670);
});

test("existing combined payment can be matched in parts, without allocating it twice", () => {
  const data = setup(); confirm(data); data.bankReconciliations = [];
  const payment = data.payments[0]; data.bankTransactions[0].amount = 6000;
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "part2", sourceId: "part2" });
  confirm(data, { amount: 6000, mode: "existing", paymentId: payment.id, paymentUpdatedAt: payment.updatedAt });
  confirm(data, { transactionId: "part2", amount: 6000, mode: "existing", paymentId: payment.id, paymentUpdatedAt: payment.updatedAt });
  assert.equal(data.payments.length, 1);
  assert.equal(bankReconciliationOverview(data, "JAPAN", today).invoices[0].payments[0].available, 0);
});

test("stale requests, duplicate requests, invalid amounts and acknowledgement fail atomically", () => {
  const data = setup();
  for (const patch of [{ transactionUpdatedAt: "stale" }, { invoiceUpdatedAt: "stale" }, { amount: 12001 }, { amount: 0 }, { amount: -1 }, { amount: 0.001 }, { amount: NaN }, { acknowledged: false as true }]) {
    const before = JSON.stringify(data);
    assert.throws(() => confirm(data, patch)); assert.equal(JSON.stringify(data), before);
  }
  const request = input(data); confirm(data);
  const after = JSON.stringify(data);
  assert.throws(() => confirmBankReconciliation(data, admin, "JAPAN", request, today)); assert.equal(JSON.stringify(data), after);
});

test("already paid invoices refuse a second payment and cancelled/draft documents cannot be matched", () => {
  const data = setup(); confirm(data); data.bankTransactions[0].amount = 24000; data.bankReconciliations = [];
  const before = JSON.stringify(data); assert.throws(() => confirm(data)); assert.equal(JSON.stringify(data), before);
  for (const status of ["DRAFT", "CANCELED", "REISSUED"] as const) {
    const fresh = setup(); fresh.issuedInvoices[0].status = status;
    assert.throws(() => confirm(fresh)); assert.equal(fresh.payments.length, 0);
  }
});

test("company, roles, side, source availability and card/transfer scope are enforced", () => {
  for (const role of ["BILLING_EDITOR", "MAIL_EDITOR", "PROJECT_MANAGER", "GUEST"] as const) assert.throws(() => confirmBankReconciliation(setup(), { id: "x", role }, "JAPAN", input(setup()), today));
  const data = setup();
  assert.throws(() => confirmBankReconciliation(data, admin, "CHINA", input(data), today));
  assert.throws(() => confirm(data, { invoiceId: "issued-cn" }));
  assert.throws(() => confirm(data, { transactionId: "bank-expense" }));
  for (const patch of [{ sourceMissing: true }, { treatment: "TRANSFER" }, { treatment: "EXCLUDED" }, { transactionDate: "2026-10-09" }, { amount: 0 }]) {
    const fresh = setup(); Object.assign(fresh.bankTransactions[0], patch); assert.throws(() => confirm(fresh));
  }
  data.bankAccounts[0].forecastSettings = { accountKind: "CARD", balanceMonth: "2026-10", minimumBalance: 0, incomePercent: 0, expensePercent: 0 };
  assert.throws(() => confirm(data)); assert.equal(data.payments.length, 0);
});

test("source corrections flag reconciliation instead of silently modifying payments", () => {
  const data = setup(); confirm(data);
  const payments = JSON.stringify(data.payments), link = data.bankReconciliations[0];
  for (const patch of [{ amount: 13000 }, { content: "corrected" }, { sourceMissing: true }]) {
    const original = { ...data.bankTransactions[0] }; Object.assign(data.bankTransactions[0], patch);
    assert.ok(reconciliationIssue(data, link, today));
    const view = bankReconciliationOverview(data, "JAPAN", today);
    assert.equal(view.banks[0].state, "conflict"); assert.equal(view.invoices[0].matched, 0);
    assert.equal(JSON.stringify(data.payments), payments);
    assert.throws(() => confirm(data, { amount: 1 })); Object.assign(data.bankTransactions[0], original);
  }
  data.bankTransactions[0].memo = "local memo"; data.bankTransactions[0].reviewed = true;
  assert.equal(reconciliationIssue(data, link, today), "");
});

test("invoice/payment changes invalidate evidence, including links on a different bank movement", () => {
  const data = setup(); confirm(data, { amount: 6000 });
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "other-deposit", sourceId: "other" });
  data.payments[0].amount = 5000;
  assert.ok(reconciliationIssue(data, data.bankReconciliations[0], today));
  assert.throws(() => confirm(data, { transactionId: "other-deposit", amount: 1000 }));
  data.payments[0].amount = 6000; data.issuedInvoices[0].total = 12500;
  assert.ok(reconciliationIssue(data, data.bankReconciliations[0], today));
});

test("unlink removes only reconciliation-created payments and recalculates mail completion", () => {
  const data = setup(); confirm(data, { invoiceKind: "received" });
  const link = data.bankReconciliations[0];
  removeBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt);
  assert.ok(data.payments[0].deletedAt); assert.ok(link.deletedAt);
  assert.equal(data.receivedInvoices[0].status, "SCHEDULED"); assert.equal(data.mailDocuments[0].mailProcessed, false);
  assert.equal(data.bankTransactions[1].amount, 8000);
  assert.throws(() => removeBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt));
});

test("unlinking an existing payment preserves it and edited new payments are protected", () => {
  const data = setup(); confirm(data); data.bankReconciliations = [];
  const payment = data.payments[0]; payment.source = undefined;
  confirm(data, { mode: "existing", paymentId: payment.id, paymentUpdatedAt: payment.updatedAt });
  const link = data.bankReconciliations[0], before = JSON.stringify(data.payments);
  removeBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt);
  assert.equal(JSON.stringify(data.payments), before); assert.equal(data.issuedInvoices[0].status, "PAID");
  const fresh = setup(); confirm(fresh); fresh.payments[0].updatedAt = "2030-01-01T00:00:00Z";
  const unchanged = JSON.stringify(fresh), created = fresh.bankReconciliations[0];
  assert.throws(() => removeBankReconciliation(fresh, admin, "JAPAN", created.id, created.updatedAt));
  assert.equal(JSON.stringify(fresh), unchanged);
});

test("paid status alone is not bank evidence and inconsistent mail status is visible and repairable", () => {
  const data = setup(); data.receivedInvoices[0].status = "PAID"; data.mailDocuments[0].mailProcessed = true;
  let row = bankReconciliationOverview(data, "JAPAN", today).invoices.find((item) => item.kind === "received")!;
  assert.equal(row.stateMismatch, true); assert.equal(row.matched, 0); assert.equal(row.outstanding, 8000);
  assert.throws(() => confirm(data, { invoiceKind: "received" }), /別の実際の支払い/);
  confirm(data, { invoiceKind: "received", duplicateAcknowledged: true }); data.mailDocuments[0].mailProcessed = false;
  row = bankReconciliationOverview(data, "JAPAN", today).invoices.find((item) => item.kind === "received")!;
  assert.equal(row.stateMismatch, true);
  const before = JSON.stringify(data.payments);
  syncReconciledInvoiceStatus(data, admin, "JAPAN", "received", row.id, row.updatedAt, today);
  assert.equal(data.mailDocuments[0].mailProcessed, true); assert.equal(JSON.stringify(data.payments), before);
});

test("matching reasons are evidence, not automatic confirmation; equal amounts remain ambiguous", () => {
  const data = setup(), before = JSON.stringify(data), view = bankReconciliationOverview(data, "JAPAN", today);
  const candidates = reconciliationCandidates(view.banks[0], view.invoices);
  assert.equal(candidates[0].key, "issued:issued-1"); assert.ok(candidates[0].reasons.includes("請求書番号が摘要に一致"));
  assert.ok(candidates.some((row) => row.key === "issued:issued-2"));
  assert.ok(candidates.every((row) => row.key.startsWith("issued:"))); assert.equal(JSON.stringify(data), before);
});

test("kana, corporate abbreviations and the vendor bank holder match without inventing kanji readings", () => {
  assert.equal(normalizeReconciliationName("（カ）ﾃｽﾄ ﾃﾞｻﾞｲﾝ"), normalizeReconciliationName("株式会社てすとデザイン"));
  assert.equal(normalizeReconciliationName("タナカ)"), "タナカ");
  const data = setup();
  data.vendors[0].companyName = "株式会社制作会社"; data.vendors[0].accountHolder = "カ）テストセイサク";
  data.bankTransactions[1].content = "振込 ｶ)ﾃｽﾄｾｲｻｸ"; data.receivedInvoices[0].dueDate = today;
  const view = bankReconciliationOverview(data, "JAPAN", today), candidates = reconciliationCandidates(view.banks[1], view.invoices);
  assert.ok(candidates[0].reasons.includes("振込口座名義が摘要に一致")); assert.equal(candidates[0].confidence, "strong");
});

test("amount-only old invoices are suppressed, near-date ties rank first, and number prefixes do not match", () => {
  const data = setup(); data.bankTransactions[0].content = "振込 読み不明 INV-0010";
  data.issuedInvoices[0].dueDate = "2025-01-01"; data.issuedInvoices[1].dueDate = today;
  const view = bankReconciliationOverview(data, "JAPAN", today), candidates = reconciliationCandidates(view.banks[0], view.invoices);
  assert.deepEqual(candidates.map((row) => row.key), ["issued:issued-2"]);
  assert.equal(candidates[0].confidence, "review"); assert.ok(candidates[0].warnings.includes("金額のみ一致・名義を確認"));
});

test("identity keeps partial/fee-like and old payments searchable but requires review", () => {
  const data = setup(); data.bankTransactions[0].amount = 11670; data.issuedInvoices[0].dueDate = "2025-01-01";
  const view = bankReconciliationOverview(data, "JAPAN", today), row = reconciliationCandidates(view.banks[0], view.invoices)[0];
  assert.equal(row.key, "issued:issued-1"); assert.equal(row.difference, -330); assert.equal(row.confidence, "review");
  assert.ok(row.warnings.includes("期日・記録日から90日超")); assert.equal(data.payments.length, 0);
});

test("confirmed bank descriptions teach the same party only within the same account", () => {
  const data = setup(); data.bankTransactions[0].content = "カ）ヨミカタフメイ";
  confirm(data);
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "next", sourceId: "next" });
  data.issuedInvoices[1].dueDate = today;
  let view = bankReconciliationOverview(data, "JAPAN", today), bank = view.banks.find((row) => row.id === "next")!;
  let row = reconciliationCandidates(bank, view.invoices)[0];
  assert.equal(row.key, "issued:issued-2"); assert.ok(row.reasons.includes("同じ口座・摘要の確定済み照合と一致"));
  assert.equal(row.confidence, "strong");
  row = reconciliationCandidates({ ...bank, accountId: "other" }, view.invoices)[0];
  assert.equal(row.confidence, "review");
  data.bankReconciliations[0].deletedAt = timestamp;
  view = bankReconciliationOverview(data, "JAPAN", today); bank = view.banks.find((row) => row.id === "next")!;
  assert.ok(reconciliationCandidates(bank, view.invoices).every((item) => !item.reasons.includes("同じ口座・摘要の確定済み照合と一致")));
});

test("ambiguous and invalid confirmations do not teach a payee", () => {
  const data = setup(); data.bankTransactions[0].content = "共通の振込サービス"; confirm(data);
  data.clients.push({ ...data.clients[0], id: "another-party", companyName: "Another party" });
  data.issuedInvoices[1].clientId = "another-party";
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "next", sourceId: "next" });
  confirm(data, { transactionId: "next", invoiceId: "issued-2" });
  assert.ok(bankReconciliationOverview(data, "JAPAN", today).invoices.every((row) => !row.confirmedNames.length));
  data.bankTransactions[0].amount += 1;
  assert.equal(bankReconciliationOverview(data, "JAPAN", today).invoices.find((row) => row.id === "issued-1")!.confirmedNames.length, 0);
});

test("existing payment default prioritizes exact amount then nearest date; amount evidence is not doubled", () => {
  const data = setup(); const view = bankReconciliationOverview(data, "JAPAN", today), invoice = view.invoices[0], bank = view.banks[0];
  invoice.outstanding = 12000; invoice.dueDate = today;
  const base = { updatedAt: timestamp, method: "手入力", amount: 12000, available: 12000 };
  invoice.payments = [{ ...base, id: "small", available: 100, date: today }, { ...base, id: "old", date: "2025-01-01" }, { ...base, id: "exact", date: today }];
  assert.equal(reconciliationPaymentOptions(bank, invoice)[0].id, "exact");
  const withPayment = reconciliationCandidates(bank, [invoice])[0];
  invoice.payments = [];
  assert.equal(reconciliationCandidates(bank, [invoice])[0].score, withPayment.score);
});

test("equal-evidence invoices are marked ambiguous while an explicit invoice number takes precedence", () => {
  const data = setup(); data.issuedInvoices.forEach((row) => { row.dueDate = today; });
  data.bankTransactions[0].content = "Test customer";
  let view = bankReconciliationOverview(data, "JAPAN", today);
  assert.ok(reconciliationCandidates(view.banks[0], view.invoices).every((row) => row.confidence === "review" && row.warnings.includes("同条件の請求書が複数")));
  data.bankTransactions[0].content += " INV-001";
  view = bankReconciliationOverview(data, "JAPAN", today);
  const candidates = reconciliationCandidates(view.banks[0], view.invoices);
  assert.equal(candidates[0].key, "issued:issued-1"); assert.equal(candidates[0].confidence, "strong");
  assert.equal(candidates[1].confidence, "review"); assert.ok(candidates[1].warnings.includes("別の請求書番号が摘要に一致"));
});

test("legacy Undo preserves new reconciliation records and current patches undo linked payment/status together", () => {
  const data = setup(), before = structuredClone(data); confirm(data, { invoiceKind: "received" });
  const link = data.bankReconciliations[0], payment = data.payments[0];
  const legacy = structuredClone(data) as unknown as Record<string, unknown>; delete legacy.bankReconciliations;
  restoreUndoState(data, legacy); assert.equal(data.bankReconciliations[0].id, link.id);
  const source = data.bankTransactions[1]; source.content = "newer source";
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [
    { collection: "bankReconciliations", id: link.id, index: 0, before: null }, { collection: "payments", id: payment.id, index: 0, before: null },
    { collection: "receivedInvoices", id: "received-1", index: 0, before: before.receivedInvoices[0] },
    { collection: "mailDocuments", id: "mail-1", index: 0, before: before.mailDocuments[0] },
  ] });
  assert.equal(data.bankReconciliations.length, 0); assert.equal(data.payments.length, 0);
  assert.equal(data.receivedInvoices[0].status, "SCHEDULED"); assert.equal(data.mailDocuments[0].mailProcessed, false);
  assert.equal(source.content, "newer source");
});

test("cent-precision partial allocations do not leave floating point residuals", () => {
  const data = setup(); data.issuedInvoices[0].total = 0.3; data.bankTransactions[0].amount = 0.3;
  confirm(data, { amount: 0.1 }); confirm(data, { amount: 0.2 });
  assert.equal(bankReconciliationOverview(data, "JAPAN", today).banks[0].remaining, 0);
  assert.equal(data.issuedInvoices[0].status, "PAID");
});

test("deleted invoices do not leak details through another company or stale bank links", () => {
  const data = setup(); confirm(data); data.issuedInvoices[0].projectId = "china";
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.ok(!view.invoices.some((row) => row.id === "issued-1")); assert.ok(view.links[0].issue);
  assert.equal(bankReconciliationOverview(data, "CHINA", today).links.length, 0);
});

test("invoice and mail status mismatches stay visible without inventing payments", () => {
  const data = setup(); confirm(data); confirm(data, { invoiceKind: "received" });
  data.issuedInvoices[0].status = "WAITING_PAYMENT";
  data.receivedInvoices[0].mailProcessed = false;
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.ok(view.invoices.find((row) => row.id === "issued-1")!.stateMismatch);
  assert.ok(view.invoices.find((row) => row.id === "received-1")!.stateMismatch);
  assert.equal(reconciliationCandidates(view.banks[0], view.invoices).length, 0);
  const paymentBefore = JSON.stringify(data.payments);
  syncReconciledInvoiceStatus(data, admin, "JAPAN", "issued", "issued-1", data.issuedInvoices[0].updatedAt, today);
  assert.equal(data.issuedInvoices[0].status, "PAID"); assert.equal(JSON.stringify(data.payments), paymentBefore);
});

test("unlinked postal invoices are flagged and foreign-company partner names are not disclosed", () => {
  const data = setup();
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "orphan", relatedReceivedInvoiceId: "missing" });
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "foreign", company: "CHINA", relatedReceivedInvoiceId: undefined });
  data.clients[0].company = "CHINA";
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.unlinkedMailCount, 1); assert.equal(view.invoices[0].party, "取引先未設定");
  assert.equal(view.invoices.find((row) => row.id === "received-1")!.mailCount, 1);
});

test("10,000 reconciliations can be summarized with indexed lookups", () => {
  const data = setup(); confirm(data);
  const bank = data.bankTransactions[0], invoice = data.issuedInvoices[0], payment = data.payments[0], link = data.bankReconciliations[0];
  data.bankTransactions = []; data.issuedInvoices = []; data.payments = []; data.bankReconciliations = [];
  for (let i = 0; i < 10000; i++) {
    const id = String(i), bankSnapshot = JSON.parse(link.bankEvidence), paymentSnapshot = JSON.parse(link.paymentEvidence);
    bankSnapshot[2] = id; paymentSnapshot[1] = id;
    data.bankTransactions.push({ ...bank, id, sourceId: id });
    data.issuedInvoices.push({ ...invoice, id }); data.payments.push({ ...payment, id, issuedInvoiceId: id });
    data.bankReconciliations.push({ ...link, id, transactionId: id, invoiceId: id, paymentId: id, bankEvidence: JSON.stringify(bankSnapshot), paymentEvidence: JSON.stringify(paymentSnapshot) });
  }
  const started = performance.now(), view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.banks.length, 10000); assert.equal(view.links.length, 10000);
  assert.ok(view.banks.every((row) => row.state === "matched")); assert.ok(view.links.every((row) => !row.issue));
  assert.ok(performance.now() - started < 5000, "overview should not repeatedly scan full source arrays");
});

test("Japan invoice accounts are UFJ or the specific PayPay suffix, not cards or provider IDs", () => {
  const account = setup().bankAccounts[0];
  for (const serviceName of ["三菱UFJ銀行", "三菱東京UFJ銀行（法人）", "三菱ＵＦＪ銀行（BizSTATION）", "UFJ銀行", "MUFG Bank", "三菱UFJ（BizSTATION）"]) {
    assert.equal(invoiceAccountScopeIssue({ ...account, serviceName }), "", serviceName);
  }
  for (const name of ["PayPay銀行 / 普通 1237691", "PayPay銀行 / 普通 ７６９１", "PayPay銀行 / ****7691", "普通預金 1237691（円）"]) {
    assert.equal(invoiceAccountScopeIssue({ ...account, serviceName: "PayPay銀行", name }), "", name);
  }
  for (const name of ["PayPay銀行", "PayPay銀行 / 普通", "PayPay銀行 / 普通 1237692", "PayPay銀行 / 普通 7691000", "PayPay銀行 / 7691支店 / 普通 1234567"]) {
    assert.ok(invoiceAccountScopeIssue({ ...account, serviceName: "PayPay銀行", name, sourceSubId: "7691", sourceId: "7691" }), name);
  }
  for (const serviceName of ["三井住友銀行", "楽天銀行", "UFJニコス", "三菱UFJカード", "PayPayカード"]) {
    assert.ok(invoiceAccountScopeIssue({ ...account, serviceName, name: `${serviceName} / 7691` }), serviceName);
  }
  assert.ok(invoiceAccountScopeIssue({ ...account, serviceName: "PayPay銀行", name: "PayPay銀行 Visaデビット 7691" }));
  assert.equal(invoiceAccountScopeIssue({ ...account, company: "CHINA", serviceName: "Other bank" }), "");
});

test("both invoice directions enforce account scope atomically and preserve expense classifications", () => {
  for (const invoiceKind of ["issued", "received"] as const) for (const serviceName of ["楽天銀行", "PayPay銀行", "三菱UFJカード"]) {
    const data = setup(); Object.assign(data.bankAccounts[0], { serviceName, name: `${serviceName} / 普通 1234567` });
    data.bankTransactions.forEach((row) => { row.categoryId = "expense-category"; row.reviewed = true; row.classificationSource = "MANUAL"; });
    const before = JSON.stringify(data), view = bankReconciliationOverview(data, "JAPAN", today);
    assert.ok(view.banks.every((row) => row.state === "excluded"));
    assert.ok(view.banks.every((row) => reconciliationCandidates(row, view.invoices).length === 0));
    assert.throws(() => confirm(data, { invoiceKind }), /照合.*対象/);
    assert.equal(JSON.stringify(data), before);
  }
  const data = setup(); Object.assign(data.bankAccounts[0], { serviceName: "PayPay銀行", name: "PayPay銀行 / 普通 1237691" });
  confirm(data); confirm(data, { invoiceKind: "received" });
  assert.ok(bankReconciliationOverview(data, "JAPAN", today).banks.every((row) => row.state === "matched"));
});

test("the restricted account scope preserves historical matches, payment totals and postal completion", () => {
  const data = setup(); confirm(data); confirm(data, { invoiceKind: "received" });
  Object.assign(data.bankAccounts[0], { serviceName: "Other bank", name: "Other bank" });
  const before = JSON.stringify(data), view = bankReconciliationOverview(data, "JAPAN", today);
  assert.ok(view.banks.every((row) => row.state === "matched" && row.issue));
  assert.ok(view.links.every((row) => !row.issue));
  assert.equal(view.invoices.find((row) => row.id === "received-1")!.matched, 8000);
  assert.equal(view.invoices.find((row) => row.id === "issued-1")!.matched, 12000);
  assert.equal(JSON.stringify(data), before);
  data.mailDocuments[0].mailProcessed = false;
  syncReconciledInvoiceStatus(data, admin, "JAPAN", "received", "received-1", data.receivedInvoices[0].updatedAt, today);
  assert.equal(data.mailDocuments[0].mailProcessed, true);
  const link = data.bankReconciliations.find((row) => row.invoiceKind === "received")!;
  removeBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt);
  assert.equal(data.receivedInvoices[0].status, "SCHEDULED");
  assert.equal(data.mailDocuments[0].mailProcessed, false);
});

test("partial historical matches on expense accounts remain valid but cannot be extended", () => {
  const data = setup(); confirm(data, { amount: 6000 });
  data.bankAccounts[0].serviceName = "楽天銀行";
  const before = JSON.stringify(data), view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.banks[0].state, "excluded"); assert.equal(view.banks[0].allocated, 6000);
  assert.equal(view.invoices[0].matched, 6000); assert.equal(view.links[0].issue, "");
  assert.throws(() => confirm(data, { amount: 6000 }), /照合.*対象/); assert.equal(JSON.stringify(data), before);
  data.bankTransactions[0].amount++;
  assert.equal(bankReconciliationOverview(data, "JAPAN", today).banks[0].state, "conflict");
});

test("project, counterparty, memo and eligible status edits keep confirmed links; amount and ineligible status changes flag them", () => {
  const data = setup(); confirm(data); confirm(data, { invoiceKind: "received" });
  const issued = data.issuedInvoices[0], received = data.receivedInvoices[0];
  data.projects.push({ ...data.projects.find((row) => row.id === issued.projectId)!, id: "other-project", name: "Other project" });
  data.clients.push({ ...data.clients[0], id: "another-client", companyName: "Another client", bankAliases: [] });
  data.vendors.push({ ...data.vendors[0], id: "another-vendor", companyName: "Another vendor", bankAliases: [] });
  Object.assign(issued, { projectId: "other-project", clientId: "another-client", notes: "edited", internalMemo: "memo", status: "SENT" });
  Object.assign(received, { projectId: "other-project", vendorId: "another-vendor", memo: "edited", status: "APPROVAL_PENDING", dueDate: "2026-12-31" });
  assert.ok(data.bankReconciliations.every((link) => !reconciliationIssue(data, link, today)));
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.ok(view.invoices.filter((row) => ["issued-1", "received-1"].includes(row.id)).every((row) => !row.conflict && row.matched > 0 && row.reaffirmable === 0));
  assert.ok(view.banks.every((row) => row.state === "matched"));
  issued.total += 500;
  assert.match(reconciliationIssue(data, data.bankReconciliations.find((link) => link.invoiceKind === "issued")!, today), /金額/);
  received.status = "ON_HOLD";
  assert.match(reconciliationIssue(data, data.bankReconciliations.find((link) => link.invoiceKind === "received")!, today), /状態/);
});

test("reaffirm re-records evidence after a reviewed source change and refuses unsupported links", () => {
  const data = setup(); confirm(data);
  const link = data.bankReconciliations[0];
  assert.throws(() => reaffirmBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt, today), /要再確認ではありません/);
  data.bankTransactions[0].content = "Test customer INV-001 (corrected)";
  assert.match(reconciliationIssue(data, link, today), /摘要/);
  assert.equal(reconciliationReaffirmBlocker(data, link, today), "");
  assert.throws(() => reaffirmBankReconciliation(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", link.id, link.updatedAt, today), /権限/);
  assert.throws(() => reaffirmBankReconciliation(data, admin, "JAPAN", link.id, "stale", today), /更新されています/);
  const before = JSON.stringify([data.payments, data.issuedInvoices]);
  const result = reaffirmBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt, today);
  assert.match(result.issue, /摘要/);
  assert.equal(reconciliationIssue(data, link, today), ""); assert.ok(link.reaffirmedAt); assert.equal(link.reaffirmedById, admin.id); assert.match(link.reaffirmedIssue!, /摘要/);
  assert.equal(JSON.stringify([data.payments, data.issuedInvoices]), before);
  assert.equal(bankReconciliationOverview(data, "JAPAN", today).banks[0].state, "matched");
  data.issuedInvoices[0].total += 500;
  assert.equal(reconciliationReaffirmBlocker(data, link, today), "");
  reaffirmBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt, today);
  assert.equal(reconciliationIssue(data, link, today), "");
  data.payments[0].amount = 5000;
  assert.match(reconciliationReaffirmBlocker(data, link, today), /支払い記録の金額/);
  assert.throws(() => reaffirmBankReconciliation(data, admin, "JAPAN", link.id, link.updatedAt, today), /支払い記録の金額/);
  data.payments[0].amount = link.amount; data.bankTransactions[0].sourceMissing = true;
  assert.match(reconciliationReaffirmBlocker(data, link, today), /元明細/);
  data.bankTransactions[0].sourceMissing = false; data.issuedInvoices[0].status = "CANCELED";
  assert.match(reconciliationReaffirmBlocker(data, link, today), /状態を確定/);
  data.issuedInvoices[0].status = "ISSUED"; data.payments[0].deletedAt = today;
  assert.match(reconciliationReaffirmBlocker(data, link, today), /見つかりません/);
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.equal(view.links[0].reaffirmable, false); assert.ok(view.links[0].reaffirmBlocker); assert.ok(view.links[0].issue);
});

test("invoice-level reaffirm keeps every supported link or nothing", () => {
  const data = setup(); data.issuedInvoices[0].total = 12000; data.bankTransactions[0].amount = 7000;
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "bank-income-2", sourceId: "source-income-2", amount: 5000 });
  confirm(data, { amount: 7000 }); confirm(data, { transactionId: "bank-income-2", amount: 5000 });
  const invoice = data.issuedInvoices[0];
  assert.throws(() => reaffirmInvoiceReconciliations(data, admin, "JAPAN", "issued", invoice.id, invoice.updatedAt, today), /要再確認の照合はありません/);
  invoice.total = 12300;
  assert.equal(bankReconciliationOverview(data, "JAPAN", today).invoices.find((row) => row.id === invoice.id)!.reaffirmable, 2);
  assert.throws(() => reaffirmInvoiceReconciliations(data, admin, "JAPAN", "issued", invoice.id, "stale", today), /更新されています/);
  const second = data.bankTransactions.find((row) => row.id === "bank-income-2")!;
  second.sourceMissing = true;
  const snapshot = JSON.stringify(data.bankReconciliations);
  assert.throws(() => reaffirmInvoiceReconciliations(data, admin, "JAPAN", "issued", invoice.id, invoice.updatedAt, today), /維持できない照合/);
  assert.equal(JSON.stringify(data.bankReconciliations), snapshot);
  second.sourceMissing = false;
  const result = reaffirmInvoiceReconciliations(data, admin, "JAPAN", "issued", invoice.id, invoice.updatedAt, today);
  assert.equal(result.count, 2);
  assert.ok(data.bankReconciliations.every((link) => !reconciliationIssue(data, link, today) && link.reaffirmedAt));
  const row = bankReconciliationOverview(data, "JAPAN", today).invoices.find((item) => item.id === invoice.id)!;
  assert.equal(row.conflict, false); assert.equal(row.matched, 12000); assert.equal(row.reaffirmable, 0); assert.equal(row.outstanding, 300);
});
