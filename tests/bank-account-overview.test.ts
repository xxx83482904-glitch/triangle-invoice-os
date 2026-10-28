import assert from "node:assert/strict";
import test from "node:test";
import { accountKind, bankAccountOverview, bankFiscalYear, saveBankOverview } from "../src/lib/bank-account-overview";
import { shiftForecastMonth } from "../src/lib/bank-forecast";
import { mergeBankMasters, mergeBankTransactions, sourceKey } from "../src/lib/banking";
import { recordBankCoverage } from "../src/lib/bank-forecast";
import { restoreUndoState } from "../src/lib/store";
import type { BankTransaction } from "../src/lib/banking-types";
import { fixture, admin, timestamp } from "./document-fixture";

const office = "0000-0001", today = "2026-10-26";
const id = (source = "bank", sub = "branch") => sourceKey("JAPAN", office, "account", source, sub);
function setup() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", office, [
    { id: "old", name: "PayPay銀行", serviceName: "PayPay銀行", isManual: false },
    { id: "old", subId: "branch", name: "PayPay銀行 / 本店 普通 1237691", serviceName: "PayPay銀行", isManual: false },
    { id: "bank", name: "PayPay銀行", serviceName: "PayPay銀行", isManual: false },
    { id: "bank", subId: "branch", name: "PayPay銀行 / 本店 普通 1237691", serviceName: "PayPay銀行", isManual: false },
    { id: "bank", subId: "other", name: "PayPay銀行 / 本店 普通 7654321", serviceName: "PayPay銀行", isManual: false },
    { id: "card", name: "UPSIDER", serviceName: "UPSIDER", isManual: false },
  ], []);
  data.bankAccounts.filter((row) => row.sourceId === "old").forEach((row) => { row.available = false; });
  mergeBankTransactions(data, "JAPAN", office, [
    { id: "before", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-10-01", value: 5000, side: "INCOME", content: "Before snapshot", journalizing_status: "none" },
    { id: "older", connected_account_id: "old", connected_sub_account_id: "branch", date: "2026-10-02", value: 300, side: "INCOME", content: "Old connection", journalizing_status: "none" },
    { id: "expense", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-10-03", value: 200, side: "EXPENSE", content: "Transfer", journalizing_status: "excluded" },
    { id: "card", connected_account_id: "card", date: "2026-10-04", value: 700, side: "EXPENSE", content: "Card purchase", journalizing_status: "none" },
    { id: "parent", connected_account_id: "bank", date: "2026-10-05", value: 50, side: "INCOME", content: "Unspecified", journalizing_status: "none" },
    { id: "other", connected_account_id: "bank", connected_sub_account_id: "other", date: "2026-10-06", value: 600, side: "INCOME", content: "Other account", journalizing_status: "none" },
    { id: "missing", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-09-01", value: 9999, side: "INCOME", content: "Missing source", journalizing_status: "none" },
    { id: "future", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-10-30", value: 9999, side: "INCOME", content: "Future", journalizing_status: "none" },
  ], { start: "2026-09-01", end: "2026-10-31" });
  data.bankTransactions.find((row) => row.sourceId === "missing")!.sourceMissing = true;
  data.bankSyncStates.push({ id: "sync", company: "JAPAN", officeCode: office, officeName: "Test", autoSync: false, status: "SUCCESS", imported: 8, updated: 0, createdAt: timestamp, updatedAt: timestamp, lastSuccessAt: "2026-10-26T01:00:00Z" });
  recordBankCoverage(data.bankSyncStates[0], "2026-09-01", today, data.bankAccounts.map((row) => row.id));
  return data;
}

function register(data: ReturnType<typeof setup>, amount = 10000, asOf = "2026-10-01", accountId = id()) {
  const account = data.bankAccounts.find((row) => row.id === accountId)!;
  return saveBankOverview(data, admin, "JAPAN", accountId, account.updatedAt, { kind: "BANK", balance: { amount, asOf, currency: "JPY" } }, today);
}

function calculation(data: ReturnType<typeof setup>, accountId = id(), year?: string) {
  return bankAccountOverview(data, "JAPAN", undefined, today, year).rows.find((row) => row.id === accountId)!.balanceCalculation;
}

test("overview deduplicates reconnects and never double counts children under connection headers", () => {
  const data = setup(), before = structuredClone(data), report = bankAccountOverview(data, "JAPAN", "2026-10", today);
  assert.equal(report.rows.length, 4);
  const bank = report.rows.find((row) => row.id === id())!;
  assert.equal(bank.memberCount, 2); assert.equal(bank.income, 5300); assert.equal(bank.expense, 200); assert.equal(bank.count, 3);
  assert.equal(bank.balance, undefined); assert.equal(bank.balanceCalculation, undefined);
  assert.equal(report.rows.reduce((sum, row) => sum + row.income, 0), 5950);
  assert.equal(report.rows.reduce((sum, row) => sum + row.expense, 0), 900);
  const parent = report.rows.find((row) => row.unspecified)!;
  assert.equal(parent.kind, "UNKNOWN"); assert.equal(parent.income, 50);
  assert.equal(report.rows.find((row) => row.id === id("card", ""))!.kind, "CARD");
  assert.equal(report.rows.find((row) => row.id === id("card", ""))!.balance, undefined);
  assert.equal(bank.latestDate, "2026-10-03"); assert.equal(bank.transactions.length, 3);
  assert.equal(bank.history.find((point) => point.month === "2026-09")!.income, 0);
  assert.deepEqual(data, before);
});

test("calculated balance always uses acquired later movement, with explicit coverage and missing-source status", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!;
  saveBankOverview(data, admin, "JAPAN", account.id, account.updatedAt, { kind: "BANK", balance: { amount: 10000, asOf: "2026-10-01", currency: "JPY" } }, today);
  const report = bankAccountOverview(data, "JAPAN", "2026-10", today).rows.find((row) => row.id === id())!;
  const baseline = structuredClone(account.overviewSettings);
  assert.equal(report.balance?.amount, 10000);
  assert.deepEqual(report.balanceCalculation, { amount: 10100, income: 300, expense: 200, count: 2, through: today, complete: true, missing: 0 });
  data.bankSyncStates[0].coverage = [];
  assert.deepEqual(calculation(data), { ...report.balanceCalculation, complete: false });
  recordBankCoverage(data.bankSyncStates[0], "2026-10-01", today, data.bankAccounts.map((row) => row.id));
  data.bankTransactions.find((row) => row.sourceId === "older")!.sourceMissing = true;
  assert.deepEqual(calculation(data), { amount: 9800, income: 0, expense: 200, count: 1, through: today, complete: false, missing: 1 });
  assert.deepEqual(account.overviewSettings, baseline);
});

test("historical month, zero, negative balances and separate companies remain explicit", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!;
  for (const amount of [0, -200]) {
    saveBankOverview(data, admin, "JAPAN", account.id, account.updatedAt, { kind: "BANK", balance: { amount, asOf: "2026-10-01", currency: "JPY" } }, today);
    const report = bankAccountOverview(data, "JAPAN", "2026-08", today).rows.find((row) => row.id === id())!;
    assert.equal(report.balance?.amount, amount); assert.equal(report.balanceCalculation?.amount, amount + 100); assert.equal(report.count, 0); assert.equal(report.missing, 0);
    assert.equal(report.balanceCalculation?.through, today);
  }
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-99", today).month, "2026-10");
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-11", today).month, "2026-10");
  assert.equal(bankAccountOverview(data, "CHINA", "2026-10", today).rows.length, 0);
});

test("day-end baseline excludes its own day and earlier rows, includes today, and ignores tomorrow", () => {
  const data = setup(), sample = data.bankTransactions[0];
  register(data, 0);
  data.bankTransactions = [
    { ...sample, id: "before", transactionDate: "2026-09-30", amount: 900 },
    { ...sample, id: "snapshot-income", transactionDate: "2026-10-01", amount: 800 },
    { ...sample, id: "snapshot-expense", transactionDate: "2026-10-01", amount: 600, side: "EXPENSE" },
    { ...sample, id: "next-day", transactionDate: "2026-10-02", amount: 200 },
    { ...sample, id: "today", transactionDate: today, amount: 300, side: "EXPENSE" },
    { ...sample, id: "zero", transactionDate: today, amount: 0 },
    { ...sample, id: "tomorrow", transactionDate: "2026-10-27", amount: 1000 },
  ];
  assert.deepEqual(calculation(data), { amount: -100, income: 200, expense: 300, count: 3, through: today, complete: true, missing: 0 });
  register(data, -500, today);
  data.bankSyncStates = [];
  assert.deepEqual(calculation(data), { amount: -500, income: 0, expense: 0, count: 0, through: today, complete: true, missing: 0 });
});

test("a baseline without subsequent movements stays visible even without sync coverage", () => {
  const data = setup();
  register(data, 0);
  data.bankTransactions = [];
  data.bankSyncStates = [];
  assert.deepEqual(calculation(data), { amount: 0, income: 0, expense: 0, count: 0, through: today, complete: false, missing: 0 });
  data.bankSyncStates = setup().bankSyncStates;
  assert.equal(calculation(data)?.complete, true);
});

test("coverage gaps and missing reconnect coverage remain provisional until the entire interval is acquired", () => {
  const data = setup(), state = data.bankSyncStates[0], ids = [id(), id("old")];
  register(data);
  state.coverage = [];
  recordBankCoverage(state, "2026-10-02", "2026-10-05", ids);
  recordBankCoverage(state, "2026-10-07", today, ids);
  assert.equal(calculation(data)?.amount, 10100); assert.equal(calculation(data)?.complete, false);
  recordBankCoverage(state, "2026-10-06", "2026-10-06", [id()]);
  assert.equal(calculation(data)?.complete, false);
  recordBankCoverage(state, "2026-10-06", "2026-10-06", [id("old")]);
  assert.equal(calculation(data)?.complete, true);
  state.coverage = [{ start: "2026-10-02", end: "2026-10-25", accountIds: ids }];
  assert.equal(calculation(data)?.complete, false);
  recordBankCoverage(state, today, today, ids);
  assert.equal(calculation(data)?.complete, true);
});

test("missing-source status is scoped to after the snapshot through today, independently of fiscal history", () => {
  const data = setup(), sample = data.bankTransactions[0];
  register(data);
  data.bankTransactions.push(
    { ...sample, id: "missing-snapshot", sourceMissing: true, transactionDate: "2026-10-01" },
    { ...sample, id: "missing-future", sourceMissing: true, transactionDate: "2026-10-27" },
  );
  assert.equal(calculation(data)?.complete, true); assert.equal(calculation(data)?.missing, 0);
  data.bankTransactions.find((row) => row.sourceId === "expense")!.sourceMissing = true;
  const historical = bankAccountOverview(data, "JAPAN", undefined, today, "2026").rows.find((row) => row.id === id())!;
  assert.equal(historical.missing, 0);
  assert.deepEqual(historical.balanceCalculation, { amount: 10300, income: 300, expense: 0, count: 1, through: today, complete: false, missing: 1 });
});

test("sync additions, corrections, disappearance and reappearance recalculate without rewriting the baseline", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!;
  register(data);
  const saved = structuredClone(account.overviewSettings), savedUpdatedAt = account.updatedAt;
  const item = { id: "synced", connected_account_id: "bank", connected_sub_account_id: "branch", date: "2026-10-10", value: 400, side: "INCOME" as const, content: "Sync", journalizing_status: "none" };
  const range = { start: item.date, end: item.date };
  mergeBankTransactions(data, "JAPAN", office, [item], range);
  assert.equal(calculation(data)?.amount, 10500); assert.equal(calculation(data)?.count, 3);
  mergeBankTransactions(data, "JAPAN", office, [item], range);
  assert.equal(calculation(data)?.amount, 10500); assert.equal(calculation(data)?.count, 3);
  mergeBankTransactions(data, "JAPAN", office, [{ ...item, value: 600, side: "EXPENSE" }], range);
  assert.equal(calculation(data)?.amount, 9500); assert.equal(calculation(data)?.expense, 800);
  mergeBankTransactions(data, "JAPAN", office, [], range);
  assert.equal(calculation(data)?.amount, 10100); assert.equal(calculation(data)?.missing, 1); assert.equal(calculation(data)?.complete, false);
  mergeBankTransactions(data, "JAPAN", office, [item], range);
  assert.equal(calculation(data)?.amount, 10500); assert.equal(calculation(data)?.missing, 0); assert.equal(calculation(data)?.complete, true);
  mergeBankTransactions(data, "JAPAN", office, [{ ...item, date: "2026-10-01" }], { start: "2026-10-01", end: "2026-10-01" });
  assert.equal(calculation(data)?.amount, 10100); assert.equal(calculation(data)?.count, 2);
  assert.deepEqual(account.overviewSettings, saved); assert.equal(account.updatedAt, savedUpdatedAt);
});

