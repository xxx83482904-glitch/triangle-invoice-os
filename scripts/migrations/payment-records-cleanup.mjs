#!/usr/bin/env node
// Lists (and, only with --apply, cancels) payment records that the retired "status → 支払済み" flow created
// automatically and that no bank reconciliation confirms. Dry run is the default and never writes.
//
//   node scripts/migrations/payment-records-cleanup.mjs --data data/app-data.json [--out report.json]
//   node scripts/migrations/payment-records-cleanup.mjs --data data/app-data.json --apply [--only id1,id2] [--exclude id3]
//   node scripts/migrations/payment-records-cleanup.mjs --data data/app-data.json --restore data/backups/<timestamp>-payment-records-cleanup.json
//
// A canceled record is soft-deleted with a reason in its history; the document returns to 支払予定 when the remaining
// records no longer cover the payable amount. Mail processing flags and bank reconciliations are left untouched.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const migrationId = "payment-records-cleanup-2026-10-31-v1";
const stamp = (previous) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const cents = (value) => Math.round(Number(value || 0) * 100);
export const isLegacyStatusPayment = (payment) => !payment.source && (payment.method === "ステータス変更" || String(payment.memo || "").startsWith("ステータス変更で支払済み"));

function parseArgs(argv) {
  const args = { apply: false, only: [], exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--apply") { args.apply = true; continue; }
    if (!key.startsWith("--")) throw new Error(`Unknown argument: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--only" || key === "--exclude") args[key.slice(2)] = value.split(",").map((item) => item.trim()).filter(Boolean);
    else args[key.slice(2)] = value;
    i++;
  }
  return args;
}

export function selectCandidates(data) {
  const vendors = new Map((data.vendors || []).map((row) => [row.id, row.companyName]));
  const invoices = new Map((data.receivedInvoices || []).map((row) => [row.id, row]));
  const links = (data.bankReconciliations || []).filter((link) => !link.deletedAt);
  const linkedByPayment = new Map();
  for (const link of links) linkedByPayment.set(link.paymentId, (linkedByPayment.get(link.paymentId) || 0) + cents(link.amount));
  const active = (data.payments || []).filter((payment) => !payment.deletedAt && payment.type === "EXPENSE" && payment.receivedInvoiceId);
  return active.filter((payment) => isLegacyStatusPayment(payment) && !linkedByPayment.get(payment.id)).map((payment) => {
    const invoice = invoices.get(payment.receivedInvoiceId);
    const others = active.filter((row) => row.receivedInvoiceId === payment.receivedInvoiceId && row.id !== payment.id);
    const otherPaid = others.reduce((total, row) => total + cents(row.amount), 0);
    const otherLinked = others.reduce((total, row) => total + (linkedByPayment.get(row.id) || 0), 0);
    const total = cents(invoice?.total);
    const proposal = !invoice || invoice.deletedAt ? "取消（書類が削除済み）"
      : otherLinked >= total && total > 0 ? "取消（銀行照合で全額確認済み。自動作成分は重複）"
      : ["REJECTED", "ARCHIVED"].includes(invoice.status) ? "取消（書類は差し戻し・アーカイブ）"
      : "取消候補（支払の証拠なし。実際に支払済みなら手入力の支払記録として登録し直す）";
    return { paymentId: payment.id, paymentAmount: payment.amount, paymentDate: payment.paymentDate, createdAt: payment.createdAt,
      invoiceId: payment.receivedInvoiceId, vendor: invoice ? vendors.get(invoice.vendorId) || invoice.vendorId : "", fileName: invoice?.originalFileName || "", invoiceTotal: invoice?.total ?? null,
      invoiceStatus: invoice?.status || "DELETED", dueDate: invoice?.dueDate || "", otherPaid: otherPaid / 100, otherBankLinked: otherLinked / 100,
      overpaid: invoice ? Math.max(0, otherPaid + cents(payment.amount) - total) / 100 : 0, proposal };
  });
}

export function applyCleanup(data, paymentIds, now = new Date().toISOString()) {
  const wanted = new Set(paymentIds);
  const touched = new Set();
  let canceled = 0;
  for (const payment of data.payments) {
    if (!wanted.has(payment.id) || payment.deletedAt) continue;
    payment.history = [...(payment.history || []), { at: now, byId: `migration:${migrationId}`, kind: "CANCELED", reason: "移行: 状態変更で自動作成された支払記録（銀行照合なし）を取消", before: { amount: payment.amount, paymentDate: payment.paymentDate } }];
    payment.deletedAt = now; payment.updatedAt = stamp(payment.updatedAt);
    touched.add(payment.receivedInvoiceId); canceled++;
  }
  let invoicesUpdated = 0;
  for (const invoice of data.receivedInvoices) {
    if (!touched.has(invoice.id)) continue;
    const paid = data.payments.filter((row) => !row.deletedAt && row.type === "EXPENSE" && row.receivedInvoiceId === invoice.id).reduce((total, row) => total + cents(row.amount), 0);
    if (invoice.status === "PAID" && paid < cents(invoice.total)) { invoice.status = "SCHEDULED"; invoice.paidAt = undefined; invoice.updatedAt = stamp(invoice.updatedAt); invoicesUpdated++; }
  }
  data.auditLogs ||= [];
  data.auditLogs.unshift({ id: randomUUID(), userId: `migration:${migrationId}`, action: "PAYMENT_CANCEL_MIGRATION", targetType: "Payment", targetId: "batch", afterJson: { migrationId, canceled, invoicesUpdated, ids: [...wanted] }, createdAt: now });
  return { canceled, invoicesUpdated };
}

function readJson(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.appEdition !== "JAPAN") throw new Error(`${file} is not a Japan data file (appEdition=${data.appEdition}). Refusing to touch it.`);
  if (!Array.isArray(data.payments) || !Array.isArray(data.receivedInvoices)) throw new Error(`${file} lacks payments or receivedInvoices`);
  return data;
}
function writeJsonAtomically(file, data) { const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(data, null, 2)); fs.renameSync(temp, file); }
function backup(file, label) {
  const dir = path.join(path.dirname(file), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.json`);
  fs.copyFileSync(file, target);
  return target;
}
function printTable(rows) {
  console.log(["支払記録ID", "支払日", "金額", "支払先", "書類", "請求額", "状態", "他の支払記録", "うち銀行照合", "超過", "提案"].join("\t"));
  for (const row of rows) console.log([row.paymentId, row.paymentDate, row.paymentAmount, row.vendor, row.fileName, row.invoiceTotal ?? "", row.invoiceStatus, row.otherPaid, row.otherBankLinked, row.overpaid, row.proposal].join("\t"));
  const byProposal = new Map();
  for (const row of rows) byProposal.set(row.proposal, (byProposal.get(row.proposal) || 0) + 1);
  console.log(`\n候補 ${rows.length}件 / 書類 ${new Set(rows.map((row) => row.invoiceId)).size}件`);
  for (const [proposal, count] of byProposal) console.log(`  ${proposal}: ${count}件`);
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
  const data = readJson(file);
  const candidates = selectCandidates(data).filter((row) => (!args.only.length || args.only.includes(row.paymentId)) && !args.exclude.includes(row.paymentId));
  printTable(candidates);
  if (args.out) { fs.writeFileSync(path.resolve(args.out), JSON.stringify({ migrationId, file, generatedAt: new Date().toISOString(), only: args.only, exclude: args.exclude, candidates }, null, 2)); console.log(`Report written to ${path.resolve(args.out)}`); }
  if (!args.apply) { console.log("\nDry run. Nothing was written. Review the list, then re-run with --apply (optionally --only / --exclude)."); return; }
  if (!candidates.length) { console.log("No candidates. Nothing to apply."); return; }
  const saved = backup(file, "payment-records-cleanup");
  const result = applyCleanup(data, candidates.map((row) => row.paymentId));
  writeJsonAtomically(file, data);
  console.log(`\nApplied: ${result.canceled} payment records canceled, ${result.invoicesUpdated} documents returned to 支払予定. Backup: ${saved}`);
  console.log(`Undo: node scripts/migrations/payment-records-cleanup.mjs --data ${file} --restore ${saved}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
