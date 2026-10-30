import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { bankBookkeepingDetail, bankCategoryAllocations, bankDuplicateCandidates, bankSplitValidation, saveBankBookkeeping, type BankBookkeepingInput, type BookkeepingTransaction } from "../src/lib/bank-bookkeeping";
import { bankFilters, deleteBankDefinition, mergeBankTransactions, saveBankEdits, selectBankTransactions } from "../src/lib/banking";
import type { BankReconciliation, BankTransfer } from "../src/lib/banking-types";

function setup() {
  const data = fixture();
  const base = { company: "JAPAN" as const, createdAt: timestamp, updatedAt: timestamp };
  data.bankAccounts = [{ ...base, id: "account", sourceId: "account-source", officeCode: "office", name: "Bank", serviceName: "Bank", isManual: false, available: true }];
  data.accountingCategories = ["travel", "fees"].map((id) => ({ ...base, id, name: id, group: "EXPENSE", officeCode: "office", available: true }));
  data.accountingCategories.push({ ...data.accountingCategories[0], id: "train", name: "Train", parentId: "travel" });
  data.bankTransactions = [{ ...base, id: "transaction", bankAccountId: "account", officeCode: "office", sourceId: "source-1", transactionDate: "2026-10-20", amount: 12000, side: "EXPENSE", content: "Rail fare", sourceMemo: "source memo", sourceStatus: "none", sourceMissing: false, categoryId: "travel", treatment: "NORMAL", classificationSource: "MANUAL", reviewed: true, memo: "existing" }];
  return data;
}
function input(data: ReturnType<typeof setup>): BankBookkeepingInput {
  const row = data.bankTransactions[0];
  return { id: row.id, updatedAt: row.updatedAt, splits: [{ id: "split-1", categoryId: "travel", subCategoryId: "train", amount: 10000, memo: "Rail" }, { id: "split-2", categoryId: "fees", amount: 2000, memo: "Fee" }], hold: null, invoiceRequirement: "NOT_REQUIRED", memo: "detail", reviewed: true };
}
function assertUnchanged(data: ReturnType<typeof setup>, operation: () => unknown, pattern?: RegExp) {
  const before = JSON.stringify(data);
  if (pattern) assert.throws(operation, pattern); else assert.throws(operation);
  assert.equal(JSON.stringify(data), before);
}

test("split save retains one transaction and one cash amount, replacing the parent allocation", () => {
  const data = setup();
  const source = structuredClone(data.bankTransactions[0]);
  const documents = JSON.stringify([data.issuedInvoices, data.receivedInvoices, data.payments]);
  const { transaction } = saveBankBookkeeping(data, admin, "JAPAN", input(data));
  assert.equal(data.bankTransactions.length, 1);
  assert.equal(transaction.categoryId, undefined);
  assert.equal(transaction.subCategoryId, undefined);
  assert.equal(transaction.bookkeeping?.splits?.length, 2);
  assert.equal(transaction.bookkeeping?.invoiceRequirement, "NOT_REQUIRED");
  assert.ok(transaction.updatedAt > source.updatedAt);
  for (const key of ["amount", "side", "transactionDate", "sourceId", "bankAccountId", "content", "sourceMemo", "sourceStatus", "treatment"] as const) assert.equal(transaction[key], source[key]);
  assert.deepEqual(bankCategoryAllocations(transaction), [{ categoryId: "travel", subCategoryId: "train", amount: 10000 }, { categoryId: "fees", subCategoryId: undefined, amount: 2000 }]);
  assert.equal(bankCategoryAllocations(transaction).reduce((sum, allocation) => sum + allocation.amount, 0), source.amount);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({})).summary.expense, source.amount);
  assert.equal(JSON.stringify([data.issuedInvoices, data.receivedInvoices, data.payments]), documents);
  transaction.bookkeeping!.splits![0].amount = 1;
  assert.equal((data.bankTransactions[0] as BookkeepingTransaction).bookkeeping?.splits?.[0].amount, 10000, "returned objects cannot mutate stored rows");
});

