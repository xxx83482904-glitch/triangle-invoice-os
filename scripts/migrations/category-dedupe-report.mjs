#!/usr/bin/env node
// Dry-run report for P3-20 (科目重複・取引先名混在の補助科目化). Finds accounting categories whose normalised names
// collide, and bank descriptions that are used under several categories, then proposes a parent/sub-category layout.
// It never writes.
//   node scripts/migrations/category-dedupe-report.mjs --data <app-data.json> [--company JAPAN] [--out report.json]
import { readFileSync, writeFileSync } from "node:fs";

const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, "").replace(/[（）()・\-ー]/g, "").toLocaleLowerCase("ja");

export function categoryReport(data, company = "JAPAN") {
  const categories = (data.accountingCategories || []).filter((row) => row.company === company && !row.deletedAt && row.available);
  const byName = new Map();
  for (const row of categories) { const key = `${row.parentId || ""}|${normalize(row.name)}`; byName.set(key, [...(byName.get(key) || []), row]); }
  const duplicates = [...byName.values()].filter((rows) => rows.length > 1).map((rows) => ({ name: rows[0].name, ids: rows.map((row) => row.id), offices: [...new Set(rows.map((row) => row.officeCode || "-"))], proposal: rows.every((row) => row.sourceId) ? "連携科目同士の重複: Money Forward 側で統合" : "ローカル科目を連携科目へ寄せ、ルール・明細を付け替える" }));
  const names = new Map(categories.map((row) => [row.id, row.name]));
  const usage = new Map();
  for (const row of (data.bankTransactions || [])) {
    if (row.company !== company || row.sourceMissing || row.treatment !== "NORMAL" || !row.categoryId || !row.reviewed) continue;
    const key = `${row.side}|${normalize(row.content)}`;
    const entry = usage.get(key) || { content: row.content, side: row.side, categories: new Map(), count: 0 };
    entry.categories.set(row.categoryId, (entry.categories.get(row.categoryId) || 0) + 1); entry.count++;
    usage.set(key, entry);
  }
  const mixed = [...usage.values()].filter((entry) => entry.categories.size > 1).map((entry) => {
    const breakdown = [...entry.categories.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, name: names.get(id) || id, count }));
    return { content: entry.content, side: entry.side, count: entry.count, breakdown, proposal: `親科目「${breakdown[0].name}」に補助科目「${entry.content}」を作り、確認済み明細をそこへ寄せる（${breakdown.slice(1).map((row) => `${row.name} ${row.count}件`).join("・")} は見直し）` };
  }).sort((a, b) => b.count - a.count);
  return { company, categories: categories.length, duplicates, mixed };
}

if (process.argv[1]?.endsWith("category-dedupe-report.mjs")) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const file = option("--data"), company = option("--company", "JAPAN"), out = option("--out");
  if (!file) { console.error("--data <app-data.json> を指定してください"); process.exit(2); }
  const report = categoryReport(JSON.parse(readFileSync(file, "utf8")), company);
  console.log(`科目 ${report.categories}件（${company}） / 名称の重複 ${report.duplicates.length}組 / 同じ摘要で科目が分かれる ${report.mixed.length}件`);
  for (const row of report.duplicates) console.log(`- 重複: ${row.name} × ${row.ids.length}（事業者 ${row.offices.join(",")}） → ${row.proposal}`);
  for (const row of report.mixed.slice(0, 30)) console.log(`- 混在: ${row.content}（${row.side === "INCOME" ? "入金" : "出金"} ${row.count}件）: ${row.breakdown.map((item) => `${item.name} ${item.count}`).join(" / ")} → ${row.proposal}`);
  if (out) { writeFileSync(out, JSON.stringify(report, null, 2)); console.log(`JSON: ${out}`); }
  console.log("Dry run only: データは変更していません。補助科目の作成と付け替えは別途の承認の後に行います。");
}
