import assert from "node:assert/strict";
import test from "node:test";
import { saveBankAutosaveEdits } from "../src/lib/bank-autosave-server";
import { admin, fixture, manager, timestamp } from "./document-fixture";
import type { BankEdit, BankTransaction } from "../src/lib/banking-types";

const row = (id = "a", patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: "bank", transactionDate: "2026-11-01", side: "EXPENSE", amount: 1000, content: `合成明細 ${id}`, memo: "", sourceMemo: "", sourceStatus: "", sourceMissing: false, treatment: "NORMAL", reviewed: false, categoryId: "expense", classificationSource: "MANUAL", createdAt: timestamp, updatedAt: timestamp, ...patch });
function setup(rows: BankTransaction[] = [row()]) {
  const data = fixture(); data.bankTransactions = rows;
  data.accountingCategories = [{ id: "expense", company: "JAPAN", name: "合成経費", group: "EXPENSE", available: true, createdAt: timestamp, updatedAt: timestamp }];
  return data;
}
const edit = (id: string, patch: Partial<BankEdit>, updatedAt = timestamp) => ({ id, updatedAt, patch });

test("autosave keeps every server guard while a held row does not block valid rows", () => {
  const data = setup([row("held", { bookkeeping: { hold: { reason: "MISSING_DOCUMENT", question: "要書類" } } }), row("ok")]);
  const held = structuredClone(data.bankTransactions[0]);
  const result = saveBankAutosaveEdits(data, admin, "JAPAN", [edit("held", { reviewed: true }), edit("ok", { reviewed: true })], "audit-1");
  assert.deepEqual(data.bankTransactions[0], held); assert.equal(data.bankTransactions[1].reviewed, true);
  assert.deepEqual(result.rows.map((row) => row.id), ["ok"]); assert.equal(result.auditLogId, "audit-1");
  assert.equal(result.failures[0].kind, "failed"); assert.match(result.failures[0].error, /保留/);
  assert.notEqual(result.rows[0].updatedAt, timestamp); assert.equal(Boolean(result.rows[0].predictionPending), false);
});

test("version conflicts, split categories and linked treatments fail independently without overwriting", () => {
  const data = setup([row("stale", { updatedAt: "2026-11-01T00:00:01.000Z" }), row("split", { categoryId: undefined, bookkeeping: { splits: [{ id: "part", categoryId: "expense", amount: 1000, memo: "" }] } }), row("linked"), row("ok")]);
  data.bankTransfers = [{ id: "transfer", company: "JAPAN", createdAt: timestamp, updatedAt: timestamp, outgoingId: "linked", incomingId: "other", outgoingEvidence: "", incomingEvidence: "", previous: [], confirmedById: "admin" }];
  const before = structuredClone(data.bankTransactions);
  const result = saveBankAutosaveEdits(data, admin, "JAPAN", [edit("stale", { memo: "上書きしない" }), edit("split", { categoryId: "expense" }), edit("linked", { treatment: "EXCLUDED" }), edit("ok", { memo: "保存する" })], "audit");
  assert.deepEqual(result.failures.map((failure) => failure.kind), ["conflict", "failed", "failed"]);
  assert.match(result.failures[1].error, /分割/); assert.match(result.failures[2].error, /照合/);
  assert.deepEqual(data.bankTransactions.slice(0, 3), before.slice(0, 3)); assert.equal(result.rows[0].memo, "保存する");
});

test("memo-only autosave never adopts displayed predictions or changes persisted treatment", () => {
  const data = setup([row("a", { categoryId: undefined, treatment: "EXCLUDED", classificationSource: "UNASSIGNED" })]);
  const result = saveBankAutosaveEdits(data, admin, "JAPAN", [edit("a", { memo: "メモだけ" })], "memo");
  assert.equal(result.rows[0].categoryId, undefined); assert.equal(result.rows[0].treatment, "EXCLUDED"); assert.equal(result.rows[0].memo, "メモだけ");
});

test("candidate adoption saves only explicit fields and guessed review still requires acknowledgement", () => {
  const data = setup([row("a", { categoryId: undefined, classificationSource: "UNASSIGNED" })]);
  const patch = { categoryId: "expense", classificationConfidence: "GUESS" as const, classificationReason: "合成推測", reviewed: true };
  const rejected = saveBankAutosaveEdits(data, admin, "JAPAN", [edit("a", patch)], "rejected");
  assert.equal(rejected.auditLogId, undefined); assert.match(rejected.failures[0].error, /推測/);
  const result = saveBankAutosaveEdits(data, admin, "JAPAN", [edit("a", { ...patch, acknowledgeGuess: true })], "adopted");
  assert.equal(result.rows[0].reviewed, true); assert.equal(result.rows[0].categoryId, "expense");
  assert.equal(result.auditLogId, "adopted");
});

test("invalid fields fail per row, including memo length, unavailable categories and foreign offices", () => {
  const data = setup([row("long"), row("missing"), row("foreign"), row("ok")]);
  data.accountingCategories.push({ ...data.accountingCategories[0], id: "foreign-category", officeCode: "other-office" });
  const result = saveBankAutosaveEdits(data, admin, "JAPAN", [edit("long", { memo: "a".repeat(2001) }), edit("missing", { categoryId: "missing" }), edit("foreign", { categoryId: "foreign-category" }), edit("ok", { subCategoryId: undefined, memo: "保存" })], "audit");
  assert.deepEqual(result.failures.map((failure) => failure.id), ["long", "missing", "foreign"]);
  assert.deepEqual(result.rows.map((row) => row.id), ["ok"]);
});

test("autosave rejects unauthorized access, duplicate IDs and batches over 100 before touching rows", () => {
  const data = setup(), before = structuredClone(data);
  assert.throws(() => saveBankAutosaveEdits(data, manager, "JAPAN", [edit("a", { memo: "bad" })], "bad"), /権限/);
  assert.throws(() => saveBankAutosaveEdits(data, admin, "CHINA", [edit("a", { memo: "bad" })], "bad"));
  assert.throws(() => saveBankAutosaveEdits(data, admin, "JAPAN", [edit("a", {}), edit("a", {})], "bad"), /重複/);
  assert.throws(() => saveBankAutosaveEdits(data, admin, "JAPAN", Array.from({ length: 101 }, (_, i) => edit(String(i), {})), "bad"));
  assert.deepEqual(data, before);
});
