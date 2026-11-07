import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import PDFDocument from "pdfkit";
import { createCanvas } from "@napi-rs/canvas";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, sourceKey } from "../src/lib/banking";
import { confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import { addBankReceipt } from "../src/lib/bank-receipts";
import type { BankTransaction } from "../src/lib/banking-types";
import type { UserRole } from "../src/lib/types";

// Synthetic data for the original previews, amount gaps, linked documents and receipts on /banking.
// Start the server with DATA_DIR=<root> and UPLOAD_DIR=<root>/uploads. Never point this at production data.
function pdf(lines: string[]) {
  return new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 }), chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(26).text(lines[0]).moveDown();
    doc.fontSize(13); for (const line of lines.slice(1)) doc.text(line).moveDown(0.4);
    doc.end();
  });
}
function receiptPng() {
  const canvas = createCanvas(420, 640), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffdf7"; ctx.fillRect(0, 0, 420, 640); ctx.fillStyle = "#222"; ctx.font = "bold 28px sans-serif"; ctx.fillText("RECEIPT", 140, 70);
  ctx.font = "18px sans-serif"; ["Cafe Sample Store", "2026-10-09 12:41", "", "Coffee x2     1,100", "Sandwich      1,100", "", "TOTAL     JPY 2,200"].forEach((line, index) => ctx.fillText(line, 60, 140 + index * 36));
  return canvas.toBuffer("image/png");
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-bank-documents-preview-")), uploads = path.join(root, "uploads");
  await mkdir(uploads);
  await writeFile(path.join(uploads, "issued.pdf"), await pdf(["INVOICE INV-001", "To: Test Design Co., Ltd.", "Project: Aoyama showroom", "Total: JPY 330,000", "Due: 2026-09-30"]));
  await writeFile(path.join(uploads, "other.pdf"), await pdf(["INVOICE INV-002", "To: Test Design Co., Ltd.", "Total: JPY 110,000"]));
  await writeFile(path.join(uploads, "mail-scan.pdf"), await pdf(["INVOICE (scanned mail)", "From: Test Production Inc.", "Production fee September", "Total: JPY 88,000"]));
  await writeFile(path.join(uploads, "cafe-receipt.png"), receiptPng());
  const data = fixture(), office = "0000-0001";
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.clients[0].companyName = "株式会社テストデザイン";
  data.vendors[0].companyName = "株式会社テスト制作"; data.vendors[0].accountHolder = "カ）テストセイサク";
  data.projects[0].name = "青山ショールーム / 設計";
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; row.issueDate = "2026-09-01"; row.dueDate = "2026-09-30"; });
  Object.assign(data.issuedInvoices[0], { total: 330000, subtotal: 300000, taxTotal: 30000 });
  Object.assign(data.issuedInvoices[1], { total: 110000, subtotal: 100000, taxTotal: 10000 });
  // The received invoice has no file of its own; only the linked mail scan does.
  Object.assign(data.receivedInvoices[0], { status: "SCHEDULED", mailProcessed: false, total: 88000, subtotal: 80000, taxTotal: 8000, issueDate: "2026-09-01", dueDate: "2026-09-30", fileUrl: undefined, originalFileName: undefined });
  Object.assign(data.mailDocuments[0], { mailProcessed: false, fileUrl: "/api/files/mail-scan.pdf", originalFileName: "制作費_9月_郵便.pdf", title: "制作費 9月" });
  data.attachments = data.attachments.filter((row) => row.relatedType !== "MailDocument");
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行 / 普通預金", serviceName: "三菱UFJ銀行", isManual: false }], [
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true }, { id: "outsourcing", name: "外注費", group: "EXPENSE", available: true }, { id: "meeting", name: "会議費", group: "EXPENSE", available: true }, { id: "sales", name: "売上高", group: "INCOME", available: true },
  ]);
  const account = sourceKey("JAPAN", office, "account", "bank");
  const row = (id: string, date: string, amount: number, side: "INCOME" | "EXPENSE", content: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id: sourceKey("JAPAN", office, "transaction", id), company: "JAPAN", officeCode: office, sourceId: id, bankAccountId: account, transactionDate: date, amount, side, content, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
  data.bankTransactions = [
    row("cafe", "2026-10-09", 2200, "EXPENSE", "カード デビット カフェサンプル", { categoryId: sourceKey("JAPAN", office, "category", "meeting"), classificationSource: "MANUAL" }),
    row("expense-mail", "2026-10-08", 88000, "EXPENSE", "振込 カ）テストセイサク"),
    row("income-linked", "2026-10-07", 110000, "INCOME", "カ）テストデザイン INV-002"),
    row("income-short", "2026-10-05", 329340, "INCOME", "カ）テストデザイン INV-001"),
  ];
  const linked = data.bankTransactions.find((item) => item.sourceId === "income-linked")!, invoice = data.issuedInvoices[1];
  confirmBankReconciliation(data, admin, "JAPAN", { transactionId: linked.id, transactionUpdatedAt: linked.updatedAt, invoiceKind: "issued", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, amount: 110000, mode: "new", acknowledged: true }, "2026-10-10");
  addBankReceipt(data, admin, "JAPAN", { transactionId: data.bankTransactions[0].id, fileUrl: "/api/files/cafe-receipt.png", fileName: "カフェ領収書.png", mimeType: "image/png" }, "receipt-cafe", "2026-10-09T05:00:00.000Z");
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`UPLOAD_DIR=${uploads}`);
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
