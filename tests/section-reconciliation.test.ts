import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, manager, timestamp } from "./document-fixture";
import { bankReconciliationOverview, confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import { invoiceBankCandidates, reconciliationCandidates } from "../src/lib/bank-reconciliation-matching";
import { linkableMail, linkMailToBank, mailBankLinks } from "../src/lib/bank-document-links";
import { bankReceiptViews, canViewBankReceiptFile, removeBankReceipt } from "../src/lib/bank-receipts";
import type { BankTransaction } from "../src/lib/banking-types";

const today = "2026-10-08";
function setup() {
  const data = fixture();
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "テスト銀行", serviceName: "三菱UFJ銀行", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
  const row = (id: string, side: "INCOME" | "EXPENSE", amount: number, content: string, date = today, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: "bank", side, amount, content, transactionDate: date,
    sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
  data.bankTransactions = [
    row("pay-exact", "INCOME", 12000, "Test customer INV-001"),
    row("pay-other", "INCOME", 12000, "Test customer INV-002"),
    row("pay-unrelated", "INCOME", 777, "Somebody else", "2026-01-01"),
    row("out-supplier", "EXPENSE", 8000, "Test supplier"),
    row("cn", "INCOME", 12000, "Test customer INV-001", today, { company: "CHINA" }),
  ];
  data.issuedInvoices.forEach((invoice) => { invoice.status = "ISSUED"; invoice.needsReview = false; });
  data.receivedInvoices[0].status = "SCHEDULED"; data.receivedInvoices[0].mailProcessed = false;
  return data;
}

test("bank rows for an invoice come with the same confidence the bank side would show", () => {
  const data = setup(), view = bankReconciliationOverview(data, "JAPAN", today);
  const issued = invoiceBankCandidates(view.banks, view.invoices, "issued:issued-1");
  assert.deepEqual(issued.map((row) => row.bankId), ["pay-exact", "pay-other"]);
  assert.equal(issued[0].confidence, reconciliationCandidates(view.banks.find((row) => row.id === "pay-exact")!, view.invoices).find((row) => row.key === "issued:issued-1")!.confidence);
  // INV-002 in the description points at the other invoice, so this row is demoted for INV-001 exactly as on the bank side.
  assert.equal(issued[1].confidence, "review");
  assert.ok(issued[1].warnings.includes("別の請求書番号が摘要に一致"));
  assert.ok(!issued.some((row) => row.bankId === "cn" || row.bankId === "out-supplier"));
  assert.deepEqual(invoiceBankCandidates(view.banks, view.invoices, "received:received-1").map((row) => row.bankId), ["out-supplier"]);
  assert.deepEqual(invoiceBankCandidates(view.banks, view.invoices, "issued:missing"), []);
});

test("fully reconciled rows drop out of an invoice's candidates", () => {
  const data = setup(), bank = data.bankTransactions[0], invoice = data.issuedInvoices[0];
  confirmBankReconciliation(data, admin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: "issued", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, amount: 12000, mode: "new", acknowledged: true }, today);
  const view = bankReconciliationOverview(data, "JAPAN", today);
  assert.ok(!invoiceBankCandidates(view.banks, view.invoices, "issued:issued-2").some((row) => row.bankId === bank.id));
});

test("mail links to a bank row as evidence only, once per row, within the company", () => {
  const data = setup(), mail = data.mailDocuments[0];
  mail.company = "JAPAN"; mail.category = "RECEIPT"; mail.fileUrl = "/api/files/mail-receipt.pdf"; mail.mimeType = "application/pdf";
  const reconciliations = structuredClone(data.bankReconciliations), payments = structuredClone(data.payments);
  linkMailToBank(data, admin, "JAPAN", { transactionId: "out-supplier", mailId: mail.id }, "link-1", timestamp);
  assert.deepEqual(data.bankReconciliations, reconciliations);
  assert.deepEqual(data.payments, payments);
  assert.deepEqual(mailBankLinks(data, "JAPAN", mail.id).map((row) => [row.id, row.relatedId, row.fileUrl]), [["link-1", "out-supplier", "/api/files/mail-receipt.pdf"]]);
  const view = bankReceiptViews(data, "JAPAN", "out-supplier")[0];
  assert.equal(view.source?.kind, "mail"); assert.equal(view.source?.id, mail.id); assert.equal(view.source?.deleted, false);
  assert.equal(view.source?.href, `/documents?company=JAPAN&document=${encodeURIComponent(`mail:${mail.id}`)}`);
  assert.ok(!linkableMail(data, "JAPAN", "out-supplier").some((row) => row.id === mail.id));
  assert.ok(linkableMail(data, "JAPAN", "pay-exact").some((row) => row.id === mail.id));
  assert.equal(canViewBankReceiptFile(data, admin, "mail-receipt.pdf"), true);

  const before = structuredClone(data);
  assert.throws(() => linkMailToBank(data, admin, "JAPAN", { transactionId: "out-supplier", mailId: mail.id }, "link-2"), /すでに/);
  assert.throws(() => linkMailToBank(data, manager, "JAPAN", { transactionId: "pay-exact", mailId: mail.id }, "link-2"));
  assert.throws(() => linkMailToBank(data, admin, "JAPAN", { transactionId: "cn", mailId: mail.id }, "link-2"), /口座明細が見つかりません/);
  assert.throws(() => linkMailToBank(data, admin, "JAPAN", { transactionId: "pay-exact", mailId: "missing" }, "link-2"), /郵便物が見つかりません/);
  assert.deepEqual(data, before);

  removeBankReceipt(data, admin, "JAPAN", "link-1", timestamp);
  assert.deepEqual(mailBankLinks(data, "JAPAN", mail.id), []);
  assert.ok(linkableMail(data, "JAPAN", "out-supplier").some((row) => row.id === mail.id));
  // The mail's own record is untouched by unlinking.
  assert.equal(data.mailDocuments[0].deletedAt, undefined);
});

test("a deleted mail keeps its link visible but marked, and cannot be linked again", () => {
  const data = setup(), mail = data.mailDocuments[0];
  mail.company = "JAPAN"; mail.fileUrl = "/api/files/scan.pdf";
  linkMailToBank(data, admin, "JAPAN", { transactionId: "out-supplier", mailId: mail.id }, "link-1", timestamp);
  mail.deletedAt = timestamp;
  assert.equal(bankReceiptViews(data, "JAPAN", "out-supplier")[0].source?.deleted, true);
  assert.throws(() => linkMailToBank(data, admin, "JAPAN", { transactionId: "pay-exact", mailId: mail.id }, "link-2"), /郵便物が見つかりません/);
  assert.ok(!linkableMail(data, "JAPAN", "pay-exact").some((row) => row.id === mail.id));
});