test("bank transfers conserve total cash and card purchases, invoices, payments and link records are not counted again", () => {
  const data = setup(), sample = data.bankTransactions[0];
  register(data, 10000); register(data, 2000, "2026-10-01", id("bank", "other"));
  const outgoing = { ...sample, id: "transfer-out", transactionDate: "2026-10-02", amount: 650, side: "EXPENSE" as const, treatment: "TRANSFER" as const };
  const incoming = { ...sample, id: "transfer-in", bankAccountId: id("bank", "other"), transactionDate: "2026-10-02", amount: 650, treatment: "TRANSFER" as const };
  const card = data.bankTransactions.find((row) => row.sourceId === "card")!;
  data.bankTransactions = [outgoing, incoming, card];
  const beforeLinks = [calculation(data), calculation(data, incoming.bankAccountId)];
  assert.equal(beforeLinks[0]?.amount, 9350); assert.equal(beforeLinks[1]?.amount, 2650);
  assert.equal(beforeLinks.reduce((sum, row) => sum + row!.amount, 0), 12000);
  data.bankTransfers = [{ id: "transfer", company: "JAPAN", outgoingId: outgoing.id, incomingId: incoming.id, outgoingEvidence: "out", incomingEvidence: "in", previous: [], confirmedById: admin.id, createdAt: timestamp, updatedAt: timestamp }];
  data.payments = [{ id: "payment", type: "EXPENSE", receivedInvoiceId: "received-1", amount: 650, paymentDate: "2026-10-02", createdById: admin.id, createdAt: timestamp, updatedAt: timestamp }];
  data.bankReconciliations = [{ id: "link", company: "JAPAN", transactionId: outgoing.id, invoiceKind: "received", invoiceId: "received-1", paymentId: "payment", amount: 650, createdPayment: false, bankEvidence: "bank", invoiceEvidence: "invoice", paymentEvidence: "payment", note: "", confirmedById: admin.id, createdAt: timestamp, updatedAt: timestamp }];
  assert.deepEqual([calculation(data), calculation(data, incoming.bankAccountId)], beforeLinks);
  assert.equal(calculation(data, id("card", "")), undefined);
  data.bankTransactions.push({ ...outgoing, id: "card-settlement", amount: 700, sourceStatus: "excluded", treatment: "EXCLUDED" });
  assert.equal(calculation(data)?.amount, 8650); assert.equal(calculation(data)?.expense, 1350); assert.equal(calculation(data)?.count, 2);
  assert.equal(calculation(data)!.amount + calculation(data, incoming.bankAccountId)!.amount, 11300);
});

