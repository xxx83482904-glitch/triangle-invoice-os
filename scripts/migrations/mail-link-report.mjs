#!/usr/bin/env node
// Report only: lists mail documents whose received invoice no longer exists (with re-link candidates) and documents
// whose original file is missing from the upload folders. Never writes to the data file.
//
//   node scripts/migrations/mail-link-report.mjs --data data/app-data.json [--uploads /volume1/docker/triangle-invoice-os/uploads[,/other/dir]] [--out report.json]
//
// Repairs are done in the app: 郵便物フォルダー → 該当行の編集欄 → 「受領請求書を作り直す」または「既存の受領請求書へ再連携」.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const reportId = "mail-link-report-2026-10-31-v1";
const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, "");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unknown argument: ${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value; i++;
  }
  return args;
}

export function fileNameFromUrl(fileUrl) {
  if (!fileUrl) return "";
  try { return path.basename(decodeURIComponent(path.basename(new URL(fileUrl, "http://localhost").pathname))); } catch { return path.basename(String(fileUrl)); }
}

function liveInvoice(data, id) {
  const invoice = (data.receivedInvoices || []).find((row) => row.id === id && !row.deletedAt);
  const project = invoice && (data.projects || []).find((row) => row.id === invoice.projectId && !row.deletedAt && (row.company || "JAPAN") === "JAPAN");
  return invoice && project ? invoice : undefined;
}

export function brokenLinks(data) {
  const vendors = new Map((data.vendors || []).map((row) => [row.id, row.companyName]));
  const live = (data.receivedInvoices || []).filter((row) => liveInvoice(data, row.id));
  const mails = (data.mailDocuments || []).filter((row) => !row.deletedAt && (row.company || "JAPAN") === "JAPAN");
  const linkedElsewhere = new Map();
  for (const mail of mails) if (mail.relatedReceivedInvoiceId) linkedElsewhere.set(mail.relatedReceivedInvoiceId, (linkedElsewhere.get(mail.relatedReceivedInvoiceId) || 0) + 1);
  return mails.filter((mail) => mail.relatedReceivedInvoiceId && !liveInvoice(data, mail.relatedReceivedInvoiceId)).map((mail) => {
    const deletedTarget = (data.receivedInvoices || []).find((row) => row.id === mail.relatedReceivedInvoiceId);
    const title = normalize(mail.title), sender = normalize(mail.senderName), file = normalize(mail.originalFileName);
    const candidates = live.map((invoice) => {
      const reasons = [];
      if (mail.fileUrl && invoice.fileUrl === mail.fileUrl) reasons.push("同じ原本ファイル");
      if (file && normalize(invoice.originalFileName) === file) reasons.push("同じファイル名");
      const vendor = normalize(vendors.get(invoice.vendorId));
      if (vendor.length >= 2 && (title.includes(vendor) || sender.includes(vendor) || (sender.length >= 2 && vendor.includes(sender)))) reasons.push("支払先名が一致");
      if (deletedTarget && invoice.vendorId === deletedTarget.vendorId && Number(invoice.total) === Number(deletedTarget.total)) reasons.push("削除された書類と同じ支払先・金額");
      return { invoiceId: invoice.id, vendor: vendors.get(invoice.vendorId) || invoice.vendorId, total: invoice.total, issueDate: invoice.issueDate, fileName: invoice.originalFileName || "", linkedByOtherMail: (linkedElsewhere.get(invoice.id) || 0) > 0, reasons };
    }).filter((row) => row.reasons.length).sort((a, b) => b.reasons.length - a.reasons.length).slice(0, 5);
    return { mailDocumentId: mail.id, title: mail.title, senderName: mail.senderName || "", folderMonth: mail.folderMonth || String(mail.createdAt || "").slice(0, 7), category: mail.category, fileName: mail.originalFileName || "", fileUrl: mail.fileUrl || "",
      missingInvoiceId: mail.relatedReceivedInvoiceId, missingInvoiceState: deletedTarget ? (deletedTarget.deletedAt ? "削除済み" : "案件が無効・別会社") : "存在しない",
      deletedInvoice: deletedTarget ? { vendor: vendors.get(deletedTarget.vendorId) || deletedTarget.vendorId, total: deletedTarget.total, issueDate: deletedTarget.issueDate, status: deletedTarget.status, deletedAt: deletedTarget.deletedAt || "" } : null,
      candidates, proposal: candidates.length ? "既存の受領請求書へ再連携（候補あり）" : "受領請求書を作り直す（候補なし）" };
  });
}

