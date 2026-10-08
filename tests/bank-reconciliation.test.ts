import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { bankReconciliationOverview, confirmBankReconciliation, reconciliationCandidates, reconciliationIssue, removeBankReconciliation, syncReconciledInvoiceStatus, type ReconcileInput } from "../src/lib/bank-reconciliation";
import { restoreUndoState } from "../src/lib/store";

const today = "2026-10-08";
function setup() {
  const data = fixture();
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "テスト銀行", serviceName: "Bank", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
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
  confirm(data, { invoiceKind: "received" }); data.mailDocuments[0].mailProcessed = false;
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