test("UFJ/APLUS monthly settlement and PayPay transfer produce current bank cash independently of classification", () => {
  const data = setup(), through = "2026-10-28", sample = data.bankTransactions[0];
  data.bankAccounts = data.bankAccounts.filter((account) => account.sourceId !== "old");
  const ufj = data.bankAccounts.find((account) => account.id === id())!;
  ufj.name = "UFJ / 1234567"; ufj.serviceName = "UFJ";
  register(data, 1000000, "2026-09-30");
  register(data, 300000, "2026-09-30", id("bank", "other"));
  data.bankTransactions = [
    { ...sample, id: "receipt", transactionDate: "2026-10-01", amount: 200000 },
    { ...sample, id: "fee", transactionDate: "2026-10-02", amount: 5000, side: "EXPENSE" },
    { ...sample, id: "ap-out", transactionDate: "2026-10-03", amount: 50000, side: "EXPENSE", treatment: "TRANSFER", content: "AP self transfer" },
    { ...sample, id: "ap-in", bankAccountId: id("bank", "other"), transactionDate: "2026-10-03", amount: 50000, treatment: "TRANSFER" },
    { ...sample, id: "aplus-settlement", transactionDate: "2026-10-27", amount: 120000, side: "EXPENSE", treatment: "TRANSFER", content: "APアプラス" },
    { ...sample, id: "card-purchase", bankAccountId: id("card", ""), transactionDate: "2026-10-10", amount: 120000, side: "EXPENSE" },
  ];
  data.bankSyncStates[0].coverage = [{ start: "2026-10-01", end: through, accountIds: [id()] }];
  for (const treatment of ["NORMAL", "TRANSFER", "EXCLUDED"] as const) {
    data.bankTransactions.find((row) => row.id === "aplus-settlement")!.treatment = treatment;
    data.bankTransactions.find((row) => row.id === "ap-out")!.treatment = treatment;
    const rows = bankAccountOverview(data, "JAPAN", undefined, through, "2026").rows;
    assert.deepEqual(rows.find((row) => row.id === id())!.balanceCalculation,
      { amount: 1025000, income: 200000, expense: 175000, count: 4, through, complete: true, missing: 0 });
    assert.deepEqual(rows.find((row) => row.id === id("bank", "other"))!.balanceCalculation,
      { amount: 350000, income: 50000, expense: 0, count: 1, through, complete: false, missing: 0 });
    assert.equal(rows.find((row) => row.kind === "CARD")!.balanceCalculation, undefined);
    assert.equal(rows.reduce((sum, row) => sum + (row.balanceCalculation?.amount ?? 0), 0), 1375000);
    assert.ok(rows.every((row) => row.count === 0));
  }
});

