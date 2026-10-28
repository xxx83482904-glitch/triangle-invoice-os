import assert from "node:assert/strict";
import test from "node:test";
import { dashboardSummary } from "../src/lib/dashboard";
import { bankAccountOverview } from "../src/lib/bank-account-overview";
import type { AppData, Payment, UserRole } from "../src/lib/types";
import type { BankTransaction } from "../src/lib/banking-types";
import { admin, fixture, timestamp } from "./document-fixture";

const today = "2026-10-28";
const summary = (data: AppData, year?: string) => dashboardSummary(data, admin, "JAPAN", today, year);
function payment(id: string, invoice: string, amount: number, type: Payment["type"] = "INCOME"): Payment {
  return { id, type, amount, issuedInvoiceId: type === "INCOME" ? invoice : undefined, receivedInvoiceId: type === "EXPENSE" ? invoice : undefined,
    paymentDate: today, createdById: "admin", createdAt: timestamp, updatedAt: timestamp };
}
function bankFixture() {
  const data = fixture();
  data.bankAccounts = ["ufj", "paypay", "card", "unknown"].map((id) => ({ id, company: "JAPAN", officeCode: "office", sourceId: id,
    name: id, serviceName: id, available: true, isManual: false, createdAt: timestamp, updatedAt: timestamp,
    overviewSettings: { kind: id === "card" ? "CARD" : id === "unknown" ? "UNKNOWN" : "BANK", recordedAt: timestamp,
      balance: id === "ufj" || id === "paypay" ? { amount: id === "ufj" ? 100000 : 20000, asOf: "2026-09-30", currency: "JPY" } : undefined } }));
  const movement = (id: string, bankAccountId: string, amount: number, side: BankTransaction["side"], treatment: BankTransaction["treatment"] = "NORMAL"): BankTransaction => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId, amount, side, treatment, transactionDate: "2026-10-01", content: id, sourceMemo: "", sourceStatus: "", sourceMissing: false, reviewed: false, classificationSource: "MANUAL", memo: "", createdAt: timestamp, updatedAt: timestamp });
  data.bankTransactions = [movement("income", "ufj", 30000, "INCOME"), movement("aplas", "ufj", 12000, "EXPENSE", "TRANSFER"),
    movement("out", "ufj", 5000, "EXPENSE", "TRANSFER"), movement("in", "paypay", 5000, "INCOME", "TRANSFER"),
    movement("purchase", "card", 12000, "EXPENSE"), movement("unknown", "unknown", 7000, "EXPENSE")];
  data.bankSyncStates = [{ id: "sync", company: "JAPAN", officeCode: "office", officeName: "Test", status: "SUCCESS", autoSync: false, lastSuccessAt: timestamp, imported: 6, updated: 0, coverage: [{ start: "2026-09-01", end: today, accountIds: ["ufj", "paypay", "card", "unknown"] }], createdAt: timestamp, updatedAt: timestamp }];
  return data;
}

test("dashboard uses the current August closing period, not the latest imported month", () => {
  const data = bankFixture();
  data.bankTransactions.forEach((row) => { row.transactionDate = "2026-06-01"; });
  const report = summary(data);
  assert.deepEqual(report.period, { year: 2027, start: "2026-09-01", end: "2027-08-31" });
  assert.equal(report.months[0].month, "2026-09"); assert.equal(report.months[11].month, "2027-08");
  assert.equal(report.through, today); assert.equal(report.months[2].future, true);
  assert.equal(summary(data, "2026").months[9].income, 35000);
  assert.equal(summary(data, "2026").through, "2026-08-31");
  assert.equal(summary(data, "2099").period.year, 2027);
  assert.equal(summary(data, "garbage").period.year, 2027);
  assert.equal(dashboardSummary(data, admin, "JAPAN", "2026-08-31").period.year, 2026);
  assert.equal(dashboardSummary(data, admin, "JAPAN", "2026-09-01").period.year, 2027);
});

test("receivables use per-invoice outstanding amounts, never net another invoice's overpayment", () => {
  const data = fixture();
  data.issuedInvoices.forEach((row) => { row.status = "SENT"; row.needsReview = false; });
  data.payments.push(payment("partial", "issued-1", 3000), payment("over", "issued-2", 20000), { ...payment("deleted", "issued-1", 9000), deletedAt: timestamp }, payment("wrong-kind", "issued-1", 5000, "EXPENSE"));
  const report = summary(data);
  assert.equal(report.incoming.amount, 9000); assert.equal(report.incoming.count, 1); assert.equal(report.incoming.overdue, 1);
  assert.equal(report.receivables[0].href, "/issued-invoices?company=JAPAN&document=issued%3Aissued-1");
  assert.equal(summary(data, "2025").incoming.amount, 9000);
  data.issuedInvoices[0].status = "CANCELED";
  assert.equal(summary(data).incoming.amount, 0);
});

test("draft, canceled, deleted, foreign and deleted-project invoices never enter invoice totals", () => {
  const data = fixture(), original = data.issuedInvoices[0];
  data.issuedInvoices.push({ ...original, id: "valid", status: "SENT", issueDate: "2026-10-20", needsReview: false },
    { ...original, id: "cancel", status: "CANCELED" }, { ...original, id: "deleted", status: "SENT", deletedAt: timestamp },
    { ...original, id: "future", status: "SENT", issueDate: "2026-11-01" }, { ...original, id: "invalid", status: "SENT", issueDate: "2026-02-30" });
  data.projects.find((row) => row.id === "other")!.deletedAt = timestamp;
  const report = summary(data);
  assert.equal(report.months.reduce((sum, row) => sum + row.issued, 0), 12000);
  assert.equal(report.review.some((row) => row.id === "issued:issued-1" && row.reasons.includes("下書き")), true);
  assert.equal(report.review.some((row) => row.id === "issued:invalid" && row.reasons.includes("発行日未設定")), true);
  assert.equal(report.review.some((row) => row.id === "issued:issued-2" || row.id === "issued:issued-cn"), false);
});

