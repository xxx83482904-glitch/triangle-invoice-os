import assert from "node:assert/strict";
import test from "node:test";
import { dashboardSummary } from "../src/lib/dashboard";
import { matchesCompany } from "../src/lib/company";
import { visibleProjects } from "../src/lib/documents";
import { receivedPayableSummary } from "../src/lib/received-invoice-payables";
import { filterReceivedInvoices, receivedListTotals, receivedSummaryBasis } from "../src/lib/received-invoice-list";
import type { AppData, User } from "../src/lib/types";
import { admin, timestamp } from "./document-fixture";
import { receivedSummaryFixture, summaryToday } from "./received-summary-fixture";

function listRows(data: AppData, user: Pick<User, "id" | "role"> = admin) {
  const projects = visibleProjects(data, user).filter((row) => !row.deletedAt && matchesCompany(row, "JAPAN"));
  return data.receivedInvoices.filter((row) => !row.deletedAt && projects.some((project) => project.id === row.projectId)).map((row) => {
    const summary = receivedPayableSummary(data, row);
    return { ...row, vendorName: data.vendors.find((vendor) => vendor.id === row.vendorId)?.companyName || "",
      projectName: projects.find((project) => project.id === row.projectId)!.name,
      paidAmount: summary.paid, unpaidAmount: summary.unpaidAmount, paymentComplete: summary.complete, unpaidExclusion: summary.unpaidExclusion };
  });
}
const selected = (data: AppData) => filterReceivedInvoices(listRows(data), "unpaid", "", summaryToday);
const report = (data: AppData, year?: string) => dashboardSummary(data, admin, "JAPAN", summaryToday, year);
const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

test("received unpaid list matches dashboard IDs, count and amount with excluded, paid and partial documents", () => {
  const data = receivedSummaryFixture(), rows = selected(data), dashboard = report(data);
  assert.deepEqual(ids(rows), ["group-current", "open", "paid-without-record", "partial", "previous-year", "undated"]);
  assert.deepEqual(ids(rows), dashboard.payables.map((row) => row.id.replace(/^received:/, "")).sort());
  const totals = receivedListTotals(rows);
  assert.equal(totals.count, 6); assert.equal(totals.unpaid, 42500);
  assert.equal(totals.count, dashboard.outgoing.count); assert.equal(totals.unpaid, dashboard.outgoing.amount);
  assert.equal(totals.total, 49500); assert.equal(totals.paid, 7000);
});

test("archived, rejected and deleted invoices retain their individual balance but contribute no payable", () => {
  const data = receivedSummaryFixture();
  for (const [id, reason, balance] of [["archived", "アーカイブ", 90000], ["rejected", "却下", 80000], ["deleted", "削除済み", 500000]] as const) {
    const summary = receivedPayableSummary(data, data.receivedInvoices.find((row) => row.id === id)!);
    assert.equal(summary.unpaidExclusion, reason); assert.equal(summary.unpaidAmount, 0);
    assert.equal(summary.outstanding, balance); assert.equal(summary.complete, false);
  }
});

test("only the current debt document contributes its remaining balance; receipts and superseded copies do not", () => {
  const data = receivedSummaryFixture(), rows = listRows(data);
  for (const id of ["group-old", "group-receipt"]) {
    assert.equal(rows.find((row) => row.id === id)!.unpaidAmount, 0);
    assert.equal(rows.find((row) => row.id === id)!.unpaidExclusion, "債務グループの支払対象外");
  }
  assert.equal(rows.find((row) => row.id === "group-current")!.unpaidAmount, 5000);
  data.receivedInvoices.find((row) => row.id === "group-current")!.deletedAt = timestamp;
  assert.ok(ids(selected(data)).includes("group-old")); assert.ok(!ids(selected(data)).includes("group-receipt"));
  assert.equal(receivedListTotals(selected(data)).unpaid, report(data).outgoing.amount);
});