test("changing the snapshot resets the calculation interval, and clearing it removes the calculation", () => {
  const data = setup();
  register(data);
  assert.equal(calculation(data)?.amount, 10100);
  register(data, 20000, "2026-10-02");
  assert.deepEqual(calculation(data), { amount: 19800, income: 0, expense: 200, count: 1, through: today, complete: true, missing: 0 });
  register(data, 0, "2026-10-03");
  assert.equal(calculation(data)?.amount, 0); assert.equal(calculation(data)?.count, 0);
  const account = data.bankAccounts.find((row) => row.id === id())!;
  saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { kind: "BANK" }, today);
  assert.equal(calculation(data), undefined);
});

test("balance spans fiscal years through today while history and selected movements remain fiscal", () => {
  const data = setup(), sample = data.bankTransactions[0];
  register(data, 1000, "2025-09-30");
  data.bankTransactions = [
    { ...sample, id: "old-year", transactionDate: "2025-10-01", amount: 100 },
    { ...sample, id: "closing-day", transactionDate: "2026-08-31", amount: 200 },
    { ...sample, id: "new-year", transactionDate: "2026-09-01", amount: 500 },
    { ...sample, id: "current", transactionDate: today, amount: 50, side: "EXPENSE" },
  ];
  recordBankCoverage(data.bankSyncStates[0], "2025-10-01", today, [id(), id("old")]);
  const before = structuredClone(data);
  const previous = bankAccountOverview(data, "JAPAN", undefined, today, "2026"), current = bankAccountOverview(data, "JAPAN", undefined, today, "2027");
  const previousBank = previous.rows.find((row) => row.id === id())!, currentBank = current.rows.find((row) => row.id === id())!;
  assert.equal(previous.through, "2026-08-31"); assert.equal(current.through, today);
  assert.equal(previousBank.income, 300); assert.equal(previousBank.count, 2);
  assert.equal(currentBank.income, 500); assert.equal(currentBank.expense, 50); assert.equal(currentBank.count, 2);
  assert.deepEqual(previousBank.balanceCalculation, { amount: 1750, income: 800, expense: 50, count: 4, through: today, complete: true, missing: 0 });
  assert.deepEqual(previousBank.balanceCalculation, currentBank.balanceCalculation);
  assert.deepEqual(calculation(data, id(), "2025"), currentBank.balanceCalculation);
  assert.deepEqual(data, before);
});