test("invalid split values, mixed allocation modes and unknown input fields fail atomically", () => {
  for (const variant of ["too-low", "too-high", "zero", "negative", "fraction", "nan", "infinity", "unsafe", "one", "too-many", "duplicate-id", "blank-id", "missing-category", "mixed", "source-injection"] as const) {
    const data = setup(), request = input(data);
    if (variant === "too-low") request.splits[0].amount--;
    if (variant === "too-high") request.splits[0].amount++;
    if (variant === "zero") request.splits[0].amount = 0;
    if (variant === "negative") request.splits[0].amount = -1;
    if (variant === "fraction") request.splits[0].amount = 9999.5;
    if (variant === "nan") request.splits[0].amount = NaN;
    if (variant === "infinity") request.splits[0].amount = Infinity;
    if (variant === "unsafe") request.splits[0].amount = Number.MAX_SAFE_INTEGER + 1;
    if (variant === "one") request.splits = [{ ...request.splits[0], amount: 12000 }];
    if (variant === "too-many") request.splits = Array.from({ length: 51 }, (_, index) => ({ ...request.splits[0], id: String(index) }));
    if (variant === "duplicate-id") request.splits[1].id = request.splits[0].id;
    if (variant === "blank-id") request.splits[0].id = "";
    if (variant === "missing-category") request.splits[0].categoryId = "";
    if (variant === "mixed") request.categoryId = "travel";
    if (variant === "source-injection") Object.assign(request, { amount: 1 });
    assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", request));
  }
});

test("category availability, hierarchy, company and office are enforced for every split", () => {
  for (const variant of ["foreign-company", "foreign-office", "deleted", "unavailable", "child-as-parent", "wrong-child", "foreign-child-office"] as const) {
    const data = setup(), request = input(data);
    if (variant === "foreign-company") data.accountingCategories[1].company = "CHINA";
    if (variant === "foreign-office") data.accountingCategories[1].officeCode = "other";
    if (variant === "deleted") data.accountingCategories[1].deletedAt = timestamp;
    if (variant === "unavailable") data.accountingCategories[1].available = false;
    if (variant === "child-as-parent") request.splits[1].categoryId = "train";
    if (variant === "wrong-child") request.splits[1].subCategoryId = "train";
    if (variant === "foreign-child-office") data.accountingCategories[2].officeCode = "other";
    assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", request));
  }
});

test("unauthorized, foreign, missing-source, stale and account-office mismatches cannot load or save details", () => {
  const data = setup(), unauthorized = { id: "editor", role: "BILLING_EDITOR" as const };
  assertUnchanged(data, () => saveBankBookkeeping(data, unauthorized, "JAPAN", input(data)), /権限/);
  assert.throws(() => bankBookkeepingDetail(data, unauthorized, "JAPAN", "transaction"), /権限/);
  assert.throws(() => bankDuplicateCandidates(data, unauthorized, "JAPAN", "transaction"), /権限/);
  assertUnchanged(data, () => saveBankBookkeeping(data, admin, "CHINA", input(data)));
  for (const variant of ["foreign-row", "foreign-account", "missing-account", "office", "stale", "missing-source", "excluded-source", "transfer-treatment", "excluded-treatment"] as const) {
    const other = setup(), request = input(other);
    if (variant === "foreign-row") other.bankTransactions[0].company = "CHINA";
    if (variant === "foreign-account") other.bankAccounts[0].company = "CHINA";
    if (variant === "missing-account") other.bankAccounts = [];
    if (variant === "office") other.bankAccounts[0].officeCode = "other";
    if (variant === "stale") request.updatedAt = "stale";
    if (variant === "missing-source") other.bankTransactions[0].sourceMissing = true;
    if (variant === "excluded-source") other.bankTransactions[0].sourceStatus = "excluded";
    if (variant === "transfer-treatment") other.bankTransactions[0].treatment = "TRANSFER";
    if (variant === "excluded-treatment") other.bankTransactions[0].treatment = "EXCLUDED";
    assertUnchanged(other, () => saveBankBookkeeping(other, admin, "JAPAN", request));
  }
});

test("holds persist a structured question, remain unreviewed and can be explicitly cleared", () => {
  const data = setup(), request = input(data);
  request.hold = { reason: "DUPLICATE_REVIEW", question: "  Are these separate purchases?  " };
  assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", request), /保留/);
  request.reviewed = false;
  const saved = saveBankBookkeeping(data, admin, "JAPAN", request).transaction;
  assert.equal(saved.reviewed, false);
  assert.deepEqual(saved.bookkeeping?.hold, { reason: "DUPLICATE_REVIEW", question: "Are these separate purchases?" });
  assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", { ...request, updatedAt: saved.updatedAt, hold: { reason: "OTHER", question: "   " } }));
  const cleared = saveBankBookkeeping(data, admin, "JAPAN", { ...request, updatedAt: saved.updatedAt, hold: null, reviewed: true }).transaction;
  assert.equal(cleared.bookkeeping?.hold, undefined);
  assert.equal(cleared.reviewed, true);
});

