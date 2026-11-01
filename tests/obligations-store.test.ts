import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { obligationsFixture } from "./obligations-fixture";
import { admin, timestamp } from "./document-fixture";
import { applyObligationMutation } from "../src/lib/obligation-edits";
import { taxObligations } from "../src/lib/tax-obligations";
import type { AppData } from "../src/lib/types";

test("first writes to absent obligation collections persist audits and reversible patches without changing sources", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "triangle-obligations-store-test-"));
  process.env.DATA_DIR = dir; process.env.UPLOAD_DIR = path.join(dir, "uploads"); process.env.DATABASE_URL = "";
  for (const key of Object.keys(process.env)) if (key.startsWith("RELEASE_")) delete process.env[key];
  const data = obligationsFixture(); data.users = [{ id: "admin", role: "ADMIN", name: "合成管理者", email: "admin@example.invalid", passwordHash: "unused", createdAt: timestamp, updatedAt: timestamp }];
  await writeFile(path.join(dir, "app-data.json"), JSON.stringify(data));
  const { mutateData, readData, restoreUndoState } = await import("../src/lib/store");
  const before = await readData(); assert.equal(before.manualObligations, undefined); assert.equal(before.obligationExclusions, undefined);
  const target = taxObligations(before, "JAPAN", "2026-11-01").items.find((row) => row.id === "received:tax")!;
  await mutateData("admin", "EXCLUDE_OBLIGATION", "ObligationExclusion", target.id, (current) => applyObligationMutation(current, admin, "JAPAN", { action: "exclude", id: target.id, version: target.version, reason: "合成理由" }, "2026-11-01"));
  await mutateData("admin", "CREATE_MANUAL_OBLIGATION", "ManualObligation", "new", (current) => applyObligationMutation(current, admin, "JAPAN", { action: "create", title: "合成加算金", party: "合成納付先", amount: 3400, dueDate: "", memo: "" }));
  const after = JSON.parse(await readFile(path.join(dir, "app-data.json"), "utf8")) as AppData;
  assert.equal(after.auditLogs.length - before.auditLogs.length, 2);
  for (const [index, collection] of [[0, "manualObligations"], [1, "obligationExclusions"]] as const) {
    const patch = after.auditLogs[index].beforeStateJson as { changes: Array<{ collection: string; before: unknown }> };
    assert.equal(patch.changes.length, 1); assert.equal(patch.changes[0].collection, collection); assert.equal(patch.changes[0].before, null);
  }
  assert.deepEqual(after.receivedInvoices, before.receivedInvoices); assert.deepEqual(after.mailDocuments, before.mailDocuments); assert.deepEqual(after.vendors, before.vendors); assert.deepEqual(after.payments, before.payments);
  const restored = structuredClone(after); for (const log of after.auditLogs.slice(0, 2)) restoreUndoState(restored, log.beforeStateJson);
  assert.deepEqual(restored.manualObligations, []); assert.deepEqual(restored.obligationExclusions, []);
  const bytes = await readFile(path.join(dir, "app-data.json"), "utf8");
  await assert.rejects(() => mutateData("admin", "EXCLUDE_OBLIGATION", "ObligationExclusion", target.id, (current) => applyObligationMutation(current, admin, "JAPAN", { action: "exclude", id: target.id, version: target.version, reason: "重複送信" })), /更新/);
  assert.equal(await readFile(path.join(dir, "app-data.json"), "utf8"), bytes);
});
