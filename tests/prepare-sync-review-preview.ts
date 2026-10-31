import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp, admin } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions, saveBankEdits, sourceKey, type ImportedTransaction } from "../src/lib/banking";
import { beginBankSyncRun, finishBankSyncRun, recordBankSyncChanges, recordBankSyncRange } from "../src/lib/bank-sync-runs";
import type { UserRole } from "../src/lib/types";

// Synthetic data for checking the "同期の影響" dialog. Never point this at production data.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-sync-review-preview-"));
  const data = fixture(), office = "0000-0001";
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  mergeBankMasters(data, "JAPAN", office, [
    { id: "bank", name: "テスト銀行", serviceName: "テスト銀行", isManual: false },
    { id: "bank", subId: "branch", name: "テスト銀行 / 普通預金", serviceName: "テスト銀行", isManual: false },
    { id: "card", name: "テスト法人カード", serviceName: "テスト法人カード", isManual: false },
  ], [
    { id: "sales", name: "売上高", group: "INCOME", available: true },
    { id: "travel", name: "旅費交通費", group: "EXPENSE", available: true },
    { id: "supplies", name: "消耗品費", group: "EXPENSE", available: true },
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
  ]);
  const category = (id: string) => sourceKey("JAPAN", office, "category", id);
  const monthEnd = (month: string) => { const [year, mm] = month.split("-").map(Number); return new Date(Date.UTC(year, mm, 0)).toISOString().slice(0, 10); };
  const item = (month: string, i: number, extra: Partial<ImportedTransaction> = {}): ImportedTransaction => ({ id: `${month}-${i}`, date: `${month}-${String((i % 27) + 1).padStart(2, "0")}`, value: (i + 1) * 1100, side: i % 5 === 0 ? "INCOME" : "EXPENSE",
    content: i % 5 === 0 ? `設計料 テスト入金 ${i}` : i % 2 ? `テストストア カード利用 ${i}` : `電車 テスト交通費 ${i}`, memo: null, journalizing_status: "none", connected_account_id: i % 5 === 0 ? "bank" : "card", connected_sub_account_id: i % 5 === 0 ? "branch" : null, ...extra });
  const months = ["2026-08", "2026-09", "2026-10"];
  const items = new Map(months.map((month) => [month, Array.from({ length: month === "2026-08" ? 40 : 12 }, (_, i) => item(month, i))]));
  for (const month of months) mergeBankTransactions(data, "JAPAN", office, items.get(month)!, { start: `${month}-01`, end: monthEnd(month) });
  const august = data.bankTransactions.filter((row) => row.transactionDate.startsWith("2026-08"));
  saveBankEdits(data, admin, "JAPAN", august.map((row) => ({ id: row.id, updatedAt: row.updatedAt, categoryId: row.side === "INCOME" ? category("sales") : row.content.includes("電車") ? category("travel") : category("supplies"), treatment: "NORMAL" as const, reviewed: true, memo: "8月分 確認済み" })));

  // Older run without changes, then a failed run, then the run that mirrors the 2026-10-31 incident.
  const quiet = beginBankSyncRun(data, { runId: "preview-quiet", company: "JAPAN", officeCode: office, actorId: "system-moneyforward", mode: "recent" });
  recordBankSyncRange(quiet, "2026-08-01", "2026-10-31"); finishBankSyncRun(quiet, "SUCCESS");
  const failed = beginBankSyncRun(data, { runId: "preview-failed", company: "JAPAN", officeCode: office, actorId: "admin", mode: "range" });
  recordBankSyncRange(failed, "2026-07-01", "2026-07-31"); finishBankSyncRun(failed, "ERROR", "取得に失敗しました（合成データ）");
  const run = beginBankSyncRun(data, { runId: "preview-incident", company: "JAPAN", officeCode: office, actorId: "system-moneyforward", mode: "recent" });
  recordBankSyncRange(run, "2026-08-01", "2026-10-31");
  const augustItems = items.get("2026-08")!.map((row, i) => ({ ...row, journalizing_status: "registered", value: i >= 30 && i < 36 ? row.value + 10 : row.value })).filter((_, i) => i !== 36 && i !== 37);
  recordBankSyncChanges(run, mergeBankTransactions(data, "JAPAN", office, augustItems, { start: "2026-08-01", end: "2026-08-31" }));
  recordBankSyncChanges(run, mergeBankTransactions(data, "JAPAN", office, [...items.get("2026-10")!, item("2026-10", 12), item("2026-10", 13), item("2026-10", 14)], { start: "2026-10-01", end: "2026-10-31" }));
  finishBankSyncRun(run, "SUCCESS");
  // One cleared row edited after the sync so the dialog shows an unrestorable example.
  const edited = data.bankTransactions.find((row) => row.sourceId === "2026-08-30")!;
  saveBankEdits(data, admin, "JAPAN", [{ id: edited.id, updatedAt: edited.updatedAt, categoryId: category("fees"), treatment: "NORMAL", reviewed: false, memo: "同期後に手で直した" }]);

  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`rows=${data.bankTransactions.length} reviewed=${data.bankTransactions.filter((row) => row.reviewed).length} runs=${data.bankSyncRuns?.length} reviewCleared=${run.reviewCleared} metaOnly=${run.metaOnly} missing=${run.missing} added=${run.added}`);
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