test("no-invoice-needed cannot conflict with an invoice link or create/delete payment records", () => {
  const data = setup();
  data.bankReconciliations = [{ id: "link", transactionId: "transaction", company: "JAPAN", deletedAt: null } as BankReconciliation];
  assert.equal(bankBookkeepingDetail(data, admin, "JAPAN", "transaction").invoiceLinked, true);
  assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", input(data)), /請求書/);
  saveBankBookkeeping(data, admin, "JAPAN", { ...input(data), invoiceRequirement: "REQUIRED" });
  assert.equal(data.bankReconciliations.length, 1);
  assert.equal(data.payments.length, 0);
});

test("active transfer links lock bookkeeping even when treatment or link company is inconsistent", () => {
  for (const foreign of [false, true]) {
    const data = setup();
    data.bankTransfers = [{ id: "transfer", outgoingId: "transaction", incomingId: "other", company: foreign ? "CHINA" : "JAPAN" } as BankTransfer];
    assert.match(bankBookkeepingDetail(data, admin, "JAPAN", "transaction").lockedReason, /資金移動/);
    assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", input(data)), /資金移動/);
    data.bankTransfers[0].deletedAt = timestamp;
    saveBankBookkeeping(data, admin, "JAPAN", input(data));
  }
});

test("duplicate candidates expose both source IDs with explicit evidence, never mutate or cross office/company", () => {
  const data = setup(), row = data.bankTransactions[0];
  data.bankAccounts.push({ ...data.bankAccounts[0], id: "other-account", name: "Other bank" });
  data.bankTransactions.push(
    { ...row, id: "same-source", transactionDate: "2026-10-21", amount: 1, content: "Corrected source" },
    { ...row, id: "same-content", sourceId: "source-2", bankAccountId: "other-account", content: " RAIL  fare " },
    { ...row, id: "foreign", company: "CHINA" },
    { ...row, id: "foreign-office", officeCode: "other" },
    { ...row, id: "invalid-account", bankAccountId: "missing" },
    { ...row, id: "different-content", sourceId: "source-3", content: "Other purchase" },
    { ...row, id: "opposite-side", sourceId: "source-4", side: "INCOME" },
  );
  const before = JSON.stringify(data);
  const candidates = bankDuplicateCandidates(data, admin, "JAPAN", row.id);
  assert.deepEqual(candidates.map((item) => item.id), ["same-source", "same-content"]);
  assert.deepEqual(candidates[0].evidence, ["SOURCE_ID"]);
  assert.deepEqual(candidates[1].evidence, ["DATE_AMOUNT_CONTENT"]);
  assert.equal(candidates[1].comparedSourceId, "source-1");
  assert.equal(candidates[1].sourceId, "source-2");
  assert.equal(candidates[1].accountName, "Other bank");
  assert.equal(JSON.stringify(data), before);
});

test("source correction invalidates split allocation without changing or double-counting the source amount", () => {
  const data = setup();
  saveBankBookkeeping(data, admin, "JAPAN", input(data));
  const row = data.bankTransactions[0] as BookkeepingTransaction;
  // Model the source update: imported amounts always remain the cash authority.
  row.amount = 12500; row.reviewed = false;
  assert.match(bankSplitValidation(row, row.bookkeeping!.splits!).issue, /合計/);
  assert.deepEqual(bankCategoryAllocations(row), [{ amount: 12500 }]);
  row.treatment = "TRANSFER";
  assert.deepEqual(bankCategoryAllocations(row), []);
  row.treatment = "NORMAL"; row.sourceMissing = true;
  assert.deepEqual(bankCategoryAllocations(row), []);
});

test("removing splits restores one explicit category and requires a category before review", () => {
  const data = setup();
  const saved = saveBankBookkeeping(data, admin, "JAPAN", input(data)).transaction;
  const request = { ...input(data), updatedAt: saved.updatedAt, splits: [] };
  assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", request), /科目/);
  const single = saveBankBookkeeping(data, admin, "JAPAN", { ...request, categoryId: "travel", subCategoryId: "train" }).transaction;
  assert.equal(single.bookkeeping?.splits, undefined);
  assert.deepEqual(bankCategoryAllocations(single), [{ categoryId: "travel", subCategoryId: "train", amount: 12000 }]);
});

