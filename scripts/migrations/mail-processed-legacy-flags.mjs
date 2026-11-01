#!/usr/bin/env node
// Preserve the pre-P0-2 display only for missing processing flags. Dry run is the default.
//   node scripts/migrations/mail-processed-legacy-flags.mjs --data <app-data.json> [--json] [--out <report.json>]
//   node scripts/migrations/mail-processed-legacy-flags.mjs --data <app-data.json> --apply [--plan <report.json>]
//   node scripts/migrations/mail-processed-legacy-flags.mjs --data <app-data.json> --restore <backup.json>
// Run apply/restore only after approval, with application writers stopped. This CLI does not stop servers.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const migrationId = "mail-processed-legacy-flags-2026-11-01-v1";
const collections = ["mailDocuments", "receivedInvoices"];
const isJapan = (row) => (row.company || "JAPAN") === "JAPAN";
const keyOf = (row) => `${row.collection}:${row.id}`;

function validateData(data) {
  if (data?.appEdition !== "JAPAN") throw new Error("Not a Japan data file. Refusing to change it.");
  for (const name of [...collections, "projects"]) {
    if (!Array.isArray(data[name])) throw new Error(`Missing collection: ${name}`);
    const ids = new Set();
    for (const row of data[name]) {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new Error(`Invalid or duplicate ID in ${name}`);
      ids.add(row.id);
    }
  }
  if (data.auditLogs !== undefined && !Array.isArray(data.auditLogs)) throw new Error("Invalid auditLogs collection");
  return data;
}

export function selectCandidates(data) {
  validateData(data);
  const projects = new Map(data.projects.filter((row) => !row.deletedAt && isJapan(row)).map((row) => [row.id, row]));
  const candidates = [];
  for (const collection of collections) {
    for (const row of data[collection]) {
      if (row.deletedAt || !isJapan(row) || row.mailProcessed !== undefined) continue;
      if (collection === "receivedInvoices" && !projects.has(row.projectId)) continue;
      // Deliberately use the old fallback, including dangling mail references. Do not resolve the linked invoice.
      candidates.push({ collection, id: row.id, updatedAt: row.updatedAt ?? null,
        proposedValue: collection === "mailDocuments" ? Boolean(row.relatedReceivedInvoiceId) : row.status === "PAID",
        rule: collection === "mailDocuments" ? "Boolean(relatedReceivedInvoiceId)" : 'status === "PAID"' });
    }
  }
  return candidates;
}

export function applyLegacyFlags(data, candidates, now = new Date().toISOString()) {
  const current = new Map(selectCandidates(data).map((row) => [keyOf(row), row]));
  if (!Array.isArray(candidates) || !Number.isFinite(Date.parse(now))) throw new Error("Invalid migration plan or timestamp");
  const seen = new Set(), changes = [];
  for (const candidate of candidates) {
    if (!candidate || !collections.includes(candidate.collection) || typeof candidate.id !== "string") throw new Error("Invalid migration target");
    const key = keyOf(candidate), actual = current.get(key);
    if (seen.has(key)) throw new Error(`Duplicate migration target: ${key}`);
    seen.add(key);
    if (!actual || typeof candidate.updatedAt !== "string" || !Number.isFinite(Date.parse(candidate.updatedAt)) || actual.updatedAt !== candidate.updatedAt) throw new Error(`Target changed or updatedAt is missing/invalid: ${key}`);
    if (typeof candidate.proposedValue !== "boolean" || candidate.proposedValue !== actual.proposedValue) throw new Error(`Legacy display changed: ${key}`);
    changes.push({ row: data[candidate.collection].find((row) => row.id === candidate.id), candidate });
  }
  // Validate the whole plan before changing even one flag or creating an audit entry.
  for (const { row, candidate } of changes) {
    row.mailProcessed = candidate.proposedValue;
    row.updatedAt = new Date(Math.max(Date.parse(now), Date.parse(row.updatedAt) + 1)).toISOString();
  }
  const result = { updated: changes.length, mailDocuments: changes.filter(({ candidate }) => candidate.collection === "mailDocuments").length,
    receivedInvoices: changes.filter(({ candidate }) => candidate.collection === "receivedInvoices").length };
  if (changes.length) {
    data.auditLogs ||= [];
    data.auditLogs.unshift({ id: randomUUID(), userId: `migration:${migrationId}`, action: "MAIL_PROCESSED_LEGACY_FLAGS_MIGRATION", targetType: "OcrDocument", targetId: "batch",
      afterJson: { migrationId, ...result, candidates }, createdAt: now });
  }
  return result;
}