export function missingFiles(data, exists) {
  const result = [];
  for (const mail of (data.mailDocuments || []).filter((row) => !row.deletedAt && (row.company || "JAPAN") === "JAPAN")) {
    const name = fileNameFromUrl(mail.fileUrl);
    if (name && exists(name) === false) result.push({ kind: "mail", id: mail.id, title: mail.title, folderMonth: mail.folderMonth || String(mail.createdAt || "").slice(0, 7), fileName: name, linkedInvoiceId: mail.relatedReceivedInvoiceId || "" });
  }
  for (const invoice of (data.receivedInvoices || []).filter((row) => liveInvoice(data, row.id) && row.fileUrl)) {
    const name = fileNameFromUrl(invoice.fileUrl);
    if (name && exists(name) === false) result.push({ kind: "invoice", id: invoice.id, title: invoice.originalFileName || "受領請求書", folderMonth: invoice.folderMonth || String(invoice.issueDate || "").slice(0, 7), fileName: name, linkedInvoiceId: "" });
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.data) throw new Error("--data <app-data.json> is required");
  const data = JSON.parse(fs.readFileSync(path.resolve(args.data), "utf8"));
  if (data.appEdition !== "JAPAN") throw new Error(`Not a Japan data file (appEdition=${data.appEdition}).`);
  const broken = brokenLinks(data);
  console.log("=== 参照切れの郵便物 ===");
  console.log(["郵便物ID", "月", "発送元", "ファイル", "参照先ID", "参照先の状態", "候補数", "提案"].join("\t"));
  for (const row of broken) {
    console.log([row.mailDocumentId, row.folderMonth, row.senderName || row.title, row.fileName, row.missingInvoiceId, row.missingInvoiceState, row.candidates.length, row.proposal].join("\t"));
    for (const candidate of row.candidates) console.log(`    候補 ${candidate.invoiceId}\t${candidate.vendor}\t${candidate.total}\t${candidate.issueDate}\t${candidate.fileName}\t${candidate.reasons.join("・")}${candidate.linkedByOtherMail ? "\t別の郵便物と連携済み" : ""}`);
  }
  console.log(`参照切れ ${broken.length}件`);
  let missing = [];
  if (args.uploads) {
    const roots = args.uploads.split(",").map((dir) => path.resolve(dir.trim())).filter(Boolean);
    missing = missingFiles(data, (name) => roots.some((root) => fs.existsSync(path.join(root, name))));
    console.log("\n=== 原本ファイルが見つからない書類 ===");
    console.log(["種別", "ID", "月", "表示名", "ファイル名", "連携先"].join("\t"));
    for (const row of missing) console.log([row.kind === "mail" ? "郵便物" : "受領請求書", row.id, row.folderMonth, row.title, row.fileName, row.linkedInvoiceId].join("\t"));
    console.log(`原本なし ${missing.length}件（郵便物 ${missing.filter((row) => row.kind === "mail").length} / 受領請求書 ${missing.filter((row) => row.kind === "invoice").length}）。検索先: ${roots.join(", ")}`);
  } else {
    console.log("\n原本ファイルの確認は --uploads <dir> を指定したときだけ行います。");
  }
  if (args.out) { fs.writeFileSync(path.resolve(args.out), JSON.stringify({ reportId, generatedAt: new Date().toISOString(), brokenLinks: broken, missingFiles: missing }, null, 2)); console.log(`Report written to ${path.resolve(args.out)}`); }
  console.log("\nReport only. Nothing was written to the data file.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
