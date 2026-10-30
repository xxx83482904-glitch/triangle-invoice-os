import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { bankTransferDetail, bankTransferIssue, confirmBankTransfer, removeBankTransfer, type TransferInput } from "../src/lib/bank-transfers";
import { bankFilters, saveBankEdits, selectBankTransactions } from "../src/lib/banking";
import { bankForecastEvidence } from "../src/lib/bank-forecast";
import { bankReconciliationOverview, confirmBankReconciliation } from "../src/lib/bank-reconciliation";
import type { BankEdit } from "../src/lib/banking-types";
import { restoreUndoState } from "../src/lib/store";
import { bankingDataRevision } from "../src/lib/banking-revision";
import { saveBankBookkeeping, type BankBookkeeping } from "../src/lib/bank-bookkeeping";

const today = "2026-10-27";
function setup() {
  const data = fixture(); data.bankTransfers = [];
  data.bankAccounts = ["from", "to"].map((id) => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, name: `Bank ${id}`, serviceName: "三菱UFJ銀行", isManual: false, available: true, forecastSettings: { accountKind: "BANK", balanceMonth: "2026-10", minimumBalance: 0, incomePercent: 0, expensePercent: 0 }, createdAt: timestamp, updatedAt: timestamp }));
  data.bankTransactions = data.bankAccounts.map((account, i) => ({ id: account.id, bankAccountId: account.id, company: "JAPAN", officeCode: "office", sourceId: account.id, side: i ? "INCOME" : "EXPENSE", amount: 12000, transactionDate: "2026-10-20", content: "口座振替", sourceMemo: "", sourceStatus: "none", sourceMissing: false, classificationSource: "UNASSIGNED", treatment: "NORMAL", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp }));
  data.issuedInvoices[0].status = "ISSUED";
  return data;
}
function input(data: ReturnType<typeof setup>): TransferInput {
  return { transactionId: "from", transactionUpdatedAt: data.bankTransactions[0].updatedAt, counterpartId: "to", counterpartUpdatedAt: data.bankTransactions[1].updatedAt, acknowledged: true };
}
const confirm = (data: ReturnType<typeof setup>) => confirmBankTransfer(data, admin, "JAPAN", input(data), today);

const splitBookkeeping: BankBookkeeping = { splits: [
  { id: "principal", categoryId: "category", amount: 10000, memo: "principal" },
  { id: "fee", categoryId: "category", amount: 2000, memo: "fee" },
] };
const heldBookkeeping: BankBookkeeping = { hold: { reason: "AMOUNT_MISMATCH", question: "Confirm the amount before linking" } };

test("split and held rows on either side are not transfer candidates and fail atomically", () => {
  for (const bookkeeping of [splitBookkeeping, heldBookkeeping, { ...splitBookkeeping, ...heldBookkeeping }, { splits: splitBookkeeping.splits!.slice(0, 1) }]) {
    for (const index of [0, 1]) {
      const data = setup(), blocked = data.bankTransactions[index], other = data.bankTransactions[1 - index];
      blocked.bookkeeping = structuredClone(bookkeeping);
      const before = JSON.stringify(data);
      const pattern = bookkeeping.hold ? /保留/ : /分割/;
      assert.match(bankTransferDetail(data, "JAPAN", blocked.id, today).issue, pattern);
      assert.deepEqual(bankTransferDetail(data, "JAPAN", blocked.id, today).candidates, []);
      assert.deepEqual(bankTransferDetail(data, "JAPAN", other.id, today).candidates, []);
      assert.throws(() => confirm(data), pattern);
      const request = input(data);
      assert.throws(() => confirmBankTransfer(data, admin, "JAPAN", {
        transactionId: request.counterpartId, transactionUpdatedAt: request.counterpartUpdatedAt,
        counterpartId: request.transactionId, counterpartUpdatedAt: request.transactionUpdatedAt, acknowledged: true,
      }, today), pattern);
      assert.equal(JSON.stringify(data), before);
    }
  }
});

