import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin } from "./document-fixture";
import { documentRows, type DocumentRow } from "../src/lib/documents";
import { orderDocuments } from "../src/lib/document-order";
import { groupIssuedDocuments, issuedListSummary, issuedRowAmounts } from "../src/lib/issued-list";
import { can } from "../src/lib/rbac";

const base = (): DocumentRow => documentRows(fixture(), admin, "JAPAN").find((r) => r.kind === "issued")!;

test("issued summary excludes drafts, canceled and other document kinds", () => {
  const row = base();
  const summary = issuedListSummary([
    { ...row, status: "ISSUED", total: 1000, paidAmount: 200 },
    { ...row, status: "DRAFT", total: 9000 }, { ...row, status: "CANCELED", total: 8000 },
    { ...row, kind: "received", status: "PAID", total: 5000, paidAmount: 5000 },
  ]);
  assert.equal(summary.total, 1000); assert.equal(summary.paid, 200); assert.equal(summary.outstanding, 800);
  assert.equal(summary.review, 3);
});

test("overpayments never offset a different invoice's outstanding amount", () => {
  const row = base();
  const summary = issuedListSummary([{ ...row, total: 1000, paidAmount: 1300, status: "PAID" }, { ...row, total: 2000, paidAmount: 100, status: "PARTIALLY_PAID" }]);
  assert.equal(summary.paid, 1400); assert.equal(summary.outstanding, 1900);
  assert.equal(issuedRowAmounts({ ...row, status: "DRAFT" }).outstanding, 0);
  assert.equal(issuedRowAmounts({ ...row, status: "CANCELED" }).outstanding, 0);
});

test("summary derives canonical paid amounts from payment records", () => {
  const data = fixture(); data.issuedInvoices[0].status = "ISSUED";
  data.payments.push({ id: "income", type: "INCOME", issuedInvoiceId: "issued-1", amount: 3000, paymentDate: "2026-10-01", createdById: "admin", createdAt: data.issuedInvoices[0].createdAt, updatedAt: data.issuedInvoices[0].updatedAt });
  const rows = documentRows(data, admin, "JAPAN").filter((r) => r.kind === "issued");
  assert.equal(issuedListSummary(rows).outstanding, 9000); assert.equal(issuedListSummary(rows).paid, 3000);
});

test("grouping is independent from sorting and preserves displayed order", () => {
  const row = base();
  const rows = [{ ...row, id: "a", projectId: "p1", counterpartId: "c1", date: "2026-09-01", month: "2026-09", total: 100 },
    { ...row, id: "b", projectId: "p2", counterpartId: "c2", date: "2026-10-01", month: "2026-10", total: 300 },
    { ...row, id: "c", projectId: "p1", counterpartId: "c1", date: "2026-10-02", month: "2026-10", total: 200 }];
  const original = structuredClone(rows);
  assert.deepEqual(orderDocuments(rows, "amount-asc").map((r) => r.id), ["a", "c", "b"]);
  const sorted = orderDocuments(rows, "date-desc");
  assert.deepEqual(groupIssuedDocuments(sorted, "none", 50).map(([, list]) => list.map((r) => r.id)), [["c", "b", "a"]]);
  assert.deepEqual(groupIssuedDocuments(sorted, "client", 50).map(([, list]) => list.map((r) => r.id)), [["c", "a"], ["b"]]);
  assert.deepEqual(groupIssuedDocuments(sorted, "project", 50).map(([, list]) => list.map((r) => r.id)), [["c", "a"], ["b"]]);
  assert.deepEqual(groupIssuedDocuments(sorted, "month", 50).map(([month]) => month), ["2026-10", "2026-09"]);
  assert.deepEqual(rows, original);
});

test("progressive groups extend past 50 without losing or duplicating rows", () => {
  const row = base(), rows = Array.from({ length: 75 }, (_, index) => ({ ...row, id: String(index) }));
  for (const mode of ["none", "month", "project", "client"] as const) {
    assert.equal(groupIssuedDocuments(rows, mode, 50).flatMap(([, list]) => list).length, 50);
    const all = groupIssuedDocuments(rows, mode, 100).flatMap(([, list]) => list);
    assert.equal(all.length, 75); assert.equal(new Set(all.map((r) => r.id)).size, 75);
  }
});

test("aggregate visibility stays restricted to administration and accounting", () => {
  for (const role of ["BILLING_EDITOR", "PROJECT_MANAGER", "MAIL_EDITOR"] as const) assert.equal(can({ role }, "view:reports"), false);
  for (const role of ["ADMIN", "ACCOUNTING"] as const) assert.equal(can({ role }, "view:reports"), true);
});
