import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions, saveBankEdits, sourceKey } from "../src/lib/banking";
import { confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import type { UserRole } from "../src/lib/types";

// Synthetic data for checking the guess-review guard and the sales-category hint on /banking.
// Start the server with DATA_DIR=<root> and UPLOAD_DIR=<root>/uploads. Never point this at production data.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-review-guard-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = fixture(), office = "0000-0001", today = "2026-10-28";
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.clients[0].companyName = "株式会社テストデザイン";
  data.projects[0].name = "青山ショールーム / 設計";
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; row.issueDate = "2026-09-01"; row.dueDate = "2026-09-30"; row.total = 12000; row.subtotal = 12000; });
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行 / 普通預金", serviceName: "三菱UFJ銀行", isManual: false }], [
    { id: "sales", name: "売上高", group: "INCOME", available: true },
    { id: "other-income", name: "雑収入", group: "INCOME", available: true },
    { id: "misc", name: "雑費", group: "EXPENSE", available: true },
    { id: "supplies", name: "消耗品費", group: "EXPENSE", available: true },
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
  ]);
  const item = (id: string, date: string, value: number, side: "INCOME" | "EXPENSE", content: string) => ({ id, connected_account_id: "bank", date, value, side, content, memo: null, journalizing_status: "none" });
  mergeBankTransactions(data, "JAPAN", office, [
    item("guess-1", "2026-10-02", 3300, "EXPENSE", "用途不明 テスト購入 1"),
    item("guess-2", "2026-10-03", 1980, "EXPENSE", "AMAZON テスト購入"),
    item("guess-3", "2026-10-06", 5500, "EXPENSE", "用途不明 テスト購入 3"),
    item("inferred", "2026-10-07", 440, "EXPENSE", "振込手数料"),
    item("income-unset", "2026-10-08", 12000, "INCOME", "カ）テストデザイン INV-001 入金"),
    item("income-misc", "2026-10-09", 12000, "INCOME", "カ）テストデザイン INV-002 入金"),
    item("income-free", "2026-10-10", 7000, "INCOME", "テスト 未照合の入金"),
  ], { start: "2026-10-01", end: "2026-10-31" });
  const find = (sourceId: string) => data.bankTransactions.find((row) => row.sourceId === sourceId)!;
  for (const [sourceId, invoiceId] of [["income-unset", data.issuedInvoices[0].id], ["income-misc", data.issuedInvoices[1].id]] as const) {
    const bank = find(sourceId), invoice = data.issuedInvoices.find((row) => row.id === invoiceId)!;
    confirmBankReconciliation(data, admin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: "issued", invoiceId, invoiceUpdatedAt: invoice.updatedAt, amount: 12000, mode: "new", acknowledged: true }, today);
  }
  const misc = find("income-misc");
  saveBankEdits(data, admin, "JAPAN", [{ id: misc.id, updatedAt: misc.updatedAt, categoryId: sourceKey("JAPAN", office, "category", "other-income"), treatment: "NORMAL", reviewed: false, memo: "雑収入のまま保存した入金" }]);
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`UPLOAD_DIR=${path.join(root, "uploads")}`);
  console.log(`rows=${data.bankTransactions.length} (3 guesses, 1 inferred, 2 reconciled incomes: category unset / 雑収入, 1 unreconciled income)`);
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