test("paid filters use payment completion, not excluded zero balances or the saved PAID label", () => {
  const data = receivedSummaryFixture(), rows = listRows(data);
  assert.deepEqual(ids(filterReceivedInvoices(rows, "paid", "", summaryToday)), ["overpaid", "paid"]);
  assert.equal(rows.find((row) => row.id === "partial")!.unpaidAmount, 15000);
  assert.equal(rows.find((row) => row.id === "overpaid")!.unpaidAmount, 0);
  assert.equal(rows.find((row) => row.id === "open")!.unpaidAmount, 10000);
});

test("PAID without payment records stays in both unpaid totals and the dashboard review list", () => {
  const data = receivedSummaryFixture(), dashboard = report(data);
  assert.equal(selected(data).find((row) => row.id === "paid-without-record")!.unpaidAmount, 4000);
  const document = dashboard.payables.find((row) => row.id === "received:paid-without-record")!;
  assert.equal(document.paymentMismatch, true);
  assert.ok(dashboard.review.some((row) => row.id === document.id && row.reasons.includes("支払記録要確認")));
});

test("canceled, wrong-direction and ambiguous payments are ignored consistently", () => {
  const data = receivedSummaryFixture();
  data.payments.push({ ...data.payments[0], id: "ambiguous", receivedInvoiceId: "open", issuedInvoiceId: "synthetic-issued", amount: 4000 });
  const invoice = data.receivedInvoices.find((row) => row.id === "open")!;
  assert.equal(receivedPayableSummary(data, invoice).paid, 0);
  assert.equal(selected(data).find((row) => row.id === invoice.id)!.unpaidAmount, 10000);
  assert.equal(receivedListTotals(selected(data)).unpaid, report(data).outgoing.amount);
});

test("all-document cards retain documentary totals and disclose unpaid exclusions", () => {
  const rows = filterReceivedInvoices(listRows(receivedSummaryFixture()), "all", "", summaryToday);
  assert.deepEqual(receivedListTotals(rows), { count: 13, total: 268500, paid: 44000, unpaid: 42500, unpaidCount: 6, excludedCount: 4 });
  assert.ok(rows.some((row) => row.id === "archived")); assert.ok(rows.some((row) => row.id === "group-old"));
});

test("search applies to every card as well as the visible unpaid rows", () => {
  const rows = listRows(receivedSummaryFixture());
  const result = filterReceivedInvoices(rows, "unpaid", "  合成支払先B  ", summaryToday);
  assert.deepEqual(ids(result), ["partial"]);
  assert.deepEqual(receivedListTotals(result), { count: 1, total: 20000, paid: 5000, unpaid: 15000, unpaidCount: 1, excludedCount: 0 });
  for (const query of ["合成案件B", "PARTIAL.PDF"]) assert.deepEqual(ids(filterReceivedInvoices(rows, "unpaid", query, summaryToday)), ["partial"]);
  for (const query of ["合成検索目印", "請求元:"]) assert.deepEqual(ids(filterReceivedInvoices(rows, "unpaid", query, summaryToday)), ["open"]);
  assert.equal(filterReceivedInvoices(rows, "unpaid", "archived.pdf", summaryToday).length, 0);
});

test("basis labels identify the filter, trimmed search and all-period scope including undated documents", () => {
  assert.equal(receivedSummaryBasis("all", "", "2026年10月")[2], "期間：2026年10月");
  assert.deepEqual(receivedSummaryBasis("unpaid", "  "), ["表示中の絞り込み：未払い", "検索：なし", "期間：全期間（日付なしを含む）"]);
  assert.deepEqual(receivedSummaryBasis("all", "  合成検索目印  "), ["表示中の絞り込み：すべて", "検索：「合成検索目印」", "期間：全期間（日付なしを含む）"]);
});

