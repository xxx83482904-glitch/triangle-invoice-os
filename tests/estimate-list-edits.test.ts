import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin, manager } from "./document-fixture";
import { convertEstimate, deleteEstimates, saveEstimate, saveEstimateListEdits } from "../src/lib/estimates";
import { estimateListEditFrom, type EstimateInput } from "../src/lib/estimate-values";
import { documentRows } from "../src/lib/documents";
import { groupDocuments, orderDocuments } from "../src/lib/document-order";
import { projectMoney } from "../src/lib/store";

const input: EstimateInput = { projectId: "japan", clientId: "client", issueDate: "2026-09-15", validUntil: "2026-11-30", status: "DRAFT",
  notes: "Customer note", internalMemo: "Private note", items: [{ description: "Design", details: "Two revisions", quantity: 1, unitPrice: 10000, taxRate: 10 }] };
const dates = { issueDate: "2026-10-01", transactionDate: "2026-10-01", dueDate: "2026-11-30" };
function setup() { const data = fixture(); const a = saveEstimate(data, admin, "JAPAN", input); const b = saveEstimate(data, admin, "JAPAN", input); return { data, a, b }; }

test("list edits save statuses together, preserve line details and financial totals", () => {
  const { data, a, b } = setup();
  const original = structuredClone(a), totals = projectMoney(data, "japan");
  saveEstimateListEdits(data, admin, "JAPAN", [a, b].map((e) => ({ ...estimateListEditFrom(e), status: "SENT", issueDate: "2026-10-01" })));
  assert.equal(a.status, "SENT"); assert.equal(b.status, "SENT"); assert.notEqual(a.updatedAt, original.updatedAt);
  for (const field of ["items", "total", "taxTotal", "notes", "internalMemo", "estimateNumber"] as const) assert.deepEqual(a[field], original[field]);
  assert.deepEqual(projectMoney(data, "japan"), totals);
  const rows = documentRows(data, admin, "JAPAN").filter((r) => r.kind === "estimate");
  assert.ok(rows.every((r) => r.statusLabel === "送付済み" && r.month === "2026-10"));
  assert.equal(groupDocuments(orderDocuments(rows, "client"), "client", 50).length, 1);
});

test("changing project synchronizes the client in documents and invoice conversion", () => {
  const { data, a } = setup();
  data.clients.push({ ...data.clients[0], id: "next-client", companyName: "Next client" });
  data.projects.find((p) => p.id === "other")!.clientId = "next-client";
  saveEstimateListEdits(data, admin, "JAPAN", [{ ...estimateListEditFrom(a), projectId: "other", status: "ACCEPTED" }]);
  assert.equal(a.clientId, "next-client");
  assert.equal(documentRows(data, admin, "JAPAN").find((r) => r.sourceId === a.id)?.counterpart, "Next client");
  const invoice = convertEstimate(data, admin, "JAPAN", { ...a, ...dates });
  assert.equal(invoice.clientId, "next-client"); assert.equal(invoice.projectId, "other"); assert.equal(invoice.status, "DRAFT");
});

test("a status-only edit preserves an explicitly chosen estimate client", () => {
  const { data, a } = setup();
  data.clients.push({ ...data.clients[0], id: "custom-client" }); a.clientId = "custom-client";
  saveEstimateListEdits(data, admin, "JAPAN", [{ ...estimateListEditFrom(a), status: "SENT" }]);
  assert.equal(a.clientId, "custom-client");
});

test("batch save and delete are atomic on stale or duplicate targets", () => {
  const { data, a, b } = setup(), before = structuredClone(data);
  assert.throws(() => saveEstimateListEdits(data, admin, "JAPAN", [{ ...estimateListEditFrom(a), status: "SENT" }, { ...estimateListEditFrom(b), updatedAt: "stale" }]));
  assert.deepEqual(data, before);
  assert.throws(() => deleteEstimates(data, admin, "JAPAN", [a, { ...b, updatedAt: "stale" }]));
  assert.deepEqual(data, before);
  assert.throws(() => saveEstimateListEdits(data, admin, "JAPAN", [estimateListEditFrom(a), estimateListEditFrom(a)]));
  assert.throws(() => deleteEstimates(data, admin, "JAPAN", [a, a]));
  assert.deepEqual(data, before);
});

test("converted estimates lock the entire batch, even with a forged editable status", () => {
  const { data, a, b } = setup(); convertEstimate(data, admin, "JAPAN", { ...b, ...dates });
  const before = structuredClone(data);
  assert.throws(() => saveEstimateListEdits(data, admin, "JAPAN", [estimateListEditFrom(a), estimateListEditFrom(b)]));
  assert.throws(() => deleteEstimates(data, admin, "JAPAN", [a, b]));
  assert.deepEqual(data, before);
});

test("batch validation enforces dates, role, company, source and destination projects", () => {
  const { data, a } = setup(), edit = estimateListEditFrom(a), before = structuredClone(data);
  const invalid = [ { ...edit, validUntil: "2026-08-01" }, { ...edit, issueDate: "2026-02-30" },
    { ...edit, projectId: "china" }, { ...edit, projectId: "missing" }, { ...edit, status: "CONVERTED" } ];
  for (const value of invalid) assert.throws(() => saveEstimateListEdits(data, admin, "JAPAN", [value as typeof edit]));
  const mail = { id: "mail", role: "MAIL_EDITOR" as const };
  assert.throws(() => saveEstimateListEdits(data, mail, "JAPAN", [edit]));
  assert.throws(() => deleteEstimates(data, mail, "JAPAN", [a]));
  assert.throws(() => saveEstimateListEdits(data, manager, "JAPAN", [{ ...edit, projectId: "other" }]));
  assert.throws(() => saveEstimateListEdits(data, admin, "CHINA", [edit]));
  assert.throws(() => deleteEstimates(data, admin, "CHINA", [a]));
  assert.deepEqual(data, before);
  a.projectId = "other";
  assert.throws(() => saveEstimateListEdits(data, manager, "JAPAN", [estimateListEditFrom(a)]));
  assert.throws(() => deleteEstimates(data, manager, "JAPAN", [a]));
});

test("a deleted or foreign destination client rejects all changes", () => {
  for (const change of [{ deletedAt: "2026-10-01" }, { company: "CHINA" as const }]) {
    const { data, a, b } = setup();
    data.clients.push({ ...data.clients[0], id: "unavailable", ...change });
    data.projects.find((p) => p.id === "other")!.clientId = "unavailable";
    const before = structuredClone(data);
    assert.throws(() => saveEstimateListEdits(data, admin, "JAPAN", [estimateListEditFrom(a), { ...estimateListEditFrom(b), projectId: "other" }]));
    assert.deepEqual(data, before);
  }
});

test("batch deletion hides estimates across document views but retains source details", () => {
  const { data, a, b } = setup(); const items = structuredClone(a.items);
  deleteEstimates(data, admin, "JAPAN", [a, b]);
  assert.ok(a.deletedAt && b.deletedAt); assert.deepEqual(a.items, items);
  assert.equal(documentRows(data, admin, "JAPAN").filter((r) => r.kind === "estimate").length, 0);
});