test("received payments and inconsistent paid status are visible without asking for payment twice", () => {
  const data = fixture(), original = data.receivedInvoices[0];
  data.receivedInvoices.push({ ...original, id: "partial", status: "SCHEDULED" }, { ...original, id: "rejected", status: "REJECTED" }, { ...original, id: "archived", status: "ARCHIVED" }, { ...original, id: "deleted", deletedAt: timestamp });
  data.payments.push(payment("partial-payment", "partial", 3000, "EXPENSE"));
  let report = summary(data);
  assert.equal(report.outgoing.amount, 13000); assert.equal(report.outgoing.count, 2); assert.equal(report.outgoing.overdue, 1);
  assert.equal(report.payables.find((row) => row.id === "received:received-1")!.paymentMismatch, true);
  assert.equal(report.review.some((row) => row.reasons.includes("支払記録要確認")), true);
  assert.equal(report.months[0].received, 16000);
  data.payments.push(payment("paid", "received-1", 8000, "EXPENSE"));
  report = summary(data);
  assert.equal(report.outgoing.amount, 5000); assert.equal(report.review.some((row) => row.reasons.includes("支払記録要確認")), false);
});

test("deadlines distinguish overdue, today, next seven days, undated and later", () => {
  const data = fixture(), original = data.issuedInvoices[0];
  data.issuedInvoices = ["2026-10-27", today, "2026-11-04", "", "2026-11-05"].map((dueDate, i) => ({ ...original, id: `i${i}`, status: "SENT", dueDate }));
  const report = summary(data);
  assert.equal(report.incoming.overdue, 1); assert.equal(report.incoming.soon, 2);
  assert.deepEqual(report.receivables.map((row) => row.timing), ["overdue", "soon", "soon", "undated", "later"]);
  assert.equal(report.receivables[3].reasons.includes("期限未設定"), true);
});

test("dashboard and bank overview share balances; transfers cancel, AP settlement changes cash only once", () => {
  const data = bankFixture(), before = structuredClone(data);
  data.payments.push(payment("invoice-payment", "issued-1", 30000));
  const report = summary(data), overview = bankAccountOverview(data, "JAPAN", undefined, today, "2027");
  assert.equal(report.cash.amount, 138000); assert.equal(report.cash.registered, 2); assert.equal(report.cash.unknownAccounts, 1);
  assert.equal(report.months[1].income, 35000); assert.equal(report.months[1].expense, 17000);
  assert.equal(report.months[1].covered, true); assert.equal(report.months[1].count, 4);
  for (const account of report.accounts) assert.deepEqual(account.balanceCalculation, overview.rows.find((row) => row.id === account.id)!.balanceCalculation);
  assert.equal(summary(data, "2026").cash.amount, 138000);
  data.payments.pop(); assert.deepEqual(data, before);
});

test("missing coverage, missing balance and missing bank rows are not silently reported as complete", () => {
  const data = bankFixture();
  data.bankSyncStates[0].coverage = [];
  data.bankAccounts[1].overviewSettings!.balance = undefined;
  data.bankTransactions[0].sourceMissing = true;
  const report = summary(data);
  assert.equal(report.cash.provisional, 1); assert.equal(report.cash.missing, 1);
  assert.equal(report.cash.amount, 83000); assert.equal(report.banking.missing, 1);
  assert.equal(report.months[1].covered, false); assert.equal(report.months[1].income, 5000);
  assert.equal(summary(fixture()).cash.amount, null);
});

test("mail counts linked received invoices only once and isolates the company", () => {
  const data = fixture();
  data.receivedInvoices[0].mailProcessed = false; data.receivedInvoices[0].status = "RECEIVED";
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "duplicate-mail" }, { ...data.mailDocuments[0], id: "unlinked", relatedReceivedInvoiceId: undefined, mailProcessed: false }, { ...data.mailDocuments[0], id: "foreign", company: "CHINA", relatedReceivedInvoiceId: undefined, mailProcessed: false });
  assert.equal(summary(data).pendingMail, 2);
  assert.equal(dashboardSummary(data, admin, "CHINA", today).pendingMail, 0);
  data.receivedInvoices[0].mailProcessed = true;
  assert.equal(summary(data).pendingMail, 1);
});

test("dashboard rejects non-accounting roles before returning any totals", () => {
  const data = fixture();
  for (const role of ["BILLING_EDITOR", "MAIL_EDITOR", "CHIEF_DESIGNER", "PROJECT_MANAGER", "DESIGNER", "GUEST"] as UserRole[]) {
    assert.throws(() => dashboardSummary(data, { id: "someone", role }, "JAPAN", today), /権限/);
  }
  assert.equal(dashboardSummary(data, { id: "accounting", role: "ACCOUNTING" }, "JAPAN", today).projectCount, 2);
  assert.throws(() => dashboardSummary(data, admin, "JAPAN", "not-a-date"), /基準日/);
});