test("resolving bookkeeping allows transfers only with fresh versions and preserves remaining metadata", () => {
  for (const bookkeeping of [splitBookkeeping, heldBookkeeping, { ...splitBookkeeping, ...heldBookkeeping }]) {
    for (const index of [0, 1]) {
      const data = setup(), row = data.bankTransactions[index];
      row.bookkeeping = structuredClone(bookkeeping);
      const stale = input(data);
      const saved = saveBankBookkeeping(data, admin, "JAPAN", {
        id: row.id, updatedAt: row.updatedAt, splits: [], hold: null,
        invoiceRequirement: "NOT_REQUIRED", memo: "Resolved explicitly", reviewed: false,
      }).transaction;
      assert.notEqual(saved.updatedAt, stale.transactionUpdatedAt);
      const before = JSON.stringify(data);
      assert.throws(() => confirmBankTransfer(data, admin, "JAPAN", stale, today), /更新/);
      assert.equal(JSON.stringify(data), before);
      assert.equal(bankTransferDetail(data, "JAPAN", row.id, today).candidates.length, 1);
      confirm(data);
      assert.equal(data.bankTransfers!.length, 1);
      assert.ok(data.bankTransactions.every((item) => item.reviewed && item.treatment === "TRANSFER"));
      assert.equal(row.bookkeeping?.invoiceRequirement, "NOT_REQUIRED");
      assert.equal(row.memo, "Resolved explicitly");
    }
  }
});

test("empty splits and invoice requirements alone do not block transfers", () => {
  const data = setup();
  data.bankTransactions[0].bookkeeping = { splits: [], invoiceRequirement: "NOT_REQUIRED" };
  data.bankTransactions[1].bookkeeping = { invoiceRequirement: "REQUIRED" };
  assert.equal(bankTransferDetail(data, "JAPAN", "from", today).issue, "");
  confirm(data);
  assert.equal(data.bankTransfers!.length, 1);
});

test("existing links with conflicting bookkeeping are flagged without deleting evidence", () => {
  for (const bookkeeping of [splitBookkeeping, heldBookkeeping]) {
    for (const index of [0, 1]) {
      const data = setup(); confirm(data);
      data.bankTransactions[index].bookkeeping = structuredClone(bookkeeping);
      const before = JSON.stringify(data);
      const pattern = bookkeeping.hold ? /保留/ : /分割/;
      assert.match(bankTransferIssue(data, data.bankTransfers![0], today), pattern);
      const detail = bankTransferDetail(data, "JAPAN", "from", today);
      assert.match(detail.issue, pattern);
      assert.equal(detail.link?.id, data.bankTransfers![0].id);
      assert.equal(JSON.stringify(data), before);
    }
  }
});

test("confirmed transfers exclude both sides from operating totals but retain account cash movements", () => {
  const data = setup(), source = data.bankTransactions.map((row) => [row.amount, row.transactionDate, row.content]);
  const invoices = JSON.stringify([data.issuedInvoices, data.receivedInvoices, data.mailDocuments, data.payments]);
  assert.equal(bankTransferDetail(data, "JAPAN", "from", today).candidates[0].id, "to");
  confirm(data);
  assert.ok(data.bankTransactions.every((row) => row.treatment === "TRANSFER" && row.reviewed));
  assert.deepEqual(data.bankTransactions.map((row) => [row.amount, row.transactionDate, row.content]), source);
  assert.equal(JSON.stringify([data.issuedInvoices, data.receivedInvoices, data.mailDocuments, data.payments]), invoices);
  const summary = selectBankTransactions(data, "JAPAN", bankFilters({})).summary;
  assert.equal(summary.income, 0); assert.equal(summary.expense, 0);
  assert.equal(bankForecastEvidence(data, "JAPAN", "from", today).current.expense, 12000);
  assert.equal(bankForecastEvidence(data, "JAPAN", "to", today).current.income, 12000);
  assert.ok(bankReconciliationOverview(data, "JAPAN", today).banks.every((row) => row.state === "excluded"));
  assert.equal(bankTransferIssue(data, data.bankTransfers![0], today), "");
});

test("duplicate, stale, mismatched, excluded and foreign transfers fail without partial writes", () => {
  for (const variant of ["same-account", "same-direction", "amount", "future", "missing", "excluded", "card", "company", "office", "stale", "no-consent", "duplicate"] as const) {
    const data = setup(), request = input(data), second = data.bankTransactions[1];
    if (variant === "same-account") second.bankAccountId = "from";
    if (variant === "same-direction") second.side = "EXPENSE";
    if (variant === "amount") second.amount -= 330;
    if (variant === "future") second.transactionDate = "2026-11-01";
    if (variant === "missing") second.sourceMissing = true;
    if (variant === "excluded") second.sourceStatus = "excluded";
    if (variant === "card") data.bankAccounts[1].forecastSettings!.accountKind = "CARD";
    if (variant === "company") second.company = "CHINA";
    if (variant === "office") { second.officeCode = "other"; data.bankAccounts[1].officeCode = "other"; }
    if (variant === "stale") request.counterpartUpdatedAt = "stale";
    if (variant === "no-consent") request.acknowledged = false as true;
    if (variant === "duplicate") confirm(data);
    const before = JSON.stringify(data);
    assert.throws(() => confirmBankTransfer(data, admin, "JAPAN", request, today), variant);
    assert.equal(JSON.stringify(data), before, variant);
  }
});

