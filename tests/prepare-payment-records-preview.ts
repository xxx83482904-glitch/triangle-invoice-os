import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp, admin } from "./document-fixture";
import { confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import { recordPayment } from "../src/lib/payment-records";
import type { ReceivedInvoice, UserRole } from "../src/lib/types";

// Synthetic data for checking the payment-record panel on received invoices. Never point this at production data.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-payment-records-preview-"));
  const data = fixture();
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.vendors[0].companyName = "株式会社テスト制作";
  data.vendors.push({ ...data.vendors[0], id: "vendor-tax", companyName: "テスト税務署", bankAliases: [] }, { ...data.vendors[0], id: "vendor-power", companyName: "株式会社テスト電気", bankAliases: [] });
  const base = data.receivedInvoices[0];
  const make = (id: string, extra: Partial<ReceivedInvoice>): ReceivedInvoice => ({ ...base, id, status: "SCHEDULED", mailProcessed: false, folderMonth: "2026-10", issueDate: "2026-10-01", dueDate: "2026-10-31", createdAt: timestamp, updatedAt: timestamp, ocrText: undefined, ...extra });
  data.receivedInvoices = [
    make("inv-unpaid", { vendorId: "vendor-power", total: 55000, subtotal: 50000, taxTotal: 5000, originalFileName: "電気料金_10月.pdf" }),
    make("inv-legacy", { vendorId: "vendor-tax", total: 120000, subtotal: 120000, taxTotal: 0, status: "PAID", originalFileName: "督促状_法人税.pdf", memo: "督促中。実際は未払い" }),
    make("inv-bank", { vendorId: base.vendorId, total: 88000, subtotal: 80000, taxTotal: 8000, originalFileName: "制作費_9月.pdf" }),
    make("inv-overpaid", { vendorId: base.vendorId, total: 10000, subtotal: 10000, taxTotal: 0, originalFileName: "消耗品_契約番号誤読.pdf", memo: "契約番号 12345678 を金額と読み違えた" }),
  ];
  data.mailDocuments = [];
  // Legacy auto-created record from the retired status flow (no bank evidence).
  data.payments.push({ id: "pay-legacy", type: "EXPENSE", receivedInvoiceId: "inv-legacy", amount: 120000, paymentDate: "2026-10-15", method: "ステータス変更", memo: "ステータス変更で支払済みにしました", createdById: "admin", createdAt: "2026-10-15T01:00:00.000Z", updatedAt: "2026-10-15T01:00:00.000Z" });
  // Legacy manual record larger than the corrected invoice total.
  data.payments.push({ id: "pay-over", type: "EXPENSE", receivedInvoiceId: "inv-overpaid", amount: 12345678, paymentDate: "2026-10-10", method: "銀行振込", createdById: "admin", createdAt: "2026-10-10T01:00:00.000Z", updatedAt: "2026-10-10T01:00:00.000Z" });
  // Bank-reconciled record.
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "テスト銀行 / 普通預金", serviceName: "三菱UFJ銀行", isManual: false, available: true,
    forecastSettings: { accountKind: "BANK", balanceMonth: "2026-10", minimumBalance: 0, incomePercent: 0, expensePercent: 0 }, createdAt: timestamp, updatedAt: timestamp }];
  data.bankTransactions = [{ id: "out-1", company: "JAPAN", officeCode: "office", sourceId: "out-1", bankAccountId: "bank", transactionDate: "2026-10-05", amount: 88000, side: "EXPENSE", content: "カ）テストセイサク", sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp }];
  const bankInvoice = data.receivedInvoices.find((row) => row.id === "inv-bank")!;
  confirmBankReconciliation(data, admin, "JAPAN", { transactionId: "out-1", transactionUpdatedAt: timestamp, invoiceKind: "received", invoiceId: bankInvoice.id, invoiceUpdatedAt: bankInvoice.updatedAt, mode: "new", amount: 88000, acknowledged: true, note: "合成データ" });
  // One explicit manual partial payment on the unpaid invoice.
  recordPayment(data, admin, "JAPAN", { kind: "received", invoiceId: "inv-unpaid", amount: 5000, paymentDate: "2026-10-20", method: "現金", memo: "一部を現金で", reason: "領収書あり" }, "2026-10-31");
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`invoices=${data.receivedInvoices.length} payments=${data.payments.length} links=${data.bankReconciliations.length}`);
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
