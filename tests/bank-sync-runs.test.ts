import assert from "node:assert/strict";
import test from "node:test";
import { fixture, admin } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions, saveBankEdits, sourceKey, type ImportedTransaction } from "../src/lib/banking";
import { BANK_SYNC_CHANGE_LIMIT, BANK_SYNC_RUN_LIMIT, bankSyncRunViews, beginBankSyncRun, finishBankSyncRun, pendingBankSyncReviewCount, recordBankSyncChanges, recordBankSyncRange, restoreBankSyncReview } from "../src/lib/bank-sync-runs";
import type { AppData } from "../src/lib/types";
import type { BankSyncRun } from "../src/lib/banking-types";

const office = "0000-0001", range = { start: "2026-09-01", end: "2026-09-30" };
const catId = sourceKey("JAPAN", office, "category", "sales");
const source = (id: string, extra: Partial<ImportedTransaction> = {}): ImportedTransaction => ({ id, connected_account_id: "bank", connected_sub_account_id: null, date: "2026-09-15", value: 12000, side: "EXPENSE", content: `PAYMENT ${id}`, memo: null, journalizing_status: "none", ...extra });
function masters(data: AppData) {
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "Test bank", serviceName: "Test bank", isManual: false }], [{ id: "sales", name: "Sales", group: "INCOME", available: true }, { id: "travel", name: "Travel", group: "EXPENSE", available: true }]);
}
function setup(count = 3) {
  const data = fixture(); masters(data);
  mergeBankTransactions(data, "JAPAN", office, Array.from({ length: count }, (_, i) => source(`t${i + 1}`)), range);
  saveBankEdits(data, admin, "JAPAN", data.bankTransactions.map((row) => ({ id: row.id, updatedAt: row.updatedAt, categoryId: catId, treatment: "NORMAL" as const, reviewed: true, memo: "reviewed" })));
  return data;
}
function sync(data: AppData, items: ImportedTransaction[], mode: BankSyncRun["mode"] = "recent") {
  const run = beginBankSyncRun(data, { runId: `run-${(data.bankSyncRuns || []).length + 1}-${Math.random().toString(36).slice(2, 8)}`, company: "JAPAN", officeCode: office, actorId: admin.id, mode });
  recordBankSyncRange(run, range.start, range.end);
  recordBankSyncChanges(run, mergeBankTransactions(data, "JAPAN", office, items, range));
  finishBankSyncRun(run, "SUCCESS");
  return run;
}

test("sync runs count additions, identity changes, informational changes and missing rows, and keep bounded history", () => {
  const data = setup();
  const items = [source("t1", { journalizing_status: "registered" }), source("t2", { value: 500 }), source("t4")];
  const run = sync(data, items);
  assert.deepEqual([run.added, run.changed, run.metaOnly, run.missing, run.restored, run.reviewCleared, run.status, run.rangeStart], [1, 1, 1, 1, 0, 2, "SUCCESS", "2026-09-01"]);
  assert.equal(data.bankTransactions.filter((row) => row.reviewed).length, 1);
  assert.equal(pendingBankSyncReviewCount(data, "JAPAN"), 1);
  const views = bankSyncRunViews(data, admin, "JAPAN");
  assert.equal(views.length, 1); assert.equal(views[0].pending, 1); assert.equal(views[0].actor, data.users.find((row) => row.id === admin.id)?.name || "利用者");
  assert.deepEqual(views[0].changes.map((change) => change.kind), ["CHANGED", "MISSING", "META"]);
  assert.deepEqual(views[0].changes[0].fields, [{ label: "金額", before: "12,000円", after: "500円" }]);
  assert.equal(views[0].changes[1].blocked, "元明細がありません");
  assert.equal(views[0].changes[2].fields[0].after, "登録済み");
  for (let i = 0; i < BANK_SYNC_RUN_LIMIT + 2; i++) sync(data, items);
  assert.equal(data.bankSyncRuns!.filter((row) => row.company === "JAPAN").length, BANK_SYNC_RUN_LIMIT);
  assert.ok(!data.bankSyncRuns!.some((row) => row.runId === run.runId));
  assert.equal(pendingBankSyncReviewCount(data, "JAPAN"), 0);
});

