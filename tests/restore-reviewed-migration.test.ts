import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyRestore, selectCandidates } from "../scripts/migrations/restore-reviewed-after-sync.mjs";

const script = fileURLToPath(new URL("../scripts/migrations/restore-reviewed-after-sync.mjs", import.meta.url));
type Row = { id: string; reviewed?: boolean; category?: string; updatedAt: string };
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, company: "JAPAN", officeCode: "0000-0001", sourceId: id, bankAccountId: "acc-card", transactionDate: "2026-08-10", amount: 1000, side: "EXPENSE", content: `ROW ${id}`, sourceMemo: "", sourceStatus: "registered", sourceMissing: false,
  categoryId: "cat-supplies", treatment: "NORMAL", classificationSource: "MANUAL", reviewed: false, memo: "", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-10-31T02:34:10.000Z", ...extra });
const data = () => ({ appEdition: "JAPAN", users: [], auditLogs: [],
  bankAccounts: [{ id: "acc-card", company: "JAPAN", name: "テスト法人カード" }, { id: "acc-bank", company: "JAPAN", name: "テスト銀行" }],
  accountingCategories: [{ id: "cat-supplies", company: "JAPAN", name: "消耗品費" }],
  bankTransactions: [row("in-window"), row("other-account", { bankAccountId: "acc-bank" }), row("other-month", { transactionDate: "2026-09-01" }), row("outside-window", { updatedAt: "2026-10-30T00:00:00.000Z" }),
    row("already-reviewed", { reviewed: true }), row("auto", { classificationSource: "AUTO" }), row("held", { bookkeeping: { hold: { reason: "OTHER", question: "?" } } }), row("missing", { sourceMissing: true }),
    row("no-category", { categoryId: undefined }), row("transfer-ok", { categoryId: undefined, treatment: "TRANSFER" })] });
const window = { since: "2026-10-31T02:30:00.000Z", until: "2026-10-31T02:40:00.000Z" };

test("candidate selection matches only manual, unreviewed rows changed inside the sync window", () => {
  assert.deepEqual(selectCandidates(data(), window).map((item: Row) => item.id).sort(), ["in-window", "other-account", "other-month", "transfer-ok"]);
  assert.deepEqual(selectCandidates(data(), { ...window, month: "2026-08", account: "カード" }).map((item: Row) => item.id), ["in-window", "transfer-ok"]);
  assert.equal(selectCandidates(data(), window).find((item: Row) => item.id === "in-window")!.category, "消耗品費");
});

test("cli dry run writes nothing; apply backs up, marks reviewed and logs; restore reverts the file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-restore-reviewed-test-"));
  try {
    const file = path.join(root, "app-data.json");
    await writeFile(file, JSON.stringify(data()));
    const before = await readFile(file, "utf8");
    const dry = execFileSync(process.execPath, [script, "--data", file, "--since", window.since, "--until", window.until, "--month", "2026-08", "--out", path.join(root, "report.json")], { encoding: "utf8" });
    assert.match(dry, /候補 3件/); assert.match(dry, /Dry run/);
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal(JSON.parse(await readFile(path.join(root, "report.json"), "utf8")).candidates.length, 3);
    assert.throws(() => execFileSync(process.execPath, [script, "--data", file, "--since", "bad", "--until", window.until], { encoding: "utf8", stdio: "pipe" }));
    assert.throws(() => execFileSync(process.execPath, [script, "--data", file, "--until", window.until, "--apply"], { encoding: "utf8", stdio: "pipe" }));
    assert.equal(await readFile(file, "utf8"), before);
    const applied = execFileSync(process.execPath, [script, "--data", file, "--since", window.since, "--until", window.until, "--month", "2026-08", "--apply"], { encoding: "utf8" });
    assert.match(applied, /Applied: 3 rows/);
    const after = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(after.bankTransactions.filter((item: Row) => item.reviewed).map((item: Row) => item.id).sort(), ["already-reviewed", "in-window", "other-account", "transfer-ok"]);
    assert.equal(after.auditLogs[0].action, "BANK_REVIEW_RESTORE_MIGRATION"); assert.equal(after.auditLogs[0].afterJson.count, 3);
    const backups = await readdir(path.join(root, "backups"));
    assert.equal(backups.length, 1);
    execFileSync(process.execPath, [script, "--data", file, "--restore", path.join(root, "backups", backups[0])], { encoding: "utf8" });
    assert.equal(await readFile(file, "utf8"), before);
    assert.equal((await readdir(path.join(root, "backups"))).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("applyRestore skips rows that are already reviewed and is idempotent", () => {
  const current = data();
  assert.equal(applyRestore(current, ["in-window", "already-reviewed", "unknown"]), 1);
  assert.equal(applyRestore(current, ["in-window"]), 0);
  assert.equal(current.auditLogs.length, 2);
  assert.ok(current.bankTransactions.find((item: Row) => item.id === "in-window")!.updatedAt > "2026-10-31T02:34:10.000Z");
});
