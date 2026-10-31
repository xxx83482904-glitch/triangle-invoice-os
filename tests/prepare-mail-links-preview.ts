import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp } from "./document-fixture";
import type { MailDocument, ReceivedInvoice, UserRole } from "../src/lib/types";

// Synthetic data for checking broken mail links and missing originals. Start the server with
// DATA_DIR=<root> and UPLOAD_DIR=<root>/uploads. Never point this at production data.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-mail-links-preview-"));
  const uploads = path.join(root, "uploads");
  await mkdir(uploads);
  const data = fixture();
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "MAIL_EDITOR"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.vendors[0].companyName = "株式会社テスト制作";
  data.vendors.push({ ...data.vendors[0], id: "vendor-power", companyName: "株式会社テスト電気", bankAliases: [] });
  const base = data.receivedInvoices[0];
  const invoice = (id: string, extra: Partial<ReceivedInvoice>): ReceivedInvoice => ({ ...base, id, status: "SCHEDULED", mailProcessed: false, folderMonth: "2026-10", issueDate: "2026-10-01", dueDate: "2026-10-31", createdAt: timestamp, updatedAt: timestamp, ocrText: "合成データ", ...extra });
  const url = (name: string) => `/uploads/received-invoices/${name}`;
  data.receivedInvoices = [
    invoice("inv-ok", { total: 88000, originalFileName: "制作費_9月.pdf", fileUrl: url("制作費_9月.pdf") }),
    invoice("inv-deleted", { total: 55000, vendorId: "vendor-power", originalFileName: "電気料金_10月.pdf", fileUrl: url("電気料金_10月.pdf"), deletedAt: "2026-10-30T00:00:00.000Z" }),
    invoice("inv-candidate", { total: 55000, vendorId: "vendor-power", originalFileName: "電気料金_10月.pdf", fileUrl: url("電気料金_10月_再登録.pdf"), memo: "再登録した書類" }),
    invoice("inv-other", { total: 12000, originalFileName: "消耗品_10月.pdf", fileUrl: url("消耗品_10月.pdf") }),
  ];
  const mailBase = data.mailDocuments[0];
  const mail = (id: string, extra: Partial<MailDocument>): MailDocument => ({ ...mailBase, id, company: "JAPAN", category: "INVOICE", folderMonth: "2026-10", mailProcessed: false, memo: undefined, ocrText: "合成データの郵便物", createdAt: timestamp, updatedAt: timestamp, ...extra });
  data.mailDocuments = [
    mail("mail-ok", { title: "制作費請求書", senderName: "株式会社テスト制作", originalFileName: "制作費_9月.pdf", fileUrl: url("制作費_9月.pdf"), relatedReceivedInvoiceId: "inv-ok" }),
    mail("mail-broken", { title: "電気料金のお知らせ", senderName: "株式会社テスト電気", originalFileName: "電気料金_10月.pdf", fileUrl: url("電気料金_10月.pdf"), relatedReceivedInvoiceId: "inv-deleted" }),
    mail("mail-unlinked", { title: "督促状", senderName: "テスト税務署", originalFileName: "督促状.pdf", fileUrl: url("督促状.pdf"), category: "NOTICE", relatedReceivedInvoiceId: undefined }),
    mail("mail-lost", { title: "原本が見つからない郵便物", senderName: "株式会社テスト制作", originalFileName: "紛失.pdf", fileUrl: url("紛失.pdf"), relatedReceivedInvoiceId: undefined }),
  ];
  data.attachments = [];
  for (const name of ["制作費_9月.pdf", "電気料金_10月.pdf", "電気料金_10月_再登録.pdf", "消耗品_10月.pdf", "督促状.pdf"]) await writeFile(path.join(uploads, name), "%PDF-1.4\n% synthetic placeholder\n");
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`UPLOAD_DIR=${uploads}`);
  console.log(`mails=${data.mailDocuments.length} invoices=${data.receivedInvoices.length} (1 broken link, 1 missing original)`);
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
