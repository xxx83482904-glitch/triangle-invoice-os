#!/usr/bin/env node
// Lists (and, only with --apply, restores) bank rows whose "reviewed" flag was cleared by a Money Forward sync
// that changed nothing but the journalizing status. Dry run is the default and never writes.
//
//   node scripts/migrations/restore-reviewed-after-sync.mjs --data data/app-data.json --since 2026-10-31T02:30:00Z --until 2026-10-31T02:40:00Z [--month 2026-08] [--account カード] [--out report.json]
//   node scripts/migrations/restore-reviewed-after-sync.mjs --data data/app-data.json --since ... --until ... --apply
//   node scripts/migrations/restore-reviewed-after-sync.mjs --data data/app-data.json --restore data/backups/<timestamp>-restore-reviewed-after-sync.json
//
// Candidate rows: company JAPAN, classificationSource MANUAL, reviewed false, not missing, not on hold, with a category,
// split or non-normal treatment, whose updatedAt falls inside the sync window. Review the printed list before applying.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const migrationId = "restore-reviewed-after-sync-2026-10-31-v1";

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--apply") { args.apply = true; continue; }
    if (!key.startsWith("--")) throw new Error(`Unknown argument: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value; i++;
  }
  return args;
}

const isoOrThrow = (value, name) => {
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${name} must be an ISO-8601 timestamp (example: 2026-10-31T02:34:00+00:00)`);
  return new Date(value).toISOString();
};
const stamp = (previous) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();

export function selectCandidates(data, options) {
  const accounts = new Map((data.bankAccounts || []).map((row) => [row.id, row]));
  const categories = new Map((data.accountingCategories || []).map((row) => [row.id, row.name]));
  return (data.bankTransactions || []).filter((row) => {
    if (row.company !== "JAPAN" || row.classificationSource !== "MANUAL" || row.reviewed || row.sourceMissing || row.bookkeeping?.hold) return false;
    if (row.treatment === "NORMAL" && !row.categoryId && !row.bookkeeping?.splits?.length) return false;
    if (row.updatedAt < options.since || row.updatedAt > options.until) return false;
    if (options.month && !row.transactionDate.startsWith(options.month)) return false;
    if (options.account && !(accounts.get(row.bankAccountId)?.name || "").includes(options.account)) return false;
    return true;
  }).map((row) => ({
    id: row.id, transactionDate: row.transactionDate, account: accounts.get(row.bankAccountId)?.name || row.bankAccountId, side: row.side, amount: row.amount, content: row.content,
    category: row.bookkeeping?.splits?.length ? `分割 ${row.bookkeeping.splits.length}科目` : categories.get(row.categoryId) || (row.treatment !== "NORMAL" ? row.treatment : "科目なし"),
    sourceStatus: row.sourceStatus, memo: row.memo, updatedAt: row.updatedAt,
  }));
}

export function applyRestore(data, ids, now = new Date().toISOString()) {
  const wanted = new Set(ids);
  let count = 0;
  for (const row of data.bankTransactions) {
    if (!wanted.has(row.id) || row.reviewed) continue;
    row.reviewed = true; row.updatedAt = stamp(row.updatedAt); count++;
  }
  data.auditLogs ||= [];
  data.auditLogs.unshift({ id: randomUUID(), userId: `migration:${migrationId}`, action: "BANK_REVIEW_RESTORE_MIGRATION", targetType: "BankTransaction", targetId: "batch",
    afterJson: { migrationId, count, ids: [...wanted] }, createdAt: now });
  return count;
}

function readJson(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.appEdition !== "JAPAN") throw new Error(`${file} is not a Japan data file (appEdition=${data.appEdition}). Refusing to touch it.`);
  if (!Array.isArray(data.bankTransactions)) throw new Error(`${file} has no bankTransactions collection`);
  return data;
}

function writeJsonAtomically(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}

function backup(file, label) {
  const dir = path.join(path.dirname(file), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.json`);
  fs.copyFileSync(file, target);
  return target;
}

function printTable(rows) {
  const fmt = (row) => [row.transactionDate, row.account, row.side === "INCOME" ? "入金" : "出金", String(row.amount).padStart(10), row.category, row.sourceStatus, row.content].join("\t");
  console.log(["取引日", "口座", "入出金", "金額", "科目", "連携元状態", "摘要"].join("\t"));
  for (const row of rows) console.log(fmt(row));
  const byAccount = new Map(), byMonth = new Map();
  for (const row of rows) { byAccount.set(row.account, (byAccount.get(row.account) || 0) + 1); byMonth.set(row.transactionDate.slice(0, 7), (byMonth.get(row.transactionDate.slice(0, 7)) || 0) + 1); }
  console.log(`\n候補 ${rows.length}件`);
  for (const [account, count] of byAccount) console.log(`  口座 ${account}: ${count}件`);
  for (const [month, count] of [...byMonth].sort()) console.log(`  月 ${month}: ${count}件`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.data) throw new Error("--data <app-data.json> is required");
  const file = path.resolve(args.data);
  if (args.restore) {
    const source = path.resolve(args.restore);
    readJson(source);
    const saved = backup(file, "before-restore");
    fs.copyFileSync(source, file);
    console.log(`Restored ${file} from ${source}. Previous file kept at ${saved}.`);
    return;
  }
  const since = isoOrThrow(args.since, "--since"), until = isoOrThrow(args.until, "--until");
  if (since > until) throw new Error("--since must be before --until");
  const data = readJson(file);
  const candidates = selectCandidates(data, { since, until, month: args.month, account: args.account });
  printTable(candidates);
  if (args.out) { fs.writeFileSync(path.resolve(args.out), JSON.stringify({ migrationId, file, since, until, month: args.month, account: args.account, generatedAt: new Date().toISOString(), candidates }, null, 2)); console.log(`Report written to ${path.resolve(args.out)}`); }
  if (!args.apply) { console.log("\nDry run. Nothing was written. Re-run with --apply after confirming the list."); return; }
  if (!candidates.length) { console.log("No candidates. Nothing to apply."); return; }
  const saved = backup(file, "restore-reviewed-after-sync");
  const count = applyRestore(data, candidates.map((row) => row.id));
  writeJsonAtomically(file, data);
  console.log(`\nApplied: ${count} rows marked reviewed. Backup: ${saved}`);
  console.log(`Undo: node scripts/migrations/restore-reviewed-after-sync.mjs --data ${file} --restore ${saved}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
