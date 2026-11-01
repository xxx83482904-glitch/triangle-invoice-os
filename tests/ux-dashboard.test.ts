import assert from "node:assert/strict";
import test from "node:test";
import { admin } from "./document-fixture";
import { uxRound1Fixture } from "./ux-round1-fixture";
import { dashboardSummary } from "../src/lib/dashboard";
import { dashboardWorkRows } from "../src/lib/dashboard-work";
import { dashboardNextSteps } from "../src/lib/dashboard-next-steps";
import { isReconcileTodo, RECONCILE_TODO_STATUS } from "../src/lib/bank-reconcile-todo";
import { bankFilters, selectBankTransactions } from "../src/lib/banking";
import { bankReconciliationOverview } from "../src/lib/bank-reconciliation";
import { integrityReport } from "../src/lib/integrity";
import { acknowledgeIntegrity } from "../src/lib/integrity-acknowledgements";
import { projectAttention } from "../src/lib/project-attention";

const today = "2026-11-01";
const fileExists = (url?: string) => Boolean(url?.endsWith("ux-original.pdf"));
function setup() {
  const data = uxRound1Fixture(today);
  const summary = dashboardSummary(data, admin, "JAPAN", today);
  return { data, summary, steps: dashboardNextSteps(data, admin, summary, fileExists) };
}

test("dashboard next steps and their document panel share exact counts and outstanding amounts", () => {
  const { summary, steps } = setup();
  assert.deepEqual(steps.map((s) => s.id), ["expense-overdue", "income-overdue", "integrity", "expense-soon", "income-soon", "documents", "bank-unreviewed", "bank-unmatched", "mail"]);
  for (const step of steps) if ("view" in step.target) {
    const rows = dashboardWorkRows(summary, step.target.view, step.target.timing);
    assert.equal(step.count, rows.length);
    if (step.amount !== undefined) assert.equal(step.amount, rows.reduce((sum, r) => sum + r.remaining, 0));
  }
  assert.equal(steps.find((s) => s.id === "income-overdue")!.amount, 10000, "partial receipt leaves only the outstanding amount");
  assert.equal(steps.find((s) => s.id === "expense-soon")!.count, summary.outgoing.soon);
  assert.equal(steps.find((s) => s.id === "income-overdue")!.count, summary.incoming.overdue);
});

test("dashboard bank links match the existing destination filters, including missing and excluded rows", () => {
  const { data, steps } = setup();
  const step = steps.find((s) => s.id === "bank-unreviewed")!;
  assert.ok("href" in step.target);
  const params = Object.fromEntries(new URL(step.target.href, "http://synthetic.invalid").searchParams);
  assert.equal(step.count, selectBankTransactions(data, "JAPAN", bankFilters(params)).total);
  const match = steps.find((s) => s.id === "bank-unmatched")!;
  assert.ok("href" in match.target);
  assert.equal(new URL(match.target.href, "http://synthetic.invalid").searchParams.get("status"), RECONCILE_TODO_STATUS);
  assert.equal(match.count, bankReconciliationOverview(data, "JAPAN", today).banks.filter((r) => isReconcileTodo(r, today)).length);
});

test("mail and integrity steps explicitly explain their broader destination counts", () => {
  const { data, summary, steps } = setup();
  assert.equal(steps.find((s) => s.id === "mail")!.count, summary.pendingMail);
  assert.match(steps.find((s) => s.id === "mail")!.caveat!, /受領請求書.*全件.*異なり/);
  assert.equal(steps.find((s) => s.id === "integrity")!.count, integrityReport(data, "JAPAN", { today, fileExists }).severity.ERROR);
  assert.match(steps.find((s) => s.id === "integrity")!.caveat!, /警告・参考.*異なり/);
});

test("dashboard integrity step excludes acknowledged errors and reappears when evidence changes", () => {
  const { data, summary } = setup();
  const error = integrityReport(data, "JAPAN", { today, fileExists }).issues.find((r) => r.severity === "ERROR")!;
  assert.ok(error);
  acknowledgeIntegrity(data, admin, "JAPAN", { mode: "ISSUE", kind: error.kind, reason: "合成確認", targets: [{ id: error.id, fingerprint: error.fingerprint }] }, { today, fileExists });
  assert.equal(dashboardNextSteps(data, admin, summary, fileExists).some((s) => s.id === "integrity"), false);
  data.mailDocuments.find((m) => m.id === "ux-mail-missing")!.relatedReceivedInvoiceId = "another-missing-invoice";
  assert.equal(dashboardNextSteps(data, admin, summary, fileExists).some((s) => s.id === "integrity"), true);
});

test("zero action counts are omitted and reading dashboard steps changes no data", () => {
  const { data } = setup();
  data.projects = []; data.issuedInvoices = []; data.receivedInvoices = []; data.mailDocuments = []; data.payments = []; data.bankTransactions = [];
  const before = structuredClone(data), summary = dashboardSummary(data, admin, "JAPAN", today);
  assert.deepEqual(dashboardNextSteps(data, admin, summary, fileExists), []);
  assert.deepEqual(data, before);
});

test("China dashboard never builds new action rows or probes files", () => {
  const { data, summary } = setup();
  assert.deepEqual(dashboardNextSteps(data, admin, { ...summary, company: "CHINA" }, () => { throw new Error("must not probe"); }), []);
});

test("PAID without payment evidence is in document review, not an urgent deadline action", () => {
  const { data } = setup();
  data.issuedInvoices.find((r) => r.id === "ux-issued-overdue")!.status = "PAID";
  const summary = dashboardSummary(data, admin, "JAPAN", today);
  const steps = dashboardNextSteps(data, admin, summary, fileExists);
  assert.equal(steps.some((s) => s.id === "income-overdue"), false);
  assert.ok(dashboardWorkRows(summary, "review").some((r) => r.id === "issued:ux-issued-overdue"));
  assert.ok(dashboardWorkRows(summary, "income").some((r) => r.id === "issued:ux-issued-overdue"));
});

test("preview projects exercise all urgency reasons while reference-only projects stay quiet", () => {
  const { data } = setup();
  assert.deepEqual(data.projects.filter((p) => projectAttention(data, p, today).length).map((p) => p.id), ["ux-project-overdue", "ux-project-soon", "ux-project-review", "ux-project-expense-overdue", "ux-project-income-soon"]);
  const before = structuredClone(data);
  dashboardNextSteps(data, admin, dashboardSummary(data, admin, "JAPAN", today), fileExists);
  assert.deepEqual(data, before);
});
