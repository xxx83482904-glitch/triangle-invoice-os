import test from "node:test";
import assert from "node:assert/strict";
import { documentItemsFromFormData, documentItemsSchema, documentItemTotals } from "../src/lib/document-items";
import { deleteClient, updateProjectBasics } from "../src/lib/partner-project-edits";
import { groupDocuments, orderDocuments } from "../src/lib/document-order";
import { documentRows } from "../src/lib/documents";
import { can } from "../src/lib/rbac";
import { fixture, admin, manager, timestamp } from "./document-fixture";

const billing = { id: "billing", role: "BILLING_EDITOR" as const };
function fields(count: number, details = true) {
  const form = new FormData();
  for (let i = 0; i < count; i++) {
    form.append("itemDescription", `項目${i + 1}`);
    if (details) form.append("itemDetails", `内訳${i + 1}\n追加説明`);
    form.append("itemQuantity", "1.5"); form.append("itemUnitPrice", "1000"); form.append("itemTaxRate", "10");
  }
  return form;
}

test("dynamic items preserve details, order and totals up to 100 rows", () => {
  const items = documentItemsFromFormData(fields(100));
  assert.equal(items.length, 100); assert.equal(items[99].description, "項目100");
  assert.equal(items[99].details, "内訳100\n追加説明");
  assert.deepEqual(documentItemTotals(items), { subtotal: 150000, taxTotal: 15000, total: 165000 });
  assert.throws(() => documentItemsFromFormData(fields(101)));
});

test("legacy forms without details remain valid and empty trailing rows are ignored", () => {
  const form = fields(1, false);
  form.append("itemDescription", ""); form.append("itemQuantity", ""); form.append("itemUnitPrice", ""); form.append("itemTaxRate", "10");
  const items = documentItemsFromFormData(form);
  assert.equal(items.length, 1); assert.equal(items[0].details, "");
});

test("invalid and mismatched rows are not silently dropped", () => {
  const detailsOnly = fields(1); detailsOnly.set("itemDescription", "");
  const unbalanced = fields(2); unbalanced.set("itemDetails", "only one");
  const badPrice = fields(1); badPrice.set("itemUnitPrice", "-1");
  const badQty = fields(1); badQty.set("itemQuantity", "0");
  const badTax = fields(1); badTax.set("itemTaxRate", "");
  const excessive = fields(1); excessive.set("itemDetails", "a".repeat(6001));
  for (const form of [detailsOnly, unbalanced, badPrice, badQty, badTax, excessive, new FormData()]) assert.throws(() => documentItemsFromFormData(form));
  assert.throws(() => documentItemsSchema.parse([{ description: "A", quantity: Infinity, unitPrice: 1, taxRate: 0 }]));
});

test("billing can edit project basics but cannot edit finances or access broader project permissions", () => {
  const data = fixture();
  const before = structuredClone(data.projects[0]); const invoice = structuredClone(data.issuedInvoices[0]);
  data.clients.push({ ...data.clients[0], id: "second", companyName: "Second" });
  const result = updateProjectBasics(data, billing, "JAPAN", { ...before, name: " New project name ", clientId: "second", contractAmount: 0 } as Parameters<typeof updateProjectBasics>[3]);
  assert.equal(result.name, "New project name"); assert.equal(result.clientId, "second");
  assert.notEqual(result.updatedAt, before.updatedAt);
  assert.equal(data.projects[0].contractAmount, before.contractAmount);
  assert.equal(data.projects[0].managerId, before.managerId);
  assert.deepEqual(data.issuedInvoices[0], invoice);
  assert.deepEqual(Object.keys(result).sort(), ["clientId", "id", "name", "updatedAt"]);
  assert.equal(can(billing, "manage:projects"), false);
});

test("project editing checks scope, client company, role, and optimistic concurrency before mutation", () => {
  const data = fixture(); const input = { ...data.projects[0], name: "Changed" };
  const before = JSON.stringify(data);
  assert.throws(() => updateProjectBasics(data, manager, "JAPAN", { ...input, id: "other" }));
  assert.throws(() => updateProjectBasics(data, billing, "CHINA", { ...input, id: "china" }));
  assert.throws(() => updateProjectBasics(data, billing, "JAPAN", { ...input, id: "china" }));
  assert.throws(() => updateProjectBasics(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", input));
  assert.throws(() => updateProjectBasics(data, admin, "JAPAN", { ...input, updatedAt: "stale" }));
  assert.throws(() => updateProjectBasics(data, admin, "JAPAN", { ...input, clientId: "missing" }));
  assert.equal(JSON.stringify(data), before);
});

test("unused client deletion is soft, while used clients, system clients and stale changes are blocked", () => {
  const data = fixture();
  data.clients.push({ ...data.clients[0], id: "unused" }, { ...data.clients[0], id: "cli-japan" });
  assert.throws(() => deleteClient(data, admin, "JAPAN", { id: "client", updatedAt: timestamp }), /使用中/);
  assert.throws(() => deleteClient(data, billing, "JAPAN", { id: "cli-japan", updatedAt: timestamp }), /標準/);
  assert.throws(() => deleteClient(data, billing, "JAPAN", { id: "unused", updatedAt: "stale" }));
  assert.throws(() => deleteClient(data, billing, "CHINA", { id: "unused", updatedAt: timestamp }));
  assert.throws(() => deleteClient(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", { id: "unused", updatedAt: timestamp }));
  deleteClient(data, billing, "JAPAN", { id: "unused", updatedAt: timestamp });
  assert.equal(data.clients.length, 3); assert.ok(data.clients[1].deletedAt);
});

test("client references in invoices and estimates independently prevent deletion", () => {
  const data = fixture(); data.projects = [];
  assert.throws(() => deleteClient(data, admin, "JAPAN", { id: "client", updatedAt: timestamp }), /使用中/);
  data.estimates = [{ ...data.issuedInvoices[0], estimateNumber: "EST-1", validUntil: "2026-10-01", status: "DRAFT", items: [] }];
  data.issuedInvoices = [];
  assert.throws(() => deleteClient(data, admin, "JAPAN", { id: "client", updatedAt: timestamp }), /使用中/);
  data.estimates[0].deletedAt = timestamp;
  deleteClient(data, admin, "JAPAN", { id: "client", updatedAt: timestamp });
  assert.ok(data.clients[0].deletedAt);
});

test("project groups merge months but not identical project names, preserving month mode and row order", () => {
  const data = fixture();
  data.projects[1].name = data.projects[0].name;
  const rows = documentRows(data, admin, "JAPAN").filter((r) => r.kind === "issued");
  rows.push({ ...rows[0], id: "older", date: "2026-08-01", month: "2026-08" });
  rows.push({ ...rows[0], id: "unassigned", projectId: undefined, projectName: "" });
  const before = rows.map((r) => r.id);
  const ordered = orderDocuments(rows, "project");
  assert.equal(ordered.at(-1)?.id, "unassigned");
  const groups = groupDocuments(ordered, "project", 50);
  assert.equal(groups.length, 3);
  assert.equal(groups.find(([key]) => key === "project:japan")?.[1].length, 2);
  assert.deepEqual(groups.flatMap(([, group]) => group.map((r) => r.id)), ordered.map((r) => r.id));
  assert.equal(groupDocuments(ordered, "date-desc", 50).length, 2);
  assert.equal(groupDocuments(ordered, "project", 1)[0][1].length, 1);
  assert.deepEqual(rows.map((r) => r.id), before);
});
