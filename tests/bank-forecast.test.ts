import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { bankForecastEvidence, forecastDefaults, forecastSettingsSchema, projectBankForecast, recordBankCoverage, saveBankForecastSettings, shiftForecastMonth } from "../src/lib/bank-forecast";
import { mergeBankMasters, mergeBankTransactions, sourceKey, type ImportedTransaction } from "../src/lib/banking";
import { restoreUndoState } from "../src/lib/store";
import type { BankForecastSettings, BankSyncState } from "../src/lib/banking-types";

const office = "0000-0001", today = "2026-10-08";
const bankId = sourceKey("JAPAN", office, "account", "bank", "branch");
const cardId = sourceKey("JAPAN", office, "account", "card");
const settings: BankForecastSettings = { accountKind: "BANK", balanceMonth: "2026-10", openingBalance: 500, minimumBalance: 100, incomePercent: 0, expensePercent: 0 };
const transaction = (date: string, side: "INCOME" | "EXPENSE", value: number, content: string = side): ImportedTransaction => ({ id: `${date}-${side}-${content}`, date, value, content, side, journalizing_status: "none", connected_account_id: "bank", connected_sub_account_id: "branch" });
function setup(complete = true) {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", office, [
    { id: "bank", name: "Test bank", serviceName: "Bank", isManual: false },
    { id: "bank", subId: "branch", name: "Test branch", serviceName: "Bank", isManual: false },
    { id: "card", name: "Test card", serviceName: "Card", isManual: false },
  ], []);
  const state: BankSyncState = { id: "sync", company: "JAPAN", officeCode: office, officeName: "Test", autoSync: false, status: "SUCCESS", imported: 0, updated: 0, lastSuccessAt: `${today}T00:00:00Z`, createdAt: timestamp, updatedAt: timestamp };
  if (complete) recordBankCoverage(state, "2026-04-01", today, [bankId]);
  data.bankSyncStates.push(state);
  const items = Array.from({ length: 6 }, (_, i) => shiftForecastMonth("2026-10", i - 6)).flatMap((month) => [transaction(`${month}-20`, "INCOME", 1000), transaction(`${month}-25`, "EXPENSE", 1200, "Rent")]);
  items.push(transaction("2026-10-05", "EXPENSE", 200, "Other"));
  mergeBankTransactions(data, "JAPAN", office, items, { start: "2026-04-01", end: "2026-10-31" });
  return data;
}

test("forecast uses six closed months and separates current actuals", () => {
  const evidence = bankForecastEvidence(setup(), "JAPAN", bankId, today);
  assert.equal(evidence.history[0].month, "2026-04");
  assert.deepEqual(evidence.baseline, { income: 1000, expense: 1200 });
  assert.equal(evidence.sampleMonths, 6); assert.equal(evidence.fetchedMonths, 6);
  assert.equal(evidence.current.expense, 200); assert.equal(evidence.currentFetched, true);
  assert.equal(evidence.stale, false);
  const projected = projectBankForecast(evidence, settings, 3);
  assert.equal(projected[0].predictedExpense, 1000); assert.equal(projected[0].expense, 1200);
  assert.deepEqual(projected.map((row) => row.balance), [300, 100, -100]);
  assert.deepEqual(projected.map((row) => row.belowMinimum), [false, false, true]);
  assert.equal(projected[0].cautiousBalance, -140);
  assert.equal(projected[0].cautiousBelowMinimum, true);
  assert.equal(projectBankForecast(evidence, settings, 6).at(-1)!.month, "2027-03");
});

test("exact account scope never combines parent, card or other company movements", () => {
  const data = setup(), base = data.bankTransactions[0];
  for (const patch of [{ bankAccountId: cardId }, { bankAccountId: sourceKey("JAPAN", office, "account", "bank") }, { company: "CHINA" as const }, { officeCode: "another" }]) data.bankTransactions.push({ ...base, id: `other-${data.bankTransactions.length}`, amount: 999999, ...patch });
  assert.deepEqual(bankForecastEvidence(data, "JAPAN", bankId, today).baseline, { income: 1000, expense: 1200 });
  assert.throws(() => bankForecastEvidence(data, "CHINA", bankId, today));
});

test("cash forecast includes transfers and excluded rows but not missing or future source rows", () => {
  const data = setup();
  data.bankTransactions.forEach((row, i) => { row.treatment = i % 2 ? "TRANSFER" : "EXCLUDED"; });
  const base = data.bankTransactions[0];
  data.bankTransactions.push({ ...base, id: "missing", sourceMissing: true, amount: 999999 }, { ...base, id: "future", transactionDate: "2026-10-30", amount: 999999 }, { ...base, id: "old", transactionDate: "2026-03-01", amount: 999999 });
  const result = bankForecastEvidence(data, "JAPAN", bankId, today);
  assert.deepEqual(result.baseline, { income: 1000, expense: 1200 });
  assert.equal(result.current.income, 0); assert.equal(result.missingRows, 1); assert.equal(result.futureRows, 1);
});

