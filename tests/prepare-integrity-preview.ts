import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, sourceKey } from "../src/lib/banking";
import { GUESS_ACKNOWLEDGED_PREFIX } from "../src/lib/bank-classification";
import { confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import type { BankTransaction } from "../src/lib/banking-types";
import type { UserRole } from "../src/lib/types";

// Synthetic data for /banking/integrity: one or two hits of every kind. Start the server with
// DATA_DIR=<root> and UPLOAD_DIR=<root>/uploads. Never point this at production data.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-integrity-preview-"));
  const uploads = path.join(root, "uploads");
  await mkdir(uploads);
  const data = fixture(), office = "0000-0001", today = "2026-10-28";
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.clients[0].companyName = "株式会社テストデザイン";
  data.vendors[0].companyName = "株式会社テスト制作";
  data.projects[0].name = "青山ショールーム / 設計";
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; row.issueDate = "2026-09-01"; row.dueDate = "2026-09-30"; row.total = 12000; row.subtotal = 12000; });
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行 / 普通預金", serviceName: "三菱UFJ銀行", isManual: false }], [
    { id: "sales", name: "売上高", group: "INCOME", available: true }, { id: "other-income", name: "雑収入", group: "INCOME", available: true },
    { id: "misc", name: "雑費", group: "EXPENSE", available: true }, { id: "supplies", name: "消耗品費", group: "EXPENSE", available: true }, { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
  ]);
  const cat = (id: string) => sourceKey("JAPAN", office, "category", id), account = sourceKey("JAPAN", office, "account", "bank");
  const row = (id: string, date: string, amount: number, content: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id: sourceKey("JAPAN", office, "transaction", id), company: "JAPAN", officeCode: office, sourceId: id, bankAccountId: account, transactionDate: date, amount, side: "EXPENSE", content, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "MANUAL", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
  data.bankTransactions = [
    row("guess-reviewed", "2026-10-02", 3300, "用途不明 テスト購入", { categoryId: cat("misc"), reviewed: true, classificationConfidence: "GUESS", classificationReason: "確認済み履歴・明確な摘要の根拠なし。仮候補" }),
    row("guess-acknowledged", "2026-10-03", 1980, "AMAZON テスト購入", { categoryId: cat("misc"), reviewed: true, classificationConfidence: "GUESS", classificationReason: `${GUESS_ACKNOWLEDGED_PREFIX}: 仮候補` }),
    row("undecided", "2026-10-04", 5500, "テスト文具 購入", { categoryId: cat("supplies"), reviewed: true, bookkeeping: { invoiceRequirement: "UNDECIDED" } }),
    row("held", "2026-10-05", 8800, "テスト工務店 支払", { categoryId: cat("misc"), reviewed: true, bookkeeping: { hold: { reason: "MISSING_DOCUMENT", question: "請求書の原本が未着" }, invoiceRequirement: "REQUIRED" } }),
    row("spread-a", "2026-09-10", 2200, "テスト文具 購入", { categoryId: cat("misc"), reviewed: true }),
    row("transfer-lonely", "2026-10-06", 100000, "振替 テスト定期預金", { treatment: "TRANSFER", reviewed: true }),
    row("aplus", "2026-10-07", 45000, "口座振替 APアプラス", { treatment: "TRANSFER", reviewed: true }),
    row("income-misc", "2026-10-08", 12000, "カ）テストデザイン INV-001 入金", { side: "INCOME", categoryId: cat("other-income") }),
    row("income-sales", "2026-10-09", 12000, "カ）テストデザイン INV-002 入金", { side: "INCOME", categoryId: cat("sales"), reviewed: true }),
  ];
  const find = (sourceId: string) => data.bankTransactions.find((item) => item.sourceId === sourceId)!;
  for (const [sourceId, invoice] of [["income-misc", data.issuedInvoices[0]], ["income-sales", data.issuedInvoices[1]]] as const) {
    const bank = find(sourceId);
    confirmBankReconciliation(data, admin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: "issued", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, amount: 12000, mode: "new", acknowledged: true }, today);
  }
  // Conflict: the second invoice changed after reconciliation.
  data.issuedInvoices[1].total = 15000; data.issuedInvoices[1].subtotal = 15000;
  // Received invoice: PAID by a legacy status payment, plus an extra manual payment that exceeds the total.
  data.receivedInvoices[0].status = "PAID"; data.receivedInvoices[0].total = 8000; data.receivedInvoices[0].originalFileName = "制作費_9月.pdf"; data.receivedInvoices[0].fileUrl = "/uploads/received-invoices/制作費_9月.pdf";
  data.payments.push(
    { id: "legacy-pay", type: "EXPENSE", receivedInvoiceId: data.receivedInvoices[0].id, amount: 8000, paymentDate: "2026-09-25", method: "ステータス変更", memo: "ステータス変更で支払済み", createdById: "admin", createdAt: timestamp, updatedAt: timestamp },
    { id: "extra-pay", type: "EXPENSE", receivedInvoiceId: data.receivedInvoices[0].id, amount: 1200, paymentDate: "2026-09-26", source: "MANUAL", method: "振込", createdById: "admin", createdAt: timestamp, updatedAt: timestamp },
  );
  data.mailDocuments[0].fileUrl = "/uploads/received-invoices/制作費_9月.pdf"; data.mailDocuments[0].originalFileName = "制作費_9月.pdf";
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "mail-broken", title: "電気料金のお知らせ", relatedReceivedInvoiceId: "deleted-invoice", fileUrl: "/uploads/received-invoices/電気料金_10月.pdf", originalFileName: "電気料金_10月.pdf", mailProcessed: false, folderMonth: "2026-10" });
  data.attachments = [];
  await writeFile(path.join(uploads, "制作費_9月.pdf"), "%PDF-1.4\n% synthetic placeholder\n");
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`UPLOAD_DIR=${uploads}`);
  console.log("expected: conflict 1, payment mismatch 1 (overpaid), mail broken+missing 2, reviewed guess 1, undecided/held 2, income not sales 1, paid without bank 2, category spread 1, transfer lonely 1");
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
