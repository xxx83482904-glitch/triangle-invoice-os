#!/usr/bin/env node
// Dry-run only. Never writes source data, and deliberately has no --apply/--restore mode.
// node scripts/migrations/vendor-obligation-kind-report.mjs --data <app-data.json> [--json]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

// Keep inference aligned with obligation-classification.ts (parity tested with synthetic names).
const tax = /税務署|国税|都税|県税|府税|市税|区役所|市役所|町役場|役場|住民税|法人税|消費税|固定資産税|自動車税|事業税|源泉所得税|納税/;
const insurance = /年金事務所|年金|健康保険|社会保険|厚生年金|労働保険|雇用保険|労災|国民健康保険|日本年金機構|協会けんぽ|ハローワーク/;

export function vendorObligationCandidates(data) {
  if (data.appEdition === "CHINA") throw new Error("日本版だけが対象です");
  const unset = (data.vendors || []).filter((row) => !row.deletedAt && row.company === "JAPAN" && row.obligationKind === undefined);
  const candidates = unset.flatMap((row) => {
    const name = String(row.companyName || "").normalize("NFKC").replace(/\s+/g, "");
    const social = name.match(insurance)?.[0], taxName = name.match(tax)?.[0];
    return social || taxName ? [{ id: row.id, name: row.companyName, updatedAt: row.updatedAt, proposedValue: social ? "SOCIAL_INSURANCE" : "TAX", reason: `支払先名に「${social || taxName}」を含む（人による確認が必要）` }] : [];
  });
  return { dryRun: true, company: "JAPAN", unset: unset.length, count: candidates.length, candidates };
}

export function runVendorObligationReport(args, io = { read: (file) => readFileSync(file, "utf8"), log: (text) => console.log(text) }) {
  let file, json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--data" && args[i + 1] && !args[i + 1].startsWith("--")) file = args[++i];
    else if (args[i] === "--json") json = true;
    else throw new Error(`対応していない引数です: ${args[i]}。候補表示専用で、適用はできません`);
  }
  if (!file) throw new Error("--data <app-data.json> を明示してください");
  const report = vendorObligationCandidates(JSON.parse(io.read(file)));
  if (json) io.log(JSON.stringify(report, null, 2));
  else {
    io.log(`ドライラン専用: 区分未設定 ${report.unset}件 / 初期登録の候補 ${report.count}件`);
    for (const row of report.candidates) io.log(`${row.id} / ${row.name} / ${row.proposedValue} / ${row.reason} / updatedAt: ${row.updatedAt}`);
    io.log("データは変更していません。支払先画面での明示設定、または承認後の別作業が必要です。");
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { runVendorObligationReport(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "候補を取得できませんでした"); process.exitCode = 1; }
}
