import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { admin, fixture, timestamp } from "./document-fixture";
import { saveBankAutosaveEdits } from "../src/lib/bank-autosave-server";
import { bankAuditUndoPatch } from "../src/lib/bank-audit";

test("returned autosave audit IDs identify persisted histories and every chunk can be undone newest first", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "triangle-autosave-store-test-"));
  process.env.DATA_DIR = dir; process.env.UPLOAD_DIR = path.join(dir, "uploads"); process.env.DATABASE_URL = "";
  for (const key of Object.keys(process.env)) if (key.startsWith("RELEASE_")) delete process.env[key];
  const data = fixture();
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = [{ ...admin, name: "合成管理者", email: "test@example.invalid", passwordHash: "unused", createdAt: timestamp, updatedAt: timestamp }];
  data.bankTransactions = Array.from({ length: 102 }, (_, index) => ({ id: String(index), company: "JAPAN", officeCode: "office", sourceId: String(index), bankAccountId: "bank", transactionDate: "2026-11-01", side: "EXPENSE", amount: 1000, content: "合成明細", memo: "", sourceMemo: "", sourceStatus: "", sourceMissing: false, treatment: "EXCLUDED", reviewed: false, classificationSource: "MANUAL", createdAt: timestamp, updatedAt: timestamp }));
  data.bankTransactions[0].bookkeeping = { hold: { reason: "OTHER", question: "保留" } };
  await writeFile(path.join(dir, "app-data.json"), JSON.stringify(data));
  const { mutateData, readData, restoreUndoState } = await import("../src/lib/store");
  const ids: string[] = [];
  for (let offset = 0; offset < data.bankTransactions.length; offset += 100) {
    const edits = data.bankTransactions.slice(offset, offset + 100).map((row) => ({ id: row.id, updatedAt: row.updatedAt, patch: { reviewed: true } }));
    const auditLogId = crypto.randomUUID();
    const result = await mutateData(admin.id, "BANK_CLASSIFY", "BankTransaction", "JAPAN", (current) => saveBankAutosaveEdits(current, admin, "JAPAN", edits, auditLogId), undefined, { auditLogId });
    assert.equal(result.auditLogId, auditLogId); ids.push(result.auditLogId!);
  }
  const persisted = await readData();
  assert.equal(persisted.bankTransactions.filter((row) => row.reviewed).length, 101);
  assert.deepEqual(persisted.auditLogs.slice(0, 2).map((log) => log.id), [...ids].reverse());
  const firstPatch = persisted.auditLogs.find((log) => log.id === ids[0])!.beforeStateJson as { changes: { id: string }[] };
  assert.equal(firstPatch.changes.length, 99); assert.ok(firstPatch.changes.every((change) => change.id !== "0"));
  for (const id of [...ids].reverse()) {
    await mutateData(admin.id, "UNDO_ACTION", "BankTransaction", id, (current) => {
      const { log, patch } = bankAuditUndoPatch(current, admin, "JAPAN", id);
      restoreUndoState(current, patch); log.undoneAt = new Date().toISOString(); return { undoOfAuditLogId: id };
    }, undefined, { undoable: false });
  }
  const restored = await readData();
  assert.equal(restored.bankTransactions.some((row) => row.reviewed), false);
  assert.equal(restored.bankTransactions[0].updatedAt, timestamp);
  assert.ok(restored.bankTransactions.slice(1).every((row) => row.updatedAt !== timestamp));
  assert.throws(() => bankAuditUndoPatch(restored, admin, "JAPAN", ids[0]), /取消済み/);
});