function parseArgs(argv) {
  const args = { apply: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--apply" || key === "--json") { args[key.slice(2)] = true; continue; }
    if (!["--data", "--out", "--restore", "--plan"].includes(key)) throw new Error(`Unknown argument: ${key}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (args[key.slice(2)]) throw new Error(`Duplicate argument: ${key}`);
    args[key.slice(2)] = value;
  }
  if (!args.data) throw new Error("--data <app-data.json> is required");
  if (args.restore && (args.apply || args.plan || args.out)) throw new Error("--restore cannot be combined with --apply, --plan or --out");
  if (args.plan && !args.apply) throw new Error("--plan requires --apply");
  return args;
}

// Small IO boundary lets tests exercise the entire workflow using memory only; no migration CLI is launched.
const nodeIO = {
  read: (file) => fs.readFileSync(file, "utf8"),
  writeNew: (file, text) => fs.writeFileSync(file, text, { flag: "wx" }),
  mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  replace: (from, to) => fs.renameSync(from, to),
  remove: (file) => fs.unlinkSync(file),
};
function backup(file, snapshot, label, io) {
  const dir = path.join(path.dirname(file), "backups");
  io.mkdir(dir);
  const saved = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}-${randomUUID()}.json`);
  io.writeNew(saved, snapshot);
  return saved;
}
function replaceChecked(file, snapshot, next, io) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  io.writeNew(temp, next);
  try {
    if (io.read(file) !== snapshot) throw new Error("Data file changed before write. Nothing applied; review a fresh dry run.");
    io.replace(temp, file);
  } finally {
    try { io.remove(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
function counts(candidates) {
  return { total: candidates.length, mailDocuments: candidates.filter((row) => row.collection === "mailDocuments").length,
    receivedInvoices: candidates.filter((row) => row.collection === "receivedInvoices").length,
    processed: candidates.filter((row) => row.proposedValue).length, unprocessed: candidates.filter((row) => !row.proposedValue).length };
}

export function runMigration(argv, { io = nodeIO, log = console.log } = {}) {
  const args = parseArgs(argv), file = path.resolve(args.data);
  const snapshot = io.read(file), data = validateData(JSON.parse(snapshot));
  let report;
  if (args.restore) {
    const source = path.resolve(args.restore);
    if (source === file) throw new Error("The restore backup must differ from --data");
    const restored = io.read(source); validateData(JSON.parse(restored));
    const saved = backup(file, snapshot, "before-restore-mail-processed-legacy-flags", io);
    replaceChecked(file, snapshot, restored, io);
    report = { migrationId, mode: "restore", file, source, backup: saved };
  } else {
    let candidates = selectCandidates(data);
    if (args.plan) {
      const plan = JSON.parse(io.read(path.resolve(args.plan)));
      if (plan.migrationId !== migrationId || plan.file !== file || !Array.isArray(plan.candidates)) throw new Error("Plan does not match this migration/data file");
      candidates = plan.candidates;
    }
    report = { migrationId, mode: args.apply ? "apply" : "dry-run", file, generatedAt: new Date().toISOString(), counts: counts(candidates), candidates };
    if (args.out) {
      const out = path.resolve(args.out);
      if (out === file || (args.plan && out === path.resolve(args.plan))) throw new Error("--out must not overwrite data or the plan");
      // Exclusive creation also protects aliases/symlinks to the data file, existing reports and backups.
      io.writeNew(out, JSON.stringify(report, null, 2));
    }
    if (args.apply && candidates.length) {
      const latest = io.read(file), fresh = validateData(JSON.parse(latest));
      const result = applyLegacyFlags(fresh, candidates);
      if (latest !== snapshot) throw new Error("Data file changed since planning. Nothing applied; review a fresh dry run.");
      const saved = backup(file, latest, "mail-processed-legacy-flags", io);
      replaceChecked(file, latest, JSON.stringify(fresh, null, 2), io);
      report = { ...report, result, backup: saved };
    }
  }
  if (args.json) log(JSON.stringify(report, null, 2));
  else if (report.mode === "restore") log(`Restored ${file}. Previous file kept at ${report.backup}.`);
  else {
    log(["種別", "対象ID", "updatedAt", "提案値", "旧表示ルール"].join("\t"));
    for (const row of report.candidates) log([row.collection, row.id, row.updatedAt ?? "未設定（適用不可）", row.proposedValue, row.rule].join("\t"));
    log(`候補 ${report.counts.total}件 / 郵便物 ${report.counts.mailDocuments}件 / 受領請求書 ${report.counts.receivedInvoices}件 / true ${report.counts.processed}件 / false ${report.counts.unprocessed}件`);
    if (report.mode === "dry-run") log("Dry run. データは変更していません。適用・復元は承認後の別作業です。");
    else if (!report.backup) log("No candidates. Nothing to apply.");
    else {
      log(`Applied: ${report.result.updated} flags. Backup: ${report.backup}`);
      log(`Restore: node scripts/migrations/mail-processed-legacy-flags.mjs --data "${file}" --restore "${report.backup}"`);
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runMigration(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