test("reconnected account uses the newest saved baseline once, without leaking across account, company or office", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!, sample = data.bankTransactions[0];
  const old = register(data, 1000, "2026-10-01", id("old"));
  old.recordedAt = "2026-10-01T00:00:00Z";
  register(data, 2000, "2026-10-02");
  const otherOffice = "0000-0002", otherId = sourceKey("JAPAN", otherOffice, "account", "bank", "branch");
  data.bankAccounts.push({ ...structuredClone(account), id: otherId, officeCode: otherOffice, overviewSettings: { kind: "BANK", balance: { amount: 9000, asOf: "2026-10-01", currency: "JPY" }, recordedAt: timestamp } });
  const chinaId = sourceKey("CHINA", office, "account", "bank", "branch");
  data.bankAccounts.push({ ...structuredClone(account), id: chinaId, company: "CHINA" });
  data.bankTransactions.push(
    { ...sample, id: "wrong-company", company: "CHINA", transactionDate: today, amount: 99999 },
    { ...sample, id: "wrong-office", officeCode: otherOffice, transactionDate: today, amount: 99999 },
    { ...sample, id: "other-office", bankAccountId: otherId, officeCode: otherOffice, transactionDate: today, amount: 500 },
    { ...sample, id: "china", company: "CHINA", bankAccountId: chinaId, transactionDate: today, amount: 600 },
    { ...sample, id: "orphan", bankAccountId: "unknown", transactionDate: today, amount: 99999 },
  );
  const report = bankAccountOverview(data, "JAPAN", undefined, today), bank = report.rows.find((row) => row.id === id())!;
  assert.equal(bank.memberCount, 2); assert.equal(bank.balance?.amount, 2000); assert.equal(bank.balanceCalculation?.amount, 1800);
  assert.equal(report.rows.filter((row) => row.id === id("old")).length, 0);
  assert.equal(calculation(data, otherId)?.amount, 9500); assert.equal(calculation(data, otherId)?.complete, false);
  assert.equal(bank.balanceCalculation?.complete, true);
  assert.equal(report.rows.find((row) => row.unspecified)?.balanceCalculation, undefined);
  assert.equal(bankAccountOverview(data, "CHINA", undefined, today).rows[0].balanceCalculation?.amount, 2600);
});

