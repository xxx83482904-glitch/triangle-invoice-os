import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, sourceKey } from "../src/lib/banking";
import type { BankTransaction } from "../src/lib/banking-types";
import type { UserRole } from "../src/lib/types";

// Synthetic data for the P2-13〜17 screens: repeated descriptions (bulk reclassify), payroll rows, a fee-gapped transfer pair,
// two invoices that add up to one receipt, and tax/insurance documents. Never point this at production data.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-p2-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = fixture(), office = "0000-0001";
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.clients[0].companyName = "株式会社テストデザイン";
  data.vendors[0].companyName = "株式会社テスト制作";
  data.vendors.push({ ...data.vendors[0], id: "vendor-tax", companyName: "麹町税務署" }, { ...data.vendors[0], id: "vendor-pension", companyName: "日本年金機構" });
  data.projects[0].name = "青山ショールーム / 設計";
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; row.issueDate = "2026-09-01"; row.dueDate = "2026-09-30"; });
  data.issuedInvoices[0].total = 110000; data.issuedInvoices[0].subtotal = 100000; data.issuedInvoices[0].taxTotal = 10000;
  data.issuedInvoices[1].total = 55000; data.issuedInvoices[1].subtotal = 50000; data.issuedInvoices[1].taxTotal = 5000;
  const received = data.receivedInvoices[0];
  Object.assign(received, { status: "SCHEDULED", mailProcessed: false, total: 88000, subtotal: 80000, taxTotal: 8000, issueDate: "2026-09-01", dueDate: "2026-09-30", originalFileName: "制作費_9月.pdf" });
  data.mailDocuments[0].mailProcessed = false;
  data.receivedInvoices.push(
    { ...received, id: "tax-withholding", vendorId: "vendor-tax", originalFileName: "源泉所得税_納付書_9月.pdf", total: 32000, subtotal: 32000, taxTotal: 0, dueDate: "2026-10-10" },
    { ...received, id: "pension", vendorId: "vendor-pension", originalFileName: "保険料納入告知書_10月.pdf", total: 184000, subtotal: 184000, taxTotal: 0, dueDate: "2026-11-02" },
  );
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-tax", title: "法人都民税の納付について", senderName: "東京都主税局", category: "NOTICE", relatedReceivedInvoiceId: undefined, mailProcessed: false, folderMonth: "2026-10", fileUrl: "/api/files/notice.pdf", originalFileName: "都税_通知.pdf" });
  data.attachments = [];
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行 / 普通預金", serviceName: "三菱UFJ銀行", isManual: false }, { id: "yucho", name: "テスト ゆうちょ銀行", serviceName: "ゆうちょ銀行", isManual: false }], [
    { id: "misc", name: "雑費", group: "EXPENSE", available: true }, { id: "outsourcing", name: "外注費", group: "EXPENSE", available: true }, { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
    { id: "salary", name: "給料手当", group: "EXPENSE", available: true }, { id: "officer", name: "役員報酬", group: "EXPENSE", available: true }, { id: "sales", name: "売上高", group: "INCOME", available: true },
  ]);
  const cat = (id: string) => sourceKey("JAPAN", office, "category", id), account = (id: string) => sourceKey("JAPAN", office, "account", id);
  const row = (id: string, date: string, amount: number, side: "INCOME" | "EXPENSE", content: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id: sourceKey("JAPAN", office, "transaction", id), company: "JAPAN", officeCode: office, sourceId: id, bankAccountId: account("bank"), transactionDate: date, amount, side, content, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "MANUAL", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
  data.bankTransactions = [
    row("bulk-1", "2026-08-10", 33000, "EXPENSE", "振込 カ）テストセイサク", { categoryId: cat("misc"), reviewed: true }),
    row("bulk-2", "2026-09-10", 33000, "EXPENSE", "振込 カ）テストセイサク", { categoryId: cat("misc") }),
    row("bulk-3", "2026-10-09", 44000, "EXPENSE", "振込 カ）テストセイサク", { categoryId: cat("outsourcing") }),
    row("pay-1", "2026-09-25", 250000, "EXPENSE", "給与振込 ヤマダ タロウ 9月分", { categoryId: cat("salary"), reviewed: true }),
    row("pay-2", "2026-10-23", 255000, "EXPENSE", "給与振込 ヤマダ タロウ 10月分", { categoryId: cat("salary"), reviewed: true }),
    row("pay-3", "2026-10-23", 400000, "EXPENSE", "振込 スズキ ハナコ", { categoryId: cat("officer"), reviewed: true }),
    row("tr-out", "2026-10-15", 200660, "EXPENSE", "振込 ゆうちょ 資金移動"),
    row("tr-in", "2026-10-15", 200000, "INCOME", "振込 ミツビシUFJ", { bankAccountId: account("yucho") }),
    row("combo", "2026-10-20", 165000, "INCOME", "カ）テストデザイン 入金"),
  ];
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`UPLOAD_DIR=${path.join(root, "uploads")}`);
  console.log("bulk: 3 rows 振込 カ）テストセイサク (雑費×2 incl. reviewed, 外注費×1) / payroll: 3 rows / transfer: 200,660 out vs 200,000 in (fee 660) / combo: 165,000 = 110,000 + 55,000 / tax: 2 invoices + 1 notice mail");
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
