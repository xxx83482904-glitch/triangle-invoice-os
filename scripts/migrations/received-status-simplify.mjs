#!/usr/bin/env node
// Dry-run report for P3-21 (受領請求書の状態の簡素化). Counts documents per current status, shows the proposed mapping
// and lists documents whose payment records disagree with their status. It never writes.
//   node scripts/migrations/received-status-simplify.mjs --data <app-data.json> [--company JAPAN] [--out report.json]
import { readFileSync, writeFileSync } from "node:fs";

export const proposedMapping = {
  RECEIVED: "REVIEWING", OCR_PENDING: "REVIEWING", REVIEWING: "REVIEWING", APPROVAL_PENDING: "REVIEWING",
  SCHEDULED: "SCHEDULED", PAID: "PAID", ON_HOLD: "ON_HOLD", REJECTED: "REJECTED", ARCHIVED: "ARCHIVED",
};
export const proposedLabels = { REVIEWING: "確認中（受領・OCR・承認待ちを統合）", SCHEDULED: "支払予定", PAID: "支払済み（支払記録から導出）", ON_HOLD: "保留", REJECTED: "却下", ARCHIVED: "保管" };

export function statusReport(data, company = "JAPAN") {
  const projects = new Map((data.projects || []).filter((row) => !row.deletedAt).map((row) => [row.id, (row.company || "JAPAN").toUpperCase()]));
  const rows = (data.receivedInvoices || []).filter((row) => !row.deletedAt && projects.get(row.projectId) === company);
  const counts = {}, mapped = {}, mismatches = [];
  for (const row of rows) {
    counts[row.status] = (counts[row.status] || 0) + 1;
    const target = proposedMapping[row.status] || row.status;
    mapped[target] = (mapped[target] || 0) + 1;
    const paid = (data.payments || []).filter((payment) => !payment.deletedAt && payment.type === "EXPENSE" && payment.receivedInvoiceId === row.id).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const complete = row.total > 0 && Math.round(paid * 100) >= Math.round(row.total * 100);
    if ((row.status === "PAID") !== complete) mismatches.push({ id: row.id, file: row.originalFileName, status: row.status, total: row.total, paid, proposal: complete ? "支払記録が揃っているため PAID に揃える" : "支払記録が不足。SCHEDULED に戻すか支払記録を登録する" });
  }
  return { company, documents: rows.length, counts, mapped, mismatches, changes: rows.filter((row) => (proposedMapping[row.status] || row.status) !== row.status).length };
}

if (process.argv[1]?.endsWith("received-status-simplify.mjs")) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const file = option("--data"), company = option("--company", "JAPAN"), out = option("--out");
  if (!file) { console.error("--data <app-data.json> を指定してください"); process.exit(2); }
  const report = statusReport(JSON.parse(readFileSync(file, "utf8")), company);
  console.log(`受領請求書 ${report.documents}件（${company}）`);
  console.log("現在の状態:", Object.entries(report.counts).map(([status, count]) => `${status} ${count}`).join(" / "));
  console.log("簡素化後:", Object.entries(report.mapped).map(([status, count]) => `${status}（${proposedLabels[status] || status}）${count}`).join(" / "));
  console.log(`状態が変わる書類 ${report.changes}件 / 状態と支払記録の不一致 ${report.mismatches.length}件`);
  for (const row of report.mismatches.slice(0, 30)) console.log(`- ${row.file || row.id}: ${row.status} / 請求 ${row.total} / 支払記録 ${row.paid} → ${row.proposal}`);
  if (out) { writeFileSync(out, JSON.stringify(report, null, 2)); console.log(`JSON: ${out}`); }
  console.log("Dry run only: データは変更していません。適用は別途の承認とバックアップの後に行います。");
}
