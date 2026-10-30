import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { fixture, admin, manager, timestamp } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions } from "../src/lib/banking";
import { bankAuditEntries, bankAuditUndoPatch } from "../src/lib/bank-audit";
import { restoreUndoState } from "../src/lib/store";

function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", "office", [{ id: "bank", name: "Bank", serviceName: "Bank", isManual: false }], []);
  mergeBankTransactions(data, "JAPAN", "office", [{ id: "row", connected_account_id: "bank", date: "2026-10-30", value: 500, side: "EXPENSE", content: "Test", journalizing_status: "none" }], { start: "2026-10-30", end: "2026-10-30" });
  const before = structuredClone(data.bankTransactions[0]);
  data.bankTransactions[0].memo = "Updated";
  const afterHash = createHash("sha256").update(JSON.stringify(data.bankTransactions[0])).digest("hex");
  data.auditLogs.unshift({ id: "log", userId: "admin", createdAt: timestamp, action: "BANK_CLASSIFY", targetType: "BankTransaction", targetId: "JAPAN", beforeStateJson: { format: "triangle-undo-patch-v1", changes: [{ collection: "bankTransactions", id: before.id, index: 0, before, afterHash }] } });
  return data;
}
test("history shows only scoped bank changes and safely restores selected operation", () => {
  const data = setup();
  const entries = bankAuditEntries(data, admin, "JAPAN");
  assert.equal(entries.length, 1); assert.equal(entries[0].blocked, "");
  assert.match(entries[0].rows[0].after, /Updated/);
  restoreUndoState(data, bankAuditUndoPatch(data, admin, "JAPAN", "log").patch);
  assert.equal(data.bankTransactions[0].memo, "");
});
test("later edits and source corrections block targeted undo before changes", () => {
  const data = setup(); data.bankTransactions[0].amount = 700;
  const before = JSON.stringify(data);
  assert.throws(() => bankAuditUndoPatch(data, admin, "JAPAN", "log"), /更新/);
  assert.equal(JSON.stringify(data), before);
});
test("history rejects unauthorized/foreign access and unsafe legacy rollback", () => {
  const data = setup();
  assert.throws(() => bankAuditEntries(data, manager, "JAPAN"), /権限/);
  assert.throws(() => bankAuditEntries(data, admin, "CHINA"));
  const patch = data.auditLogs[0].beforeStateJson as { changes: { afterHash?: string }[] };
  delete patch.changes[0].afterHash;
  assert.match(bankAuditEntries(data, admin, "JAPAN")[0].blocked, /旧履歴/);
  assert.throws(() => bankAuditUndoPatch(data, admin, "JAPAN", "log"), /旧履歴/);
});
test("linked bank movements cannot have their classification independently undone", () => {
  const data = setup();
  data.bankTransfers = [{ id: "transfer", company: "JAPAN", createdAt: timestamp, updatedAt: timestamp, outgoingId: data.bankTransactions[0].id, incomingId: "other", outgoingEvidence: "", incomingEvidence: "", previous: [], confirmedById: "admin" }];
  assert.throws(() => bankAuditUndoPatch(data, admin, "JAPAN", "log"), /照合/);
});

test("undone history stays readable but cannot be undone twice", () => {
  const data = setup(); data.auditLogs[0].undoneAt = timestamp;
  assert.equal(bankAuditEntries(data, admin, "JAPAN")[0].blocked, "取消済み");
  assert.throws(() => bankAuditUndoPatch(data, admin, "JAPAN", "log"), /取消済み/);
});