test("unknown empty months are not zeros, but confirmed empty months are", () => {
  const data = setup(false);
  data.bankTransactions = data.bankTransactions.filter((row) => row.transactionDate >= "2026-07-01");
  let evidence = bankForecastEvidence(data, "JAPAN", bankId, today);
  assert.equal(evidence.sampleMonths, 3); assert.equal(evidence.history[0].coverage, "UNKNOWN");
  assert.deepEqual(evidence.baseline, { income: 1000, expense: 1200 });
  recordBankCoverage(data.bankSyncStates[0], "2026-04-01", "2026-06-30", [bankId]);
  evidence = bankForecastEvidence(data, "JAPAN", bankId, today);
  assert.equal(evidence.sampleMonths, 6); assert.deepEqual(evidence.baseline, { income: 500, expense: 600 });
});

test("three months and the immediately prior month are required", () => {
  const data = setup(false);
  data.bankTransactions = data.bankTransactions.filter((row) => row.transactionDate < "2026-09-01");
  assert.equal(bankForecastEvidence(data, "JAPAN", bankId, today).baseline, null);
  data.bankTransactions = data.bankTransactions.filter((row) => row.transactionDate < "2026-06-01");
  assert.equal(bankForecastEvidence(data, "JAPAN", bankId, "2026-06-08").baseline, null);
  assert.deepEqual(projectBankForecast(bankForecastEvidence(data, "JAPAN", bankId, today), settings, 3), []);
});

test("covered all-zero history is valid, and coverage never leaks to another account", () => {
  const data = setup(); data.bankTransactions = [];
  assert.deepEqual(bankForecastEvidence(data, "JAPAN", bankId, today).baseline, { income: 0, expense: 0 });
  assert.equal(bankForecastEvidence(data, "JAPAN", cardId, today).baseline, null);
});

test("coverage merges overlaps and adjacent ranges only for matching account populations", () => {
  const state = setup(false).bankSyncStates[0];
  recordBankCoverage(state, "2026-04-01", "2026-04-15", [bankId]);
  recordBankCoverage(state, "2026-04-16", "2026-04-30", [bankId, bankId]);
  recordBankCoverage(state, "2026-05-01", "2026-05-31", [cardId]);
  assert.deepEqual(state.coverage, [{ start: "2026-04-01", end: "2026-04-30", accountIds: [bankId] }, { start: "2026-05-01", end: "2026-05-31", accountIds: [cardId] }]);
  assert.throws(() => recordBankCoverage(state, "2026-02-30", today, []));
  assert.throws(() => recordBankCoverage(state, today, "2026-04-01", []));
});

test("partial coverage and gaps do not prove a full month", () => {
  const data = setup(false); data.bankTransactions = [];
  recordBankCoverage(data.bankSyncStates[0], "2026-04-01", "2026-04-14", [bankId]);
  recordBankCoverage(data.bankSyncStates[0], "2026-04-16", "2026-04-30", [bankId]);
  assert.equal(bankForecastEvidence(data, "JAPAN", bankId, today).history[0].coverage, "UNKNOWN");
  recordBankCoverage(data.bankSyncStates[0], "2026-04-15", "2026-04-15", [bankId]);
  assert.equal(bankForecastEvidence(data, "JAPAN", bankId, today).history[0].coverage, "FETCHED");
});

test("actuals exceeding a monthly average are never subtracted or predicted twice", () => {
  const evidence = bankForecastEvidence(setup(), "JAPAN", bankId, today);
  evidence.current.income = 2000; evidence.current.expense = 2000;
  const first = projectBankForecast(evidence, settings, 3)[0];
  assert.equal(first.income, 2000); assert.equal(first.expense, 2000);
  assert.equal(first.predictedIncome, 0); assert.equal(first.predictedExpense, 0);
  assert.equal(first.balance, 500); assert.equal(first.cautiousBalance, 500);
});

test("editable scenarios affect remaining predictions, not actuals", () => {
  const evidence = bankForecastEvidence(setup(), "JAPAN", bankId, today);
  const first = projectBankForecast(evidence, { ...settings, incomePercent: 50, expensePercent: -100 }, 3)[0];
  assert.equal(first.income, 1500); assert.equal(first.expense, 200); assert.equal(first.balance, 1800);
  assert.equal(first.actualExpense, 200); assert.equal(evidence.baseline!.expense, 1200);
});

test("balances require a bank account and same-month opening value", () => {
  const evidence = bankForecastEvidence(setup(), "JAPAN", bankId, today);
  for (const input of [{ ...settings, openingBalance: undefined }, { ...settings, balanceMonth: "2026-09" }, { ...settings, accountKind: "CARD" as const, openingBalance: undefined }, { ...settings, accountKind: "UNKNOWN" as const, openingBalance: undefined }]) assert.ok(projectBankForecast(evidence, input, 3).every((row) => row.balance === undefined && !row.belowMinimum));
  const account = setup().bankAccounts.find((row) => row.id === bankId)!;
  account.forecastSettings = settings;
  assert.equal(forecastDefaults(account, "2026-10").openingBalance, 500);
  assert.equal(forecastDefaults(account, "2026-11").openingBalance, undefined);
});

