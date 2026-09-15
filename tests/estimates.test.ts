import test from "node:test";
import assert from "node:assert/strict";
import { saveEstimate, convertEstimate, deleteEstimate } from "../src/lib/estimates";
import { documentRows, isBillableIssuedInvoice } from "../src/lib/documents";
import { projectMoney, restoreUndoState } from "../src/lib/store";
import { fixture, admin, manager } from "./document-fixture";
import type { EstimateInput } from "../src/lib/estimate-values";

const billing = { id: "billing", role: "BILLING_EDITOR" as const };
const input = (): EstimateInput => ({ projectId: "japan", clientId: "client", issueDate: "2026-09-15", validUntil: "2026-10-15", status: "DRAFT", notes: "Customer note", internalMemo: "Private memo",
  items: [{ description: "Design", quantity: 1.5, unitPrice: 20000, taxRate: 10 }, { description: "Materials", quantity: 2, unitPrice: 500, taxRate: 8 }, { description: "Other", quantity: 1, unitPrice: 100, taxRate: 0 }] });
const dates = { issueDate: "2026-09-15", transactionDate: "2026-09-16", dueDate: "2026-10-31" };

test("estimates have independent numbers and totals and do not enter financial totals", () => {
  const data = fixture(); const before = projectMoney(data, "japan");
  const e = saveEstimate(data, billing, "JAPAN", input());
  assert.equal(e.total, 34180); assert.equal(e.taxTotal, 3080); assert.equal(e.estimateNumber, "EST-2026-0001");
  assert.equal(saveEstimate(data, billing, "JAPAN", input()).estimateNumber, "EST-2026-0002");
  assert.deepEqual(projectMoney(data, "japan"), before);
  assert.ok(documentRows(data, billing, "JAPAN").some((r) => r.id === `estimate:${e.id}` && r.category === "ESTIMATE"));
  assert.ok(!documentRows(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN").some((r) => r.kind === "estimate"));
});

test("conversion copies all fields into a draft and is idempotent on a stale retry", () => {
  const data = fixture(); const e = saveEstimate(data, billing, "JAPAN", input());
  const request = { id: e.id, updatedAt: e.updatedAt, ...dates };
  const invoice = convertEstimate(data, billing, "JAPAN", request);
  assert.equal(invoice.estimateId, e.id); assert.equal(e.invoiceId, invoice.id); assert.equal(e.status, "CONVERTED");
  for (const key of ["projectId", "clientId", "subtotal", "taxTotal", "total", "notes", "internalMemo"] as const) assert.equal(invoice[key], e[key]);
  assert.equal(invoice.transactionDate, dates.transactionDate); assert.equal(invoice.dueDate, dates.dueDate);
  assert.equal(invoice.status, "DRAFT"); assert.ok(!isBillableIssuedInvoice(invoice));
  const items = data.issuedInvoiceItems.filter((i) => i.invoiceId === invoice.id);
  assert.equal(items.length, e.items.length);
  items.forEach((item, index) => { for (const key of ["description", "quantity", "unitPrice", "amount", "taxRate"] as const) assert.equal(item[key], e.items[index][key]); });
  assert.equal(convertEstimate(data, billing, "JAPAN", request).id, invoice.id);
  assert.equal(data.issuedInvoices.filter((i) => i.estimateId === e.id).length, 1);
  assert.throws(() => saveEstimate(data, billing, "JAPAN", { ...input(), id: e.id, updatedAt: e.updatedAt }));
  assert.throws(() => deleteEstimate(data, billing, "JAPAN", e));
  invoice.deletedAt = invoice.updatedAt;
  assert.throws(() => convertEstimate(data, billing, "JAPAN", request));
  assert.equal(data.issuedInvoices.filter((i) => i.estimateId === e.id).length, 1);
});

test("authorization covers estimates, conversion and deletion by company and assigned project", () => {
  const data = fixture();
  assert.throws(() => saveEstimate(data, billing, "CHINA", { ...input(), projectId: "china" }));
  assert.throws(() => saveEstimate(data, billing, "JAPAN", { ...input(), projectId: "china" }));
  assert.throws(() => saveEstimate(data, manager, "JAPAN", { ...input(), projectId: "other" }));
  assert.throws(() => saveEstimate(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", input()));
  const e = saveEstimate(data, admin, "JAPAN", { ...input(), projectId: "other" });
  assert.throws(() => convertEstimate(data, manager, "JAPAN", { ...e, ...dates }));
  assert.throws(() => deleteEstimate(data, manager, "JAPAN", e));
  assert.throws(() => saveEstimate(data, manager, "JAPAN", { ...input(), id: e.id, updatedAt: e.updatedAt }));
  assert.ok(!documentRows(data, manager, "JAPAN").some((r) => r.sourceId === e.id));
  assert.deepEqual(documentRows(data, billing, "CHINA"), []);
});

test("validation and stale updates leave the original unchanged", () => {
  const data = fixture(); const e = saveEstimate(data, billing, "JAPAN", input());
  const before = JSON.stringify(data);
  const bad = [ { ...input(), items: [] }, { ...input(), validUntil: "2026-02-30" }, { ...input(), validUntil: "2026-01-01" },
    { ...input(), items: [{ ...input().items[0], quantity: -1 }] }, { ...input(), items: [{ ...input().items[0], unitPrice: Infinity }] },
    { ...input(), id: e.id, updatedAt: "stale" }, { ...input(), clientId: "missing" } ];
  bad.forEach((value) => assert.throws(() => saveEstimate(data, billing, "JAPAN", value)));
  assert.throws(() => convertEstimate(data, billing, "JAPAN", { ...e, ...dates, dueDate: "2026-01-01" }));
  assert.equal(JSON.stringify(data), before);
  const oldVersion = e.updatedAt;
  saveEstimate(data, billing, "JAPAN", { ...input(), id: e.id, updatedAt: e.updatedAt, items: [{ description: "Changed", quantity: 1, unitPrice: 10, taxRate: 0 }] });
  assert.equal(e.total, 10); assert.notEqual(e.updatedAt, oldVersion);
  assert.throws(() => convertEstimate(data, billing, "JAPAN", { ...dates, id: e.id, updatedAt: oldVersion }));
});

test("declined estimates cannot convert; deletion is soft and numbers are not reused", () => {
  const data = fixture(); const e = saveEstimate(data, billing, "JAPAN", { ...input(), status: "DECLINED" });
  assert.throws(() => convertEstimate(data, billing, "JAPAN", { ...e, ...dates }));
  deleteEstimate(data, billing, "JAPAN", e);
  assert.ok(e.deletedAt); assert.equal(e.items.length, 3);
  assert.ok(!documentRows(data, billing, "JAPAN").some((r) => r.sourceId === e.id));
  assert.equal(saveEstimate(data, billing, "JAPAN", input()).estimateNumber, "EST-2026-0002");
});

test("conversion allocates a unique invoice number including previously deleted numbers", () => {
  const data = fixture(); data.issuedInvoices[0].invoiceNumber = "TRI-2026-0001"; data.issuedInvoices[0].deletedAt = data.issuedInvoices[0].updatedAt;
  const e = saveEstimate(data, billing, "JAPAN", input());
  assert.equal(convertEstimate(data, billing, "JAPAN", { ...e, ...dates }).invoiceNumber, "TRI-2026-0002");
});

test("legacy undo snapshots preserve new estimates and new patches can restore them", () => {
  const data = fixture(); const e = saveEstimate(data, billing, "JAPAN", input());
  const oldSnapshot = { ...fixture() } as Partial<ReturnType<typeof fixture>>;
  delete oldSnapshot.estimates; delete oldSnapshot.auditLogs;
  restoreUndoState(data, oldSnapshot);
  assert.equal(data.estimates[0].id, e.id);
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [{ collection: "estimates", id: e.id, index: 0, before: null }] });
  assert.equal(data.estimates.length, 0);
});
