import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { bankReconciliationOverview, confirmBankReconciliation, reconciliationCandidates, reconciliationIssue, removeBankReconciliation, syncReconciledInvoiceStatus, type ReconcileInput } from "../src/lib/bank-reconciliation";
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