test("prior-year and undated payables remain in the list and dashboard regardless of chart year", () => {
  const data = receivedSummaryFixture(), total = receivedListTotals(selected(data));
  assert.ok(ids(selected(data)).includes("undated")); assert.ok(ids(selected(data)).includes("previous-year"));
  for (const year of ["2025", "2026", "2027"]) {
    assert.equal(report(data, year).outgoing.amount, total.unpaid);
    assert.equal(report(data, year).outgoing.count, total.count);
  }
});

test("deadline filters respect exclusions and ignore missing or invalid dates", () => {
  const data = receivedSummaryFixture();
  for (const row of data.receivedInvoices.filter((row) => ["archived", "rejected", "group-old"].includes(row.id))) row.dueDate = "2026-10-01";
  let rows = listRows(data);
  assert.deepEqual(ids(filterReceivedInvoices(rows, "overdue", "", summaryToday)), ["paid-without-record", "partial", "previous-year"]);
  assert.deepEqual(ids(filterReceivedInvoices(rows, "dueSoon", "", summaryToday)), ["group-current", "open"]);
  data.receivedInvoices.find((row) => row.id === "open")!.dueDate = "2026-02-30";
  rows = listRows(data);
  assert.ok(!ids(filterReceivedInvoices(rows, "overdue", "", summaryToday)).includes("open"));
  assert.ok(!ids(filterReceivedInvoices(rows, "dueSoon", "", summaryToday)).includes("open"));
});

test("no search matches yield zero cards; excluded-only search retains its file total", () => {
  const rows = listRows(receivedSummaryFixture());
  assert.deepEqual(receivedListTotals(filterReceivedInvoices(rows, "unpaid", "no-match", summaryToday)), { count: 0, total: 0, paid: 0, unpaid: 0, unpaidCount: 0, excludedCount: 0 });
  assert.deepEqual(receivedListTotals(filterReceivedInvoices(rows, "all", "archived.pdf", summaryToday)), { count: 1, total: 90000, paid: 0, unpaid: 0, unpaidCount: 0, excludedCount: 1 });
});

test("shared monetary calculation keeps nonfinite legacy values out of both totals", () => {
  const data = receivedSummaryFixture();
  data.payments.push({ ...data.payments[0], id: "invalid-payment", receivedInvoiceId: "open", amount: Number.NaN });
  data.receivedInvoices.find((row) => row.id === "undated")!.total = Number.POSITIVE_INFINITY;
  assert.equal(receivedPayableSummary(data, data.receivedInvoices.find((row) => row.id === "open")!).paid, 0);
  assert.equal(receivedListTotals(selected(data)).unpaid, 40000);
  assert.equal(receivedListTotals(selected(data)).unpaid, report(data).outgoing.amount);
});

test("cent precision and per-invoice overpayments cannot create differences between the two totals", () => {
  const data = receivedSummaryFixture();
  data.receivedInvoices = data.receivedInvoices.slice(0, 2).map((row, index) => ({ ...row, total: index ? 0.2 : 0.1 }));
  data.payments = [];
  assert.equal(receivedListTotals(selected(data)).unpaid, 0.3);
  assert.equal(report(data).outgoing.amount, 0.3);
});

test("scope and aggregation are read-only, preserve flags and never expose deleted or foreign projects", () => {
  const data = receivedSummaryFixture(), before = structuredClone(data);
  for (const role of ["ADMIN", "ACCOUNTING"] as const) {
    const user = { id: "admin", role }, rows = filterReceivedInvoices(listRows(data, user), "unpaid", "", summaryToday);
    const dashboard = dashboardSummary(data, user, "JAPAN", summaryToday);
    assert.equal(rows.length, dashboard.outgoing.count); assert.equal(receivedListTotals(rows).unpaid, dashboard.outgoing.amount);
  }
  assert.ok(!listRows(data).some((row) => ["deleted", "deleted-project-invoice", "missing-project-invoice", "foreign"].includes(row.id)));
  const chiefRows = listRows(data, { id: "manager", role: "CHIEF_DESIGNER" });
  assert.ok(!chiefRows.some((row) => row.id === "partial"));
  assert.deepEqual(data, before);
});
