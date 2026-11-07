import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, manager, timestamp } from "./document-fixture";
import { bankReconciliationOverview } from "../src/lib/bank-reconciliation";
import { feeDifference, reconciliationAmountGap } from "../src/lib/bank-reconciliation-allocation";
import { addBankReceipt, assertBankReceiptAllowed, BANK_RECEIPT_LIMIT, BANK_RECEIPT_TYPE, bankReceipts, bankReceiptViews, canViewBankReceiptFile, removeBankReceipt } from "../src/lib/bank-receipts";
import { bankDisplayRows } from "../src/lib/banking";

const today = "2026-10-08";
function setup() {
  const data = fixture();
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "テスト銀行", serviceName: "三菱UFJ銀行", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
  data.bankTransactions = [{ id: "bank-income", company: "JAPAN", officeCode: "office", sourceId: "source-income", bankAccountId: "bank", side: "INCOME", amount: 12000, content: "Test customer INV-001", transactionDate: today, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp }];
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "bank-expense", sourceId: "source-expense", side: "EXPENSE", amount: 8000, content: "Test supplier" });
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "bank-cn", company: "CHINA", sourceId: "source-cn" });
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; });
  data.receivedInvoices[0].status = "SCHEDULED"; data.receivedInvoices[0].mailProcessed = false;
  return data;
}
const receipt = (transactionId = "bank-expense", fileUrl = "/api/files/receipt.pdf") => ({ transactionId, fileUrl, fileName: "レシート.pdf", mimeType: "application/pdf" });

test("reconciliation originals prefer the invoice file, then a linked mail scan, then the generated issued PDF", () => {
  const data = setup();
  const original = (key: string) => {
    const row = bankReconciliationOverview(data, "JAPAN", today).invoices.find((item) => item.key === key)!;
    return [row.originalSource, row.originalHref, row.originalMimeType];
  };
  assert.deepEqual(original("received:received-1"), ["invoice", "/api/files/received.pdf", ""]);
  data.receivedInvoices[0].fileUrl = undefined;
  data.mailDocuments[0].fileUrl = "/api/files/mail-scan.jpg"; data.mailDocuments[0].mimeType = "image/jpeg";
  assert.deepEqual(original("received:received-1"), ["mail", "/api/files/mail-scan.jpg", "image/jpeg"]);
  data.mailDocuments[0].deletedAt = timestamp;
  assert.deepEqual(original("received:received-1"), ["", "", ""]);
  assert.deepEqual(original("issued:issued-1"), ["invoice", "/api/files/issued.pdf", ""]);
  data.issuedInvoices[0].fileUrl = undefined;
  assert.deepEqual(original("issued:issued-1"), ["generated", "/api/issued-invoices/issued-1/pdf", "application/pdf"]);
});

test("amount gaps tell an exact match, a likely transfer fee and a short or over payment apart", () => {
  const view = bankReconciliationOverview(setup(), "JAPAN", today);
  const bank = view.banks.find((row) => row.id === "bank-income")!, invoice = view.invoices.find((row) => row.key === "issued:issued-1")!;
  assert.deepEqual(reconciliationAmountGap(bank, invoice), { kind: "exact", amount: 0, label: "金額一致" });
  const fee = reconciliationAmountGap({ ...bank, remaining: 11560 }, invoice);
  assert.equal(fee.kind, "fee"); assert.equal(fee.amount, 440); assert.equal(fee.amount, feeDifference({ ...bank, remaining: 11560 }, invoice));
  assert.deepEqual(reconciliationAmountGap({ ...bank, remaining: 6000 }, invoice).kind, "short");
  const over = reconciliationAmountGap({ ...bank, remaining: 20000 }, invoice);
  assert.equal(over.kind, "over"); assert.equal(over.amount, 8000);
  const expense = view.banks.find((row) => row.id === "bank-expense")!, received = view.invoices.find((row) => row.key === "received:received-1")!;
  assert.equal(reconciliationAmountGap({ ...expense, remaining: 8440 }, received).kind, "fee");
});

test("receipts attach only to an accessible row of the company and are counted on the ledger row", () => {
  const data = setup();
  addBankReceipt(data, admin, "JAPAN", receipt(), "r1", timestamp);
  assert.equal(data.attachments[0].relatedType, BANK_RECEIPT_TYPE);
  assert.deepEqual(bankReceiptViews(data, "JAPAN", "bank-expense").map((row) => [row.id, row.fileName]), [["r1", "レシート.pdf"]]);
  assert.equal(bankDisplayRows(data, data.bankTransactions).find((row) => row.id === "bank-expense")!.receiptCount, 1);
  assert.equal(bankDisplayRows(data, data.bankTransactions).find((row) => row.id === "bank-income")!.receiptCount, undefined);
  const before = structuredClone(data);
  assert.throws(() => addBankReceipt(data, manager, "JAPAN", receipt(), "r2"));
  assert.throws(() => addBankReceipt(data, admin, "JAPAN", receipt("bank-cn"), "r2"), /口座明細が見つかりません/);
  assert.throws(() => addBankReceipt(data, admin, "JAPAN", receipt("missing"), "r2"), /口座明細が見つかりません/);
  assert.throws(() => addBankReceipt(data, admin, "JAPAN", { ...receipt(), mimeType: "text/html" }, "r2"), /PDF、JPEG、PNG/);
  assert.deepEqual(data, before);
  for (let index = 1; index < BANK_RECEIPT_LIMIT; index++) addBankReceipt(data, admin, "JAPAN", receipt(), `extra-${index}`);
  assert.throws(() => assertBankReceiptAllowed(data, admin, "JAPAN", { transactionId: "bank-expense", mimeType: "image/png" }), /20件まで/);
});

test("removing a receipt is a soft delete that hides the row and stops serving the file", () => {
  const data = setup();
  addBankReceipt(data, admin, "JAPAN", receipt(), "r1", timestamp);
  assert.equal(canViewBankReceiptFile(data, admin, "receipt.pdf"), true);
  assert.equal(canViewBankReceiptFile(data, manager, "receipt.pdf"), false);
  assert.equal(canViewBankReceiptFile(data, admin, "other.pdf"), false);
  assert.throws(() => removeBankReceipt(data, manager, "JAPAN", "r1"));
  assert.throws(() => removeBankReceipt(data, admin, "JAPAN", "attachment-1"), /見つかりません/);
  removeBankReceipt(data, admin, "JAPAN", "r1", timestamp);
  assert.equal(data.attachments.find((row) => row.id === "r1")!.deletedAt, timestamp);
  assert.deepEqual(bankReceipts(data, "JAPAN", "bank-expense"), []);
  assert.equal(canViewBankReceiptFile(data, admin, "receipt.pdf"), false);
  assert.throws(() => removeBankReceipt(data, admin, "JAPAN", "r1"), /見つかりません/);
});
