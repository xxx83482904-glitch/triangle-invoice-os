import test from "node:test";
import assert from "node:assert/strict";
import { documentItemsFromFormData, documentItemsSchema, documentItemTotals } from "../src/lib/document-items";
import { deleteClient, saveClient, updateProjectBasics } from "../src/lib/partner-project-edits";
import { recipientName, splitBillingProjectName } from "../src/lib/billing-project-name";
import { billingProjectGroups, consolidateBillingProject } from "../src/lib/billing-project-cleanup";
import { groupDocuments, orderDocuments } from "../src/lib/document-order";
import { documentRows } from "../src/lib/documents";
import { can } from "../src/lib/rbac";
import { fixture, admin, manager, timestamp } from "./document-fixture";

const billing = { id: "billing", role: "BILLING_EDITOR" as const };

test("installment names are separate from project and client identities", () => {
  for (const prefix of ["横浜吉野町ホテルステイ", "南大塚駅前ホテルステイ"]) {
    for (const suffix of ["設計初回請求書", "設計二回目回請求書", "設計三回目請求書", "第２回請求", "一回目請求書"]) {
      const result = splitBillingProjectName(`${prefix} ${suffix}`);
      assert.equal(result.projectName, prefix); assert.equal(result.billingLabel, suffix.normalize("NFKC"));
    }
  }
  for (const name of ["初回", "２回目", "設計二回目回請求書 / PD終了請求分"]) {
    assert.equal(splitBillingProjectName(name).projectName, ""); assert.equal(recipientName(name), "");
  }
  for (const name of ["第2工芸株式会社", "三回堂株式会社", "Studio 1", "第2ビル設計", "KIRIN GROUP AWARD 2025"]) {
    assert.equal(splitBillingProjectName(name).projectName, name); assert.equal(recipientName(name), name);
  }
});

test("client create and edit preserve IDs, relationships, company, order and creation history", () => {
  const data = fixture();
  const created = saveClient(data, billing, "JAPAN", { companyName: " New client ", contactName: "担当者", email: "client@example.invalid", address: "東京都" });
  assert.equal(created.companyName, "New client"); assert.equal(created.company, "JAPAN");
  const before = structuredClone(data.clients[0]); const docs = structuredClone(data.issuedInvoices);
  const result = saveClient(data, billing, "JAPAN", { ...before, companyName: "Renamed client", address: "New address", company: "CHINA" } as Parameters<typeof saveClient>[3]);
  assert.equal(result.id, before.id); assert.equal(result.createdAt, before.createdAt); assert.equal(result.company, "JAPAN");
  assert.notEqual(result.updatedAt, before.updatedAt); assert.equal(result.address, "New address");
  assert.deepEqual(data.issuedInvoices, docs); assert.equal(data.projects[0].clientId, before.id);
});

