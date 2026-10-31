import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp, admin } from "./document-fixture";
import { confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import type { BankTransaction } from "../src/lib/banking-types";
import type { UserRole } from "../src/lib/types";

// Synthetic data for checking which edits flag a reconciliation and the "内容を確認して照合を維持" action.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-reconciliation-review-preview-"));
  const data = fixture();
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "テスト銀行 / 普通預金", serviceName: "三菱UFJ銀行", isManual: false, available: true,
    forecastSettings: { accountKind: "BANK", balanceMonth: "2026-10", minimumBalance: 0, incomePercent: 0, expensePercent: 0 }, createdAt: timestamp, updatedAt: timestamp }];
  const issued = data.issuedInvoices[0], received = data.receivedInvoices[0];
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; });
  received.status = "SCHEDULED"; received.mailProcessed = false;
  data.vendors.push({ ...data.vendors[0], id: "vendor-2", companyName: "株式会社テスト電気", accountHolder: "カ）テストデンキ", bankAliases: [] });
  data.clients[0].companyName = "株式会社テストデザイン";
  data.vendors[0].companyName = "株式会社テスト制作";
  data.projects.push({ ...data.projects[0], id: "project-2", name: "別案件 / 内装監理" });
  const second = { ...received, id: "received-2", vendorId: "vendor-2", total: 55000, subtotal: 50000, taxTotal: 5000, originalFileName: "電気料金_10月.pdf", memo: undefined, createdAt: timestamp, updatedAt: timestamp };
  data.receivedInvoices.push(second);
  const base = { company: "JAPAN" as const, officeCode: "office", bankAccountId: "bank", transactionDate: "2026-10-05", sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL" as const, classificationSource: "UNASSIGNED" as const, reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp };
  data.bankTransactions = [
    { ...base, id: "in-1", sourceId: "in-1", side: "INCOME", amount: issued.total, content: "カ）テストデザイン 設計料" },
    { ...base, id: "out-1", sourceId: "out-1", side: "EXPENSE", amount: received.total, content: "カ）テストセイサク" },
    { ...base, id: "out-2", sourceId: "out-2", side: "EXPENSE", amount: 55000, content: "テストデンキ 10ガツブン" },
  ] satisfies BankTransaction[];
  const confirm = (bankId: string, kind: "issued" | "received", invoiceId: string, amount: number) => {
    const bank = data.bankTransactions.find((row) => row.id === bankId)!;
    const invoice = (kind === "issued" ? data.issuedInvoices : data.receivedInvoices).find((row) => row.id === invoiceId)!;
    confirmBankReconciliation(data, admin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: kind, invoiceId, invoiceUpdatedAt: invoice.updatedAt, mode: "new", amount, acknowledged: true, note: "合成データ" });
  };
  confirm("in-1", "issued", issued.id, issued.total);
  confirm("out-1", "received", received.id, received.total);
  confirm("out-2", "received", second.id, 55000);
  // A: bank description corrected after the match -> flagged, can be kept.
  data.bankTransactions[0].content = "カ）テストデザイン 設計料（訂正）";
  // B: project, vendor, memo and an eligible status edited -> must stay matched.
  Object.assign(received, { projectId: "project-2", vendorId: "vendor-2", memo: "案件と支払先を修正", status: "APPROVAL_PENDING", updatedAt: new Date().toISOString() });
  // C: payment amount reduced below the matched amount -> flagged, cannot be kept.
  const payment = data.payments.find((row) => row.receivedInvoiceId === second.id)!;
  payment.amount = 50000; payment.updatedAt = new Date().toISOString();
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
  console.log(`links=${data.bankReconciliations.length} payments=${data.payments.length}`);
  console.log("login: admin@example.invalid / local-banking-test-only (synthetic only)");
}

main().catch((error) => { console.error(error); process.exit(1); });