test("invalid dates, amounts and directions cannot affect calculated cash or fiscal totals", () => {
  const data = setup(), sample = data.bankTransactions[0];
  register(data);
  const invalid: Partial<BankTransaction>[] = [
    { transactionDate: "2026-09-31" }, { transactionDate: "invalid" }, { amount: NaN }, { amount: Infinity },
    { amount: -200 }, { amount: 0.5 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { side: "INVALID" as BankTransaction["side"] },
  ];
  data.bankTransactions.push(...invalid.map((patch, index) => ({ ...sample, id: `invalid-${index}`, transactionDate: today, amount: 99999, ...patch })));
  const bank = bankAccountOverview(data, "JAPAN", undefined, today).rows.find((row) => row.id === id())!;
  assert.deepEqual(bank.balanceCalculation, { amount: 10100, income: 300, expense: 200, count: 2, through: today, complete: false, missing: 0 });
  assert.equal(bank.income, 5300); assert.equal(bank.expense, 200); assert.equal(bank.count, 3);
  assert.equal(bank.latestDate, "2026-10-03");
});

test("invalid persisted or future baselines never produce a present-day calculated balance", () => {
  for (const balance of [
    { amount: NaN, asOf: "2026-10-01", currency: "JPY" as const },
    { amount: 100, asOf: "2026-09-31", currency: "JPY" as const },
    { amount: 100, asOf: "2026-10-27", currency: "JPY" as const },
  ]) {
    const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!;
    account.overviewSettings = { kind: "BANK", balance, recordedAt: timestamp };
    const before = structuredClone(data);
    assert.equal(calculation(data), undefined);
    assert.deepEqual(data, before);
  }
});

test("default period follows the latest valid available transaction and excludes other companies, orphans, missing and future data", () => {
  const data = setup(), sample = data.bankTransactions[0];
  data.bankTransactions = [
    { ...sample, id: "june", transactionDate: "2026-06-30" },
    { ...sample, id: "august", transactionDate: "2026-08-31" },
    { ...sample, id: "china", company: "CHINA", transactionDate: "2026-10-01" },
    { ...sample, id: "missing", sourceMissing: true, transactionDate: "2026-10-02" },
    { ...sample, id: "future", transactionDate: "2026-10-27" },
    { ...sample, id: "orphan", bankAccountId: "absent", transactionDate: "2026-10-03" },
    { ...sample, id: "wrong-office", officeCode: "other", transactionDate: "2026-10-04" },
    { ...sample, id: "invalid", transactionDate: "2026-09-31" },
  ];
  const report = bankAccountOverview(data, "JAPAN", undefined, today);
  assert.equal(report.latestMonth, "2026-08"); assert.equal(report.month, "2026-08");
  assert.deepEqual(report.period, { year: 2026, start: "2025-09-01", end: "2026-08-31" });
  assert.equal(report.through, "2026-08-31");
  assert.deepEqual(report.rows.find((row) => row.id === id())!.transactions.map((row) => row.id), ["august", "june"]);
  data.bankTransactions.push({ ...sample, id: "latest", transactionDate: "2026-10-20" });
  const latest = bankAccountOverview(data, "JAPAN", undefined, today);
  assert.equal(latest.period.year, 2027); assert.equal(latest.latestMonth, "2026-10");
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-06", today).period.year, 2026);
  assert.equal(bankAccountOverview(data, "JAPAN", "2026-06", today, "2027").period.year, 2027);
});

test("August fiscal close covers exactly twelve months and all transactions in descending date order", () => {
  const data = setup(), sample = data.bankTransactions[0];
  data.bankTransactions = Array.from({ length: 12 }, (_, index) => {
    const month = shiftForecastMonth("2025-09", index);
    return Array.from({ length: 8 }, (_, day) => ({ ...sample, id: `${month}-${day}`, transactionDate: `${month}-${String(day + 1).padStart(2, "0")}`, amount: 100, side: day % 2 ? "EXPENSE" as const : "INCOME" as const }));
  }).flat();
  data.bankTransactions.push(
    { ...sample, id: "before-period", transactionDate: "2025-08-31" },
    { ...sample, id: "last-day", transactionDate: "2026-08-31", amount: 200 },
    { ...sample, id: "next-period", transactionDate: "2026-09-01" },
  );
  const report = bankAccountOverview(data, "JAPAN", undefined, today, "2026"), bank = report.rows.find((row) => row.id === id())!;
  assert.equal(bankFiscalYear("2026-08-31"), 2026); assert.equal(bankFiscalYear("2026-09-01"), 2027);
  assert.equal(bank.history.length, 12); assert.equal(bank.history[0].month, "2025-09"); assert.equal(bank.history.at(-1)!.month, "2026-08");
  assert.equal(bank.count, 97); assert.equal(bank.transactions.length, 97);
  assert.equal(bank.transactions[0].id, "last-day"); assert.equal(bank.transactions.at(-1)!.transactionDate, "2025-09-01");
  assert.equal(bank.income, 5000); assert.equal(bank.expense, 4800); assert.equal(bank.net, 200);
  assert.equal(bank.history.reduce((sum, point) => sum + point.count, 0), bank.count);
  assert.deepEqual(bank.transactions.map((row) => row.transactionDate), bank.transactions.map((row) => row.transactionDate).sort().reverse());
  assert.ok(bank.history.every((point) => !point.future));
});

test("current fiscal period marks future months and empty or invalid inputs fall back safely", () => {
  const report = bankAccountOverview(setup(), "JAPAN", undefined, today);
  assert.equal(report.period.year, 2027); assert.equal(report.through, today);
  assert.equal(report.rows[0].history.filter((point) => point.future).length, 10);
  assert.ok(report.rows[0].history.filter((point) => point.future).every((point) => !point.count && !point.covered));
  assert.deepEqual(report.fiscalYears, [2027, 2026]);
  const data = setup(); data.bankTransactions = [];
  for (const [month, year] of [[undefined, undefined], ["0000-01", "0000"], ["2026-99", "invalid"], ["2027-01", "9999"]]) {
    const empty = bankAccountOverview(data, "JAPAN", month, today, year);
    assert.equal(empty.period.year, 2027); assert.equal(empty.latestMonth, ""); assert.equal(empty.rows[0].count, 0);
  }
});

test("account edits enforce role, company, valid balances, day-end dates and optimistic concurrency", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!, before = structuredClone(data);
  const input = { kind: "BANK" as const, balance: { amount: 100, asOf: today, currency: "JPY" as const } };
  assert.throws(() => saveBankOverview(data, { id: "billing", role: "BILLING_EDITOR" }, "JAPAN", id(), account.updatedAt, input, today));
  assert.throws(() => saveBankOverview(data, admin, "CHINA", id(), account.updatedAt, input, today));
  assert.throws(() => saveBankOverview(data, admin, "JAPAN", id(), "stale", input, today));
  for (const balance of [{ ...input.balance, amount: NaN }, { ...input.balance, amount: 0.5 }, { ...input.balance, asOf: "2026-02-30" }, { ...input.balance, asOf: "2026-10-27" }]) assert.throws(() => saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { ...input, balance }, today));
  assert.throws(() => saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { ...input, kind: "CARD" }, today));
  const parent = data.bankAccounts.find((row) => row.id === id("bank", ""))!;
  assert.throws(() => saveBankOverview(data, admin, "JAPAN", parent.id, parent.updatedAt, input, today));
  assert.deepEqual(data, before);
  saveBankOverview(data, { id: "accounting", role: "ACCOUNTING" }, "JAPAN", id(), account.updatedAt, input, today);
  assert.equal(account.overviewSettings?.balance?.amount, 100);
  assert.deepEqual(data.bankTransactions, before.bankTransactions); assert.deepEqual(data.issuedInvoices, before.issuedInvoices);
  saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { kind: "UNKNOWN" }, today);
  assert.equal(accountKind(account), "UNKNOWN"); assert.equal(account.overviewSettings?.balance, undefined);
});

test("sync preserves registered balances and undo restores them without rolling back source metadata", () => {
  const data = setup(), account = data.bankAccounts.find((row) => row.id === id())!, before = structuredClone(account);
  saveBankOverview(data, admin, "JAPAN", id(), account.updatedAt, { kind: "BANK", balance: { amount: 3000, asOf: today, currency: "JPY" } }, today);
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", subId: "branch", name: "Renamed bank", serviceName: "PayPay銀行", isManual: false }], []);
  assert.equal(account.overviewSettings?.balance?.amount, 3000);
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [{ collection: "bankAccounts", id: id(), index: 3, before }] });
  const restored = data.bankAccounts.find((row) => row.id === id())!;
  assert.equal(restored.overviewSettings, undefined); assert.equal(restored.name, "Renamed bank");
});
