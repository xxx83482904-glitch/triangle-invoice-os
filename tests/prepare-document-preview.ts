import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { hashSync } from "bcryptjs";
import { createCanvas } from "@napi-rs/canvas";
import { fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions } from "../src/lib/banking";

async function pdf(text: string) {
  return new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(18).text("TRIANGLE / LOCAL TEST").moveDown().fontSize(12).text(text);
    doc.end();
  });
}
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-documents-"));
  const upload = path.join(root, "uploads");
  await mkdir(upload);
  const data = fixture();
  data.users = ["ADMIN", "PROJECT_MANAGER", "MAIL_EDITOR"].map((role, n) => ({ id: ["admin", "manager", "mail"][n], name: `Test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role: role as "ADMIN" | "PROJECT_MANAGER" | "MAIL_EDITOR", passwordHash: hashSync("local-documents-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  if (process.argv.includes("--installments")) {
    data.users.push({ id: "billing", name: "Test Billing", email: "billing@example.invalid", role: "BILLING_EDITOR", passwordHash: hashSync("local-documents-test-only", 10), createdAt: timestamp, updatedAt: timestamp });
    for (const [index, label] of ["初回", "二回目回", "三回目"].entries()) {
      const id = `round-${index}`;
      data.projects.push({ id, company: "JAPAN", name: `横浜吉野町ホテルステイ 設計${label}請求書`, clientId: "client", managerId: "billing", memberIds: ["billing"], status: "PLANNING", contractAmount: 0, billingCount: 1,
        memo: "発行請求書OCRから自動作成。案件名・請求先・契約情報要確認。", createdAt: timestamp, updatedAt: timestamp });
      data.issuedInvoices.push({ ...data.issuedInvoices[0], id: `round-invoice-${index}`, projectId: id, invoiceNumber: `ROUND-${index}` });
    }
  }
  if (process.argv.includes("--account-options")) {
    mergeBankMasters(data, "JAPAN", "test-office", [
      { id: "old", name: "PayPay銀行", serviceName: "PayPay銀行", isManual: false },
      { id: "old", subId: "branch", name: "PayPay銀行 / テスト支店 普通 1237691", serviceName: "PayPay銀行", isManual: false },
      { id: "new", name: "PayPay銀行", serviceName: "PayPay銀行", isManual: false },
      { id: "new", subId: "branch", name: "PayPay銀行 / テスト支店 普通 1237691", serviceName: "PayPay銀行", isManual: false },
      { id: "new", subId: "other", name: "PayPay銀行 / テスト支店 普通 1232901", serviceName: "PayPay銀行", isManual: false },
    ], []);
    mergeBankTransactions(data, "JAPAN", "test-office", [
      { id: "older", connected_account_id: "old", connected_sub_account_id: "branch", date: "2026-09-01", value: 1000, side: "INCOME", content: "旧連携のテスト明細", journalizing_status: "none" },
      { id: "current", connected_account_id: "new", connected_sub_account_id: "branch", date: "2026-09-02", value: 2000, side: "INCOME", content: "新連携のテスト明細", journalizing_status: "none" },
      { id: "other", connected_account_id: "new", connected_sub_account_id: "other", date: "2026-09-03", value: 3000, side: "INCOME", content: "別口座のテスト明細", journalizing_status: "none" },
    ], { start: "2026-09-01", end: "2026-09-30" });
    data.clients[0].companyName = "株式会社テストデザイン";
    data.clients.push({ ...data.clients[0], id: "second-client", companyName: "株式会社サンプル設計" });
    data.projects.find((project) => project.id === "other")!.clientId = "second-client";
    data.issuedInvoices.find((invoice) => invoice.projectId === "other")!.clientId = "second-client";
  }
  if (process.argv.includes("--selection")) {
    for (let index = 0; index < 8; index++) {
      const suffix = String(index).padStart(2, "0"), month = index < 4 ? "2026-10" : "2026-09";
      const clientId = `select-client-${suffix}`, vendorId = `select-vendor-${suffix}`, projectId = `select-project-${suffix}`;
      data.clients.push({ ...data.clients[0], id: clientId, companyName: `Selection client ${suffix}` });
      data.vendors.push({ ...data.vendors[0], id: vendorId, companyName: `Selection vendor ${suffix}` });
      data.projects.push({ ...data.projects[0], id: projectId, clientId, name: `Selection project ${suffix}`, contractFileUrl: undefined });
      data.issuedInvoices.push({ ...data.issuedInvoices[0], id: `select-issued-${suffix}`, clientId, projectId, invoiceNumber: `SEL-INV-${suffix}`, issueDate: `${month}-15` });
      data.receivedInvoices.push({ ...data.receivedInvoices[0], id: `select-received-${suffix}`, vendorId, projectId, issueDate: `${month}-15`, folderMonth: month, status: "REVIEWING", mailProcessed: false });
      data.mailDocuments.push({ ...data.mailDocuments[0], id: `select-mail-${suffix}`, title: `Selection mail ${suffix}`, senderName: `Selection sender ${suffix}`, folderMonth: month, relatedReceivedInvoiceId: undefined, mailProcessed: false });
      data.estimates.push({ id: `select-estimate-${suffix}`, estimateNumber: `SEL-EST-${suffix}`, clientId, projectId, issueDate: `${month}-15`, validUntil: "2026-11-30", status: "DRAFT", items: [{ id: `item-${suffix}`, description: "Test design", quantity: 1, unitPrice: 12000, taxRate: 0, amount: 12000 }], subtotal: 12000, taxTotal: 0, total: 12000, createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
    }
    mergeBankMasters(data, "JAPAN", "selection-office", [{ id: "bank", name: "Selection test bank", serviceName: "Selection test bank", isManual: false }], [{ id: "expense", name: "消耗品費", group: "EXPENSE", available: true }]);
    mergeBankTransactions(data, "JAPAN", "selection-office", Array.from({ length: 75 }, (_, index) => ({ id: `select-bank-${index}`, connected_account_id: "bank", date: "2026-10-15", value: 1000 + index, side: "EXPENSE" as const, content: `Selection transaction ${String(index).padStart(2, "0")}`, journalizing_status: "none" })), { start: "2026-10-01", end: "2026-10-31" });
  }
  if (process.argv.includes("--bank-links")) {
    mergeBankMasters(data, "JAPAN", "link-office", [
      { id: "from", name: "三菱UFJ銀行 / テスト 1234567", serviceName: "三菱UFJ銀行", isManual: false },
      { id: "to", name: "PayPay銀行 / テスト 1237691", serviceName: "PayPay銀行", isManual: false },
    ], [{ id: "expense", name: "旅費交通費", group: "EXPENSE", available: true }, { id: "income", name: "売上高", group: "INCOME", available: true }]);
    mergeBankTransactions(data, "JAPAN", "link-office", [
      { id: "invoice-income", connected_account_id: "from", date: "2026-10-26", value: 12000, side: "INCOME", content: "Test customer INV-001", journalizing_status: "none" },
      { id: "transfer-out", connected_account_id: "from", date: "2026-10-25", value: 100000, side: "EXPENSE", content: "Test internal transfer out", journalizing_status: "none" },
      { id: "transfer-in", connected_account_id: "to", date: "2026-10-25", value: 100000, side: "INCOME", content: "Test internal transfer in", journalizing_status: "none" },
      { id: "invoice-expense", connected_account_id: "from", date: "2026-10-24", value: 8000, side: "EXPENSE", content: "Test supplier", journalizing_status: "none" },
      { id: "history-target", connected_account_id: "from", date: "2026-10-23", value: 1200, side: "EXPENSE", content: "JRW SHINKANSEN", journalizing_status: "none" },
      { id: "history-source", connected_account_id: "from", date: "2026-09-23", value: 1000, side: "EXPENSE", content: "JRW SHINKANSEN", journalizing_status: "none" },
    ], { start: "2026-09-01", end: "2026-10-31" });
    const historical = data.bankTransactions.find((row) => row.sourceId === "history-source")!;
    Object.assign(historical, { categoryId: data.accountingCategories.find((row) => row.name === "旅費交通費")!.id, reviewed: true, classificationSource: "MANUAL" });
    data.issuedInvoices[0].status = "ISSUED"; data.issuedInvoices[0].needsReview = false;
    data.receivedInvoices[0].status = "SCHEDULED"; data.receivedInvoices[0].mailProcessed = false;
    data.mailDocuments[0].mailProcessed = false;
  }
  for (const file of ["issued.pdf", "other.pdf", "china.pdf", "contract.pdf", "old.pdf", "received.pdf"]) await writeFile(path.join(upload, file), await pdf(file));
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  for (let i = 1; i <= 3; i++) await writeFile(path.join(root, `drop-${i}.pdf`), await pdf(`Invoice Number: DROP-00${i}\nInvoice date: 2026-09-15\nDue date: 2026-10-15\nBill to: Test customer\nTotal amount: 12,000`));
  const canvas = createCanvas(1200, 1600);
  const context = canvas.getContext("2d"); context.fillStyle = "white"; context.fillRect(0, 0, 1200, 1600); context.fillStyle = "black"; context.font = "36px Arial";
  ["TRIANGLE INVOICE", "Invoice Number: IMAGE-001", "Invoice date: 2026-09-15", "Due date: 2026-10-15", "Total amount: 12000"].forEach((line, i) => context.fillText(line, 70, 130 + i * 90));
  await writeFile(path.join(root, "scan.png"), canvas.toBuffer("image/png"));
  console.log(root);
}
void main();