test("reconnected aliases of the same physical account cannot form a transfer", () => {
  const data = setup();
  data.bankAccounts.forEach((row) => { row.name = "UFJ 1234567"; });
  assert.throws(() => confirm(data), /同じ口座/);
});

test("invoice links and transfer links are mutually exclusive, including classification edits", () => {
  const data = setup(), bank = data.bankTransactions[1], invoice = data.issuedInvoices[0];
  confirmBankReconciliation(data, admin, "JAPAN", { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: "issued", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, mode: "new", amount: 12000, acknowledged: true }, today);
  assert.throws(() => confirm(data), /請求書/);
  assert.throws(() => saveBankEdits(data, admin, "JAPAN", [{ ...bank, treatment: "TRANSFER" }]), /請求書/);
  const other = setup(); confirm(other);
  const edit: BankEdit = { ...other.bankTransactions[0], treatment: "NORMAL" };
  assert.throws(() => saveBankEdits(other, admin, "JAPAN", [edit]), /資金移動/);
  const linkedBank = other.bankTransactions[1];
  assert.throws(() => confirmBankReconciliation(other, admin, "JAPAN", { transactionId: linkedBank.id, transactionUpdatedAt: linkedBank.updatedAt, invoiceKind: "issued", invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, mode: "new", amount: 12000, acknowledged: true }, today), /資金移動/);
});

test("transfer removal restores both classifications and preserves later memo/source corrections", () => {
  const data = setup(); confirm(data);
  const link = data.bankTransfers![0], row = data.bankTransactions[0];
  saveBankEdits(data, admin, "JAPAN", [{ ...row, memo: "later memo" }]);
  row.amount = 12500;
  assert.match(bankTransferIssue(data, link, today), /金額/);
  removeBankTransfer(data, admin, "JAPAN", link.id, link.updatedAt);
  assert.ok(data.bankTransactions.every((item) => item.treatment === "NORMAL" && !item.reviewed));
  assert.equal(row.amount, 12500); assert.equal(row.memo, "later memo");
  assert.ok(link.deletedAt);
  assert.throws(() => removeBankTransfer(data, admin, "JAPAN", link.id, link.updatedAt));
});

test("unauthorized users cannot confirm/remove transfers and unequal amounts are not suggested", () => {
  const data = setup(); data.bankTransactions[1].amount += 1;
  assert.equal(bankTransferDetail(data, "JAPAN", "from", today).candidates.length, 0);
  assert.throws(() => confirmBankTransfer(data, { id: "staff", role: "BILLING_EDITOR" }, "JAPAN", input(data), today));
  assert.throws(() => removeBankTransfer(data, { id: "staff", role: "BILLING_EDITOR" }, "JAPAN", "x", "x"));
});

test("transfer corrections cannot resurrect an excluded source, and Undo restores both sides with the link", () => {
  const data = setup(), before = structuredClone(data), revision = bankingDataRevision(data, "JAPAN");
  confirm(data);
  assert.notEqual(bankingDataRevision(data, "JAPAN"), revision);
  const link = data.bankTransfers![0];
  data.bankTransactions[0].sourceStatus = "excluded";
  removeBankTransfer(data, admin, "JAPAN", link.id, link.updatedAt);
  assert.equal(data.bankTransactions[0].treatment, "EXCLUDED");
  assert.equal(data.bankTransactions[0].reviewed, false);
  const other = setup(); confirm(other);
  restoreUndoState(other, { format: "triangle-undo-patch-v1", changes: [
    { collection: "bankTransfers", id: other.bankTransfers![0].id, index: 0, before: null },
    ...before.bankTransactions.map((row, index) => ({ collection: "bankTransactions", id: row.id, index, before: row })),
  ] });
  assert.equal(other.bankTransfers!.length, 0);
  assert.ok(other.bankTransactions.every((row) => row.treatment === "NORMAL"));
});