test("client writes reject duplicates, billing descriptions, missing targets, cross-scope edits and stale edits atomically", () => {
  const data = fixture(); const before = JSON.stringify(data); const current = data.clients[0];
  for (const name of ["TEST CUSTOMER", "Ｔｅｓｔ ｃｕｓｔｏｍｅｒ", "一回目", "第２回請求書", "設計二回目回請求書 / PD終了請求分", ""]) {
    assert.throws(() => saveClient(data, billing, "JAPAN", { companyName: name }));
  }
  assert.throws(() => saveClient(data, billing, "CHINA", current));
  assert.throws(() => saveClient(data, billing, "JAPAN", { ...current, id: "missing" }));
  assert.throws(() => saveClient(data, billing, "JAPAN", { ...current, updatedAt: "stale" }));
  assert.throws(() => saveClient(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", current));
  assert.throws(() => saveClient(data, billing, "JAPAN", { companyName: "Valid", email: "not an email" }));
  assert.equal(JSON.stringify(data), before);
});

function roundsFixture() {
  const data = fixture();
  for (const [index, label] of ["初回", "二回目回", "三回目"].entries()) {
    const id = `round-${index}`;
    data.projects.push({ id, name: `横浜吉野町ホテルステイ 設計${label}請求書`, clientId: "client", company: "JAPAN", managerId: "manager", memberIds: [],
      status: "PLANNING", contractAmount: 0, billingCount: 1, memo: "発行請求書OCRから自動作成。案件名・請求先・契約情報要確認。", createdAt: timestamp, updatedAt: timestamp });
    data.issuedInvoices.push({ ...data.issuedInvoices[0], id: `round-invoice-${index}`, invoiceNumber: `ROUND-${index}`, projectId: id, status: "PAID", paidAt: "2026-09-15" });
  }
  data.payments.push({ id: "payment-round", issuedInvoiceId: "round-invoice-0", type: "INCOME", amount: 12000, paymentDate: "2026-09-15", createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
  return data;
}

test("confirmed cleanup consolidates only project IDs and retains installments, money, recipients, originals and payments", () => {
  const data = roundsFixture(); const previous = structuredClone(data);
  const groups = billingProjectGroups(data, billing, "JAPAN");
  assert.equal(groups.length, 1); assert.equal(groups[0].names.length, 3); assert.equal(groups[0].documentCount, 3);
  assert.deepEqual(data, previous, "listing candidates is read only");
  const result = consolidateBillingProject(data, billing, "JAPAN", groups[0]);
  assert.equal(result.name, "横浜吉野町ホテルステイ");
  assert.equal(data.projects.filter((p) => p.id.startsWith("round-") && !p.deletedAt).length, 1);
  for (const i of data.issuedInvoices.filter((i) => i.id.startsWith("round-"))) {
    const old = previous.issuedInvoices.find((p) => p.id === i.id)!;
    assert.equal(i.projectId, result.id); assert.ok(i.billingLabel);
    assert.deepEqual({ ...i, projectId: old.projectId, updatedAt: old.updatedAt, billingLabel: undefined }, { ...old, billingLabel: undefined });
  }
  assert.deepEqual(data.payments, previous.payments); assert.deepEqual(data.clients, previous.clients);
  assert.equal(billingProjectGroups(data, billing, "JAPAN").length, 0);
  assert.throws(() => consolidateBillingProject(data, billing, "JAPAN", groups[0]));
});

test("cleanup does not cross client, company or access boundaries, and never retires contracts or manually maintained projects", () => {
  for (const change of [
    (d: ReturnType<typeof fixture>) => { d.projects.at(-1)!.contractAmount = 100; },
    (d: ReturnType<typeof fixture>) => { d.projects.at(-1)!.memo = "Important job"; },
    (d: ReturnType<typeof fixture>) => { d.projects.at(-1)!.managerId = "other"; },
    (d: ReturnType<typeof fixture>) => { d.projects.at(-1)!.contractFileUrl = "/api/files/contract.pdf"; },
  ]) {
    const data = roundsFixture(); change(data);
    assert.equal(billingProjectGroups(data, billing, "JAPAN").length, 0);
  }
  const data = roundsFixture();
  data.clients.push({ ...data.clients[0], id: "another", companyName: "Other client" });
  data.projects.push({ ...data.projects.at(-1)!, id: "foreign-client", clientId: "another" });
  const groups = billingProjectGroups(data, billing, "JAPAN"); assert.equal(groups.length, 2);
  consolidateBillingProject(data, billing, "JAPAN", groups.find((g) => g.clientName === "Test customer")!);
  assert.equal(data.projects.at(-1)!.name, "横浜吉野町ホテルステイ 設計三回目請求書");
  assert.equal(billingProjectGroups(data, billing, "CHINA").length, 0);
  assert.equal(billingProjectGroups(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN").length, 0);
});

test("cleanup rejects stale invoices and concurrent membership changes without partial mutation", () => {
  const data = roundsFixture(); const [group] = billingProjectGroups(data, billing, "JAPAN");
  data.issuedInvoices.at(-1)!.total += 10;
  const before = JSON.stringify(data);
  assert.throws(() => consolidateBillingProject(data, billing, "JAPAN", group));
  assert.throws(() => consolidateBillingProject(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", group));
  assert.throws(() => consolidateBillingProject(data, billing, "CHINA", group));
  assert.equal(JSON.stringify(data), before);
});
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
