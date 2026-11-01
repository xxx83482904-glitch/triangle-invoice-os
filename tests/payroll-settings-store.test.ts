import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { payrollFixture } from "./payroll-fixture";
import { admin, timestamp } from "./document-fixture";
import { savePayrollSettings } from "../src/lib/payroll-settings";
import type { AppData } from "../src/lib/types";

test("first payroll settings save persists an audited undo patch and failed saves do not write", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "triangle-payroll-settings-test-"));
  process.env.DATA_DIR = dir; process.env.UPLOAD_DIR = path.join(dir, "uploads"); process.env.DATABASE_URL = "";
  for (const key of Object.keys(process.env)) if (key.startsWith("RELEASE_")) delete process.env[key];
  const data = payrollFixture(); data.users = [{ id: "admin", role: "ADMIN", name: "合成管理者", email: "admin@example.invalid", passwordHash: "unused", createdAt: timestamp, updatedAt: timestamp }];
  const file = path.join(dir, "app-data.json"); await writeFile(file, JSON.stringify(data));
  const { mutateData, readData, restoreUndoState } = await import("../src/lib/store");
  const before = await readData(); assert.equal(before.payrollSettings, undefined);
  await mutateData("admin", "SAVE_PAYROLL_SETTINGS", "PayrollSettings", "JAPAN", (current) => savePayrollSettings(current, admin, "JAPAN", { mode: "CUSTOM", categoryIds: ["salary"], updatedAt: "" }));
  const after = JSON.parse(await readFile(file, "utf8")) as AppData;
  const log = after.auditLogs[0], patch = log.beforeStateJson as { changes: Array<{ collection: string; before: unknown }> };
  assert.equal(log.action, "SAVE_PAYROLL_SETTINGS"); assert.equal(log.userId, "admin");
  assert.equal(patch.changes.length, 1); assert.equal(patch.changes[0].collection, "payrollSettings"); assert.equal(patch.changes[0].before, null);
  assert.deepEqual(after.bankTransactions, before.bankTransactions); assert.deepEqual(after.accountingCategories, before.accountingCategories);
  const restored = structuredClone(after); restoreUndoState(restored, log.beforeStateJson); assert.deepEqual(restored.payrollSettings, []);
  const bytes = await readFile(file, "utf8");
  await assert.rejects(() => mutateData("admin", "SAVE_PAYROLL_SETTINGS", "PayrollSettings", "JAPAN", (current) => savePayrollSettings(current, admin, "JAPAN", { mode: "CUSTOM", categoryIds: [], updatedAt: "" })), /更新/);
  assert.equal(await readFile(file, "utf8"), bytes);
});