test("synchronization preserves bookkeeping while invalidating review on source correction", () => {
  const data = setup();
  // Use the import account key to exercise the same reconciliation path as sync.
  data.bankAccounts[0].id = "mf:JAPAN:office:account:account-source:";
  data.bankTransactions[0].bankAccountId = data.bankAccounts[0].id;
  const saved = saveBankBookkeeping(data, admin, "JAPAN", input(data)).transaction;
  mergeBankTransactions(data, "JAPAN", "office", [{ id: "source-1", connected_account_id: "account-source", date: "2026-10-20", value: 13000, side: "EXPENSE", content: "Rail fare", journalizing_status: "none" }], { start: "2026-10-01", end: "2026-10-31" });
  const row = data.bankTransactions[0] as BookkeepingTransaction;
  assert.deepEqual(row.bookkeeping, saved.bookkeeping);
  assert.equal(row.reviewed, false);
  assert.deepEqual(bankCategoryAllocations(row), [{ amount: 13000 }]);
});

test("bookkeeping cannot change source identity, status, amount or treatment through extra input fields", () => {
  for (const [field, value] of Object.entries({ company: "CHINA", officeCode: "foreign", bankAccountId: "other", sourceId: "other-source", amount: 1, side: "INCOME", transactionDate: "2030-01-01", sourceMissing: false, sourceStatus: "none", treatment: "TRANSFER", content: "replacement", sourceMemo: "replacement" })) {
    const data = setup();
    assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", { ...input(data), [field]: value }));
  }
});

test("a source correction rejects previously opened detail and a fresh unbalanced split cannot be reviewed", () => {
  const data = setup();
  data.bankAccounts[0].id = "mf:JAPAN:office:account:account-source:";
  data.bankTransactions[0].bankAccountId = data.bankAccounts[0].id;
  const request = input(data);
  mergeBankTransactions(data, "JAPAN", "office", [{ id: "source-1", connected_account_id: "account-source", date: "2026-10-20", value: 13000, side: "EXPENSE", content: "Rail fare", journalizing_status: "none" }], { start: "2026-10-01", end: "2026-10-31" });
  assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", request), /更新/);
  assertUnchanged(data, () => saveBankBookkeeping(data, admin, "JAPAN", { ...request, updatedAt: data.bankTransactions[0].updatedAt }), /合計/);
  assert.equal(data.bankTransactions[0].reviewed, false);
  assert.equal(data.bankTransactions[0].amount, 13000);
});

test("ordinary classification, review and category deletion respect persisted bookkeeping", () => {
  const data = setup();
  saveBankBookkeeping(data, admin, "JAPAN", input(data));
  const row = data.bankTransactions[0];
  assertUnchanged(data, () => saveBankEdits(data, admin, "JAPAN", [{ ...row, categoryId: "fees" }]), /分割/);
  assertUnchanged(data, () => saveBankEdits(data, admin, "JAPAN", [{ ...row, treatment: "TRANSFER" }]), /分割/);
  assertUnchanged(data, () => deleteBankDefinition(data, admin, "JAPAN", "category", "fees", timestamp), /使用中/);
  saveBankEdits(data, admin, "JAPAN", [{ ...row, memo: "updated memo", reviewed: true }]);
  assert.equal(row.bookkeeping?.splits?.length, 2);
  row.amount++;
  assertUnchanged(data, () => saveBankEdits(data, admin, "JAPAN", [{ ...row, reviewed: true }]), /合計/);
  row.amount--;
  row.bookkeeping!.hold = { reason: "OTHER", question: "Check receipt" };
  row.reviewed = false;
  assertUnchanged(data, () => saveBankEdits(data, admin, "JAPAN", [{ ...row, reviewed: true }]), /保留/);
});

test("split-category filtering counts only its allocation and hold/no-invoice filters stay explicit", () => {
  const data = setup(), request = input(data);
  request.hold = { reason: "CATEGORY_UNCLEAR", question: "Confirm the fee category" };
  request.reviewed = false;
  saveBankBookkeeping(data, admin, "JAPAN", request);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ category: "fees" })).summary.expense, 2000);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ category: "train" })).summary.expense, 10000);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({})).summary.expense, 12000);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ status: "held" })).total, 1);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ status: "no-invoice" })).total, 1);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ status: "unclassified" })).total, 0);
});