test("recurring candidates are observed, normalized and not added to monthly totals", () => {
  const data = setup();
  const evidence = bankForecastEvidence(data, "JAPAN", bankId, today);
  assert.equal(evidence.recurring.length, 2);
  assert.equal(evidence.recurring.find((row) => row.content === "Rent")!.nextDate, "2026-10-25");
  assert.equal(projectBankForecast(evidence, settings, 3)[0].expense, 1200);
  data.bankTransactions.filter((row) => row.content === "Rent").forEach((row, i) => { row.content = i % 2 ? "Ｒｅｎｔ" : " rent "; });
  assert.equal(bankForecastEvidence(data, "JAPAN", bankId, today).recurring.length, 2);
  const base = data.bankTransactions.find((row) => row.transactionDate === "2026-09-25")!;
  data.bankTransactions.push({ ...base, id: "extra", transactionDate: "2026-09-26" });
  assert.equal(bankForecastEvidence(data, "JAPAN", bankId, today).recurring.length, 1);
});

test("recurring candidates reject unstable amounts and move consumed occurrences to next month", () => {
  const data = setup(), row = data.bankTransactions.find((item) => item.transactionDate === "2026-09-25")!;
  row.amount = 3000;
  assert.ok(!bankForecastEvidence(data, "JAPAN", bankId, today).recurring.some((item) => item.content === "Rent"));
  row.amount = 1200;
  data.bankTransactions.push({ ...row, id: "paid", transactionDate: "2026-10-01" });
  assert.equal(bankForecastEvidence(data, "JAPAN", bankId, today).recurring.find((item) => item.content === "Rent")!.nextDate, "2026-11-25");
});

test("month-end recurrence respects leap years and varying calendar lengths", () => {
  const data = setup(false), template = data.bankTransactions[0];
  data.bankTransactions = ["2023-11-30", "2023-12-31", "2024-01-31"].map((date) => ({ ...template, id: date, transactionDate: date }));
  assert.equal(bankForecastEvidence(data, "JAPAN", bankId, "2024-02-08").recurring[0].nextDate, "2024-02-29");
});

test("backtest uses only earlier months and reports absolute cash-flow error", () => {
  const data = setup();
  data.bankTransactions.find((row) => row.transactionDate === "2026-09-20")!.amount = 1600;
  assert.deepEqual(bankForecastEvidence(data, "JAPAN", bankId, today).backtest, { count: 3, meanAbsoluteError: 200 });
});

test("settings save validates role, company, version, date and numeric ranges before writing", () => {
  const data = setup(), row = data.bankAccounts.find((item) => item.id === bankId)!;
  const before = JSON.stringify(data);
  assert.throws(() => saveBankForecastSettings(data, { id: "bad", role: "BILLING_EDITOR" }, "JAPAN", bankId, row.updatedAt, settings, today));
  assert.throws(() => saveBankForecastSettings(data, admin, "CHINA", bankId, row.updatedAt, settings, today));
  assert.throws(() => saveBankForecastSettings(data, admin, "JAPAN", bankId, "stale", settings, today));
  assert.throws(() => saveBankForecastSettings(data, admin, "JAPAN", bankId, row.updatedAt, { ...settings, balanceMonth: "2026-09" }, today));
  for (const patch of [{ incomePercent: 201 }, { expensePercent: -101 }, { openingBalance: Infinity }, { minimumBalance: -1 }, { accountKind: "CARD" as const }, { openingBalance: 1.2 }]) assert.equal(forecastSettingsSchema.safeParse({ ...settings, ...patch }).success, false);
  assert.equal(JSON.stringify(data), before);
  const old = row.updatedAt;
  saveBankForecastSettings(data, { id: "accountant", role: "ACCOUNTING" }, "JAPAN", bankId, old, settings, today);
  assert.deepEqual(row.forecastSettings, settings); assert.notEqual(row.updatedAt, old);
  assert.deepEqual(data.bankTransactions, JSON.parse(before).bankTransactions);
  assert.deepEqual(data.issuedInvoices, JSON.parse(before).issuedInvoices);
});

test("account sync preserves forecast settings and undo preserves latest source metadata", () => {
  const data = setup(), row = data.bankAccounts.find((item) => item.id === bankId)!;
  const before = structuredClone(row);
  saveBankForecastSettings(data, admin, "JAPAN", bankId, row.updatedAt, settings, today);
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", subId: "branch", name: "Renamed bank", serviceName: "New service", isManual: true }], []);
  assert.deepEqual(row.forecastSettings, settings);
  restoreUndoState(data, { format: "triangle-undo-patch-v1", changes: [{ collection: "bankAccounts", id: bankId, index: 1, before }] });
  const restored = data.bankAccounts.find((item) => item.id === bankId)!;
  assert.equal(restored.forecastSettings, undefined); assert.equal(restored.name, "Renamed bank"); assert.equal(restored.isManual, true);
});
