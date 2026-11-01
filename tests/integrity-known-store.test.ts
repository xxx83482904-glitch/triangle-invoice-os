import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { integrityKnownFixture } from "./integrity-known-fixture";
import { admin } from "./document-fixture";
import { acknowledgeIntegrity, revokeIntegrityAcknowledgement } from "../src/lib/integrity-acknowledgements";
import { integrityReport } from "../src/lib/integrity";
import type { AppData } from "../src/lib/types";

test("acknowledgements and reasoned revocations persist audits, first-write undo, and no financial changes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "triangle-integrity-known-store-"));
  process.env.DATA_DIR = dir; process.env.UPLOAD_DIR = path.join(dir, "uploads"); process.env.DATABASE_URL = "";
  for (const key of Object.keys(process.env)) if (key.startsWith("RELEASE_")) delete process.env[key];
  const file = path.join(dir, "app-data.json"); await writeFile(file, JSON.stringify(integrityKnownFixture()));
  const { readData, mutateData, restoreUndoState } = await import("../src/lib/store");
  const before = await readData(), issues = integrityReport(before, "JAPAN").issues.filter((row) => row.kind === "reviewed_guess");
  await mutateData("admin", "ACKNOWLEDGE_INTEGRITY", "IntegrityAcknowledgement", "JAPAN", (data) => acknowledgeIntegrity(data, admin, "JAPAN", { mode: "KIND", kind: "reviewed_guess", reason: "合成確認", targets: issues.map(({ id, fingerprint }) => ({ id, fingerprint })) }));
  const read = async () => JSON.parse(await readFile(file, "utf8")) as AppData;
  const saved = await read(), log = saved.auditLogs[0], patch = log.beforeStateJson as { changes: Array<{ collection: string; before: unknown }> };
  assert.equal(log.userId, "admin"); assert.equal(log.action, "ACKNOWLEDGE_INTEGRITY"); assert.equal(patch.changes.length, 3);
  assert.ok(patch.changes.every((change) => change.collection === "integrityAcknowledgements" && change.before === null));
  const undo = structuredClone(saved); restoreUndoState(undo, log.beforeStateJson); assert.deepEqual(undo.integrityAcknowledgements, []); assert.equal(integrityReport(undo, "JAPAN").knownTotal, 0);
  const row = saved.integrityAcknowledgements![0], value = { id: row.id, updatedAt: row.updatedAt, reason: "合成取消理由" };
  await mutateData("admin", "REVOKE_INTEGRITY_ACKNOWLEDGEMENT", "IntegrityAcknowledgement", row.id, (data) => revokeIntegrityAcknowledgement(data, admin, "JAPAN", value));
  const revoked = await read(), revokeLog = revoked.auditLogs[0]; assert.equal(revokeLog.action, "REVOKE_INTEGRITY_ACKNOWLEDGEMENT");
  assert.equal(revoked.integrityAcknowledgements![0].revokeReason, value.reason); assert.equal(integrityReport(revoked, "JAPAN").knownTotal, 2);
  const restored = structuredClone(revoked); restoreUndoState(restored, revokeLog.beforeStateJson); assert.equal(integrityReport(restored, "JAPAN").knownTotal, 3);
  for (const current of [saved, revoked]) { const copy = structuredClone(current); delete copy.integrityAcknowledgements; copy.auditLogs = before.auditLogs; assert.deepEqual(copy, before); }
  const bytes = await readFile(file, "utf8");
  await assert.rejects(() => mutateData("admin", "REVOKE_INTEGRITY_ACKNOWLEDGEMENT", "IntegrityAcknowledgement", row.id, (data) => revokeIntegrityAcknowledgement(data, admin, "JAPAN", value)), /更新/);
  assert.equal(await readFile(file, "utf8"), bytes);
});
