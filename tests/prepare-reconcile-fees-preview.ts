import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, sourceKey } from "../src/lib/banking";
import type { BankTransaction } from "../src/lib/banking-types";
import type { UserRole } from "../src/lib/types";

// Synthetic data for the fee-difference and withholding checks on /banking/reconcile.
// Start the server with DATA_DIR=<root> and UPLOAD_DIR=<root>/uploads. Never point this at production data.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-fees-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = fixture(), office = "0000-0001";
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.clients[0].companyName = "株式会社テストデザイン";
  data.vendors[0].companyName = "株式会社テスト制作"; data.vendors[0].accountHolder = "カ）テストセイサク";
  data.projects[0].name = "青山ショールーム / 設計";
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; row.issueDate = "2026-09-01"; row.dueDate = "2026-09-30"; });
  data.issuedInvoices[0].total = 330000; data.issuedInvoices[0].subtotal = 300000; data.issuedInvoices[0].taxTotal = 30000;
  data.issuedInvoices[1].total = 110000; data.issuedInvoices[1].subtotal = 100000; data.issuedInvoices[1].taxTotal = 10000;
  const received = data.receivedInvoices[0];
  Object.assign(received, { status: "SCHEDULED", mailProcessed: false, total: 88000, subtotal: 80000, taxTotal: 8000, issueDate: "2026-09-01", dueDate: "2026-09-30", originalFileName: "制作費_9月.pdf" });
  data.mailDocuments[0].mailProcessed = false;
  data.receivedInvoices.push({ ...received, id: "received-withholding", originalFileName: "デザイン料_源泉あり.pdf", subtotal: 100000, taxTotal: 10000, grossAmount: 110000, withholdingAmount: 10210, total: 110000, fileUrl: "/api/files/withholding.pdf" });
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行 / 普通預金", serviceName: "三菱UFJ銀行", isManual: false }], [
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true }, { id: "outsourcing", name: "外注費", group: "EXPENSE", available: true }, { id: "misc", name: "雑費", group: "EXPENSE", available: true }, { id: "sales", name: "売上高", group: "INCOME", available: true },
  ]);
  const account = sourceKey("JAPAN", office, "account", "bank");
  const row = (id: string, date: string, amount: number, side: "INCOME" | "EXPENSE", content: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id: sourceKey("JAPAN", office, "transaction", id), company: "JAPAN", officeCode: office, sourceId: id, bankAccountId: account, transactionDate: date, amount, side, content, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
  data.bankTransactions = [
    row("income-short", "2026-10-05", 329340, "INCOME", "カ）テストデザイン INV-001"),
    row("income-exact", "2026-10-06", 110000, "INCOME", "カ）テストデザイン INV-002"),
    row("expense-plus", "2026-10-07", 88660, "EXPENSE", "振込 カ）テストセイサク", { categoryId: sourceKey("JAPAN", office, "category", "outsourcing"), classificationSource: "MANUAL" }),
    row("expense-net", "2026-10-08", 99790, "EXPENSE", "振込 カ）テストセイサク デザイン料"),
  ];
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`UPLOAD_DIR=${path.join(root, "uploads")}`);
  console.log("income-short 329,340 vs INV-001 330,000 (fee 660 payer) / expense-plus 88,660 vs 制作費 88,000 (fee 660 bank, row has 外注費) / expense-net 99,790 vs withholding invoice (total 110,000 vs net 99,790)");
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
