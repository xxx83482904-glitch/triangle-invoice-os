#!/usr/bin/env node
// Report only: lists received invoices that may belong to the same debt (same vendor, within 180 days,
// same amount or a 再請求/督促/領収/合計 word in the file name) and are not yet in a debt group.
//   node scripts/migrations/debt-group-candidates.mjs --data <app-data.json> [--company JAPAN] [--out report.json]
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const file = option("--data"), company = option("--company", "JAPAN"), out = option("--out");
if (!file) { console.error("--data <app-data.json> を指定してください"); process.exit(2); }
const data = JSON.parse(readFileSync(file, "utf8"));
const keyword = /再発行|再請求|督促|領収|合計請求|お支払いのお願い|reminder|receipt|statement/i;
const cents = (value) => Math.round(Number(value) * 100);
const projects = new Map((data.projects || []).filter((row) => !row.deletedAt).map((row) => [row.id, (row.company || "JAPAN").toUpperCase()]));
const vendors = new Map((data.vendors || []).map((row) => [row.id, row.companyName]));
const rows = (data.receivedInvoices || []).filter((row) => !row.deletedAt && projects.get(row.projectId) === company && !row.debtGroupId);

export function candidatePairs(invoices) {
  const pairs = [];
  for (let i = 0; i < invoices.length; i++) for (let j = i + 1; j < invoices.length; j++) {
    const a = invoices[i], b = invoices[j];
    if (a.vendorId !== b.vendorId) continue;
    const days = Math.abs(Date.parse(a.issueDate) - Date.parse(b.issueDate)) / 86400000;
    if (!Number.isFinite(days) || days > 180) continue;
    const reasons = [];
    if (cents(a.total) === cents(b.total)) reasons.push("同じ金額");
    if (keyword.test(`${a.originalFileName || ""} ${a.memo || ""} ${b.originalFileName || ""} ${b.memo || ""}`)) reasons.push("再請求・督促・領収・合計の語を含む");
    if (!reasons.length) continue;
    const [older, newer] = a.issueDate <= b.issueDate ? [a, b] : [b, a];
    pairs.push({ vendor: vendors.get(a.vendorId) || a.vendorId, older: { id: older.id, issueDate: older.issueDate, total: older.total, file: older.originalFileName, status: older.status }, newer: { id: newer.id, issueDate: newer.issueDate, total: newer.total, file: newer.originalFileName, status: newer.status }, days: Math.round(days), reasons,
      proposal: `${older.originalFileName || older.id} を請求書、${newer.originalFileName || newer.id} を${/領収/.test(newer.originalFileName || "") ? "領収書" : /督促/.test(newer.originalFileName || "") ? "督促" : "再請求"}として束ねる（支払対象は最新1枚）` });
  }
  return pairs.sort((x, y) => y.reasons.length - x.reasons.length || x.vendor.localeCompare(y.vendor, "ja"));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("debt-group-candidates.mjs")) {
  const pairs = candidatePairs(rows);
  console.log(`債務グループ候補 ${pairs.length}組（${company} / 未グループの受領請求書 ${rows.length}件）`);
  for (const pair of pairs.slice(0, 50)) console.log(`- ${pair.vendor}: ${pair.older.issueDate} ${pair.older.file || pair.older.id} (${pair.older.total}) ↔ ${pair.newer.issueDate} ${pair.newer.file || pair.newer.id} (${pair.newer.total}) / ${pair.reasons.join("・")} / ${pair.days}日 → ${pair.proposal}`);
  if (pairs.length > 50) console.log(`… ほか ${pairs.length - 50}組`);
  if (out) { writeFileSync(out, JSON.stringify({ company, generatedAt: new Date().toISOString(), pairs }, null, 2)); console.log(`JSON: ${out}`); }
  console.log("Report only: データは変更していません。束ねる操作は受領請求書の詳細「債務グループ」で行います。");
}