test("review clearances survive truncation of large change lists", () => {
  const data = fixture(); masters(data);
  const items = Array.from({ length: BANK_SYNC_CHANGE_LIMIT + 50 }, (_, i) => source(`t${i}`));
  mergeBankTransactions(data, "JAPAN", office, items, range);
  const reviewed = data.bankTransactions.slice(-20);
  saveBankEdits(data, admin, "JAPAN", reviewed.map((row) => ({ id: row.id, updatedAt: row.updatedAt, categoryId: catId, treatment: "NORMAL" as const, reviewed: true, memo: "" })));
  const changed = new Set(reviewed.map((row) => row.sourceId));
  const run = sync(data, items.map((item) => ({ ...item, journalizing_status: "registered", value: changed.has(item.id) ? 1 : item.value })));
  assert.equal(run.truncated, true); assert.equal(run.changes.length, BANK_SYNC_CHANGE_LIMIT);
  assert.deepEqual([run.changed, run.metaOnly, run.reviewCleared], [20, BANK_SYNC_CHANGE_LIMIT + 30, 20]);
  assert.ok(run.changes.slice(0, 20).every((change) => change.reviewCleared));
  assert.equal(pendingBankSyncReviewCount(data, "JAPAN"), 20);
});

test("restore returns review and categories only for rows untouched since the sync", () => {
  const data = setup(4);
  const run = sync(data, [source("t1", { value: 100 }), source("t2", { value: 200 }), source("t3", { value: 300 }), source("t4", { value: 400 })]);
  assert.equal(run.reviewCleared, 4);
  const rows = data.bankTransactions;
  saveBankEdits(data, admin, "JAPAN", [{ id: rows[1].id, updatedAt: rows[1].updatedAt, categoryId: catId, treatment: "NORMAL", reviewed: false, memo: "edited later" }]);
  rows[2].bookkeeping = { hold: { reason: "OTHER", question: "check" } };
  data.bankTransfers = [{ id: "transfer", company: "JAPAN", outgoingId: rows[3].id, incomingId: "other", outgoingEvidence: "", incomingEvidence: "", previous: [], confirmedById: admin.id, createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T00:00:00.000Z" }];
  assert.throws(() => restoreBankSyncReview(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", { runId: run.runId, transactionIds: [rows[0].id] }), /権限/);
  assert.throws(() => restoreBankSyncReview(data, admin, "CHINA", { runId: run.runId, transactionIds: [rows[0].id] }), /日本版/);
  assert.throws(() => restoreBankSyncReview(data, admin, "JAPAN", { runId: run.runId, transactionIds: ["unknown"] }), /同期の記録に含まれない/);
  assert.throws(() => restoreBankSyncReview(data, admin, "JAPAN", { runId: "missing", transactionIds: [rows[0].id] }), /同期の記録が見つかりません/);
  assert.throws(() => bankSyncRunViews(data, { id: "designer", role: "DESIGNER" }, "JAPAN"), /権限/);
  const snapshot = JSON.stringify(rows.slice(1));
  const result = restoreBankSyncReview(data, admin, "JAPAN", { runId: run.runId, transactionIds: rows.map((row) => row.id) });
  assert.equal(result.restored, 1);
  assert.deepEqual(result.skipped.map((row) => row.reason), ["同期後に編集されています", "保留中の明細です", "資金移動と照合済みです。先に資金移動の照合を確認してください"]);
  assert.equal(JSON.stringify(rows.slice(1)), snapshot);
  assert.deepEqual([rows[0].reviewed, rows[0].categoryId, rows[0].amount, rows[0].classificationSource, rows[0].memo], [true, catId, 100, "MANUAL", "reviewed"]);
  assert.ok(run.changes.find((change) => change.transactionId === rows[0].id)!.restoredAt);
  const views = bankSyncRunViews(data, admin, "JAPAN");
  assert.equal(views[0].pending, 0);
  assert.equal(views[0].changes.find((change) => change.transactionId === rows[0].id)!.blocked, "復元済み");
  assert.equal(views[0].changes.find((change) => change.transactionId === rows[1].id)!.blocked, "同期後に編集されています");
  assert.deepEqual(restoreBankSyncReview(data, admin, "JAPAN", { runId: run.runId, transactionIds: [rows[0].id] }), { restored: 0, skipped: [{ id: rows[0].id, reason: "復元済み" }] });
});

test("rows whose category disappeared or that vanished cannot be restored", () => {
  const data = setup(2);
  const run = sync(data, [source("t1", { value: 1 })]);
  assert.deepEqual(run.changes.map((change) => change.kind), ["CHANGED", "MISSING"]);
  const category = data.accountingCategories.find((row) => row.id === catId)!; category.available = false;
  const result = restoreBankSyncReview(data, admin, "JAPAN", { runId: run.runId, transactionIds: data.bankTransactions.map((row) => row.id) });
  assert.equal(result.restored, 0);
  assert.deepEqual(result.skipped.map((row) => row.reason).sort(), ["元明細がありません", "勘定科目が無効になっています"]);
});
