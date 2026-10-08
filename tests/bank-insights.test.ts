import assert from "node:assert/strict";
import test from "node:test";
import { fixture, timestamp } from "./document-fixture";
import { bankAnalysisAccounts } from "../src/lib/bank-analysis";
import { bankSpendingInsights, spendingMonth } from "../src/lib/bank-insights";
import { recordBankCoverage } from "../src/lib/bank-forecast";
import { bankFilters, selectBankTransactions } from "../src/lib/banking";
import type { BankTransaction } from "../src/lib/banking-types";

const today = "2026-10-08";
export function insightsFixture() {
  const data = fixture();
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", sourceSubId: "branch", name: "テスト分析口座", serviceName: "Test", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
  data.bankTransactions = [];
  data.accountingCategories = [{ id: "rent", company: "JAPAN", name: "地代家賃", group: "経費", available: true, createdAt: timestamp, updatedAt: timestamp }];
  data.bankSyncStates = [{ id: "sync", company: "JAPAN", officeCode: "office", officeName: "Test", autoSync: false, status: "SUCCESS", imported: 0, updated: 0, lastSuccessAt: `${today}T00:00:00Z`, createdAt: timestamp, updatedAt: timestamp }];
  recordBankCoverage(data.bankSyncStates[0], "2026-04-01", today, ["bank"]);
  return data;
}
function add(data: ReturnType<typeof fixture>, date: string, amount: number, content = "定期テスト家賃", patch: Partial<BankTransaction> = {}) {
  const id = String(data.bankTransactions.length);
  const row: BankTransaction = { id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: "bank", transactionDate: date, amount, side: "EXPENSE", content, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch };
  data.bankTransactions.push(row); return row;
}
const report = (data: ReturnType<typeof fixture>, month = "2026-10", date = today) => bankSpendingInsights(data, "JAPAN", "bank", month, date);

test("current month compares the same elapsed days, not the previous full month", () => {
  const data = insightsFixture();
  add(data, "2026-09-08", 100, "test", { categoryId: "rent" });
  add(data, "2026-09-09", 9000);
  add(data, today, 150, "test", { categoryId: "rent" });
  const result = report(data);
  assert.equal(result.current.amount, 150); assert.equal(result.previous.amount, 100);
  assert.equal(result.delta, 50); assert.equal(result.percent, 50);
  assert.equal(result.previous.end, "2026-09-08"); assert.equal(result.partial, true);
  assert.equal(result.categories[0].delta, 50);
});

test("closed months compare whole calendar months and month-end clamps correctly", () => {
  const data = insightsFixture(); add(data, "2026-09-30", 123);
  assert.equal(report(data, "2026-09").current.amount, 123);
  assert.equal(report(data, "2026-09").previous.end, "2026-08-31");
  assert.equal(report(data, "2026-09").partial, false);
  assert.equal(report(data, "2026-03", "2026-03-30").previous.end, "2026-02-28");
  assert.equal(report(data, "2024-03", "2024-03-30").previous.end, "2024-02-29");
});

test("unknown empty periods are not zero baselines; observed comparisons are qualified", () => {
  const data = insightsFixture(); data.bankSyncStates[0].coverage = [];
  add(data, today, 100);
  assert.equal(report(data).delta, null); assert.equal(report(data).percent, null);
  assert.equal(report(data).previous.known, false);
  add(data, "2026-09-08", 50);
  assert.equal(report(data).delta, 50); assert.equal(report(data).comparisonConfirmed, false);
  recordBankCoverage(data.bankSyncStates[0], "2026-09-01", today, ["bank"]);
  assert.equal(report(data).comparisonConfirmed, true);
});

test("confirmed zero baseline has an absolute increase but no infinite percent", () => {
  const data = insightsFixture(); add(data, today, 100);
  assert.equal(report(data).delta, 100); assert.equal(report(data).percent, null);
});

test("scope excludes other company, office, account, income, future, missing and transfers", () => {
  const data = insightsFixture(); add(data, today, 100);
  for (const patch of [{ company: "CHINA" as const }, { officeCode: "another" }, { bankAccountId: "another" }, { side: "INCOME" as const }, { transactionDate: "2026-10-09" }, { sourceMissing: true }, { treatment: "TRANSFER" as const }, { treatment: "EXCLUDED" as const }]) add(data, today, 999, "other", patch);
  const result = report(data);
  assert.equal(result.current.amount, 100); assert.equal(result.current.count, 1);
  assert.deepEqual(result.excluded, { transfer: 999, excluded: 999, missing: 1 });
  assert.throws(() => bankSpendingInsights(data, "CHINA", "bank", "2026-10", today));
});

test("category totals and contribution deltas reconcile to the headline", () => {
  const data = insightsFixture();
  add(data, today, 150, "rent", { categoryId: "rent", reviewed: true }); add(data, today, 50);
  add(data, "2026-09-02", 100, "rent", { categoryId: "rent" }); add(data, "2026-09-03", 75);
  const result = report(data);
  assert.equal(result.categories.reduce((v, row) => v + row.amount, 0), result.current.amount);
  assert.equal(result.categories.reduce((v, row) => v + row.delta!, 0), result.delta);
  assert.equal(result.categories.reduce((v, row) => v + row.share, 0), 100);
  assert.deepEqual(result.unclassified, { count: 1, amount: 50 }); assert.equal(result.unreviewed, 1);
});

test("duplicate candidates require different source IDs and exact normalized content/date/amount", () => {
  const data = insightsFixture(); add(data, today, 120, " ＡＢＣ  SHOP "); add(data, today, 120, "abc shop");
  add(data, today, 130, "abc shop"); add(data, "2026-10-07", 120, "abc shop");
  const result = report(data);
  assert.equal(result.alertCount, 1); assert.equal(result.alerts[0].kind, "DUPLICATE");
  assert.equal(result.alerts[0].amount, 240); assert.equal(result.alerts[0].observations, 2);
  data.bankTransactions[1].sourceId = data.bankTransactions[0].sourceId;
  assert.equal(report(data).alertCount, 0);
});

test("generic or empty descriptions and different numbers do not identify a payee", () => {
  const data = insightsFixture();
  for (const content of ["", "振込", "口座振替", "ATM", "カード利用"]) { add(data, today, 100, content); add(data, today, 100, content); }
  add(data, today, 100, "支払 123"); add(data, today, 100, "支払 124");
  assert.equal(report(data).alertCount, 0);
});

test("recurring increase needs three consecutive stable months and one current payment", () => {
  const data = insightsFixture();
  for (const date of ["2026-07-03", "2026-08-03", "2026-09-03"]) add(data, date, 100);
  add(data, today, 120);
  let result = report(data);
  assert.equal(result.alertCount, 1); assert.equal(result.alerts[0].kind, "RECURRING_INCREASE");
  assert.equal(result.alerts[0].baseline, 100); assert.equal(result.alerts[0].previous.length, 3);
  data.bankTransactions[0].amount = 150; assert.equal(report(data).alertCount, 0);
  data.bankTransactions[0].amount = 100;
  add(data, today, 120);
  result = report(data); assert.equal(result.alertCount, 1); assert.equal(result.alerts[0].kind, "DUPLICATE");
});

test("large outflows require enough prior months and robust distance from the median", () => {
  const data = insightsFixture();
  for (const date of ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-02", "2026-09-02"]) add(data, date, 100, "制作支払テスト");
  add(data, today, 200, "制作支払テスト");
  assert.equal(report(data).alerts[0].kind, "RECURRING_INCREASE");
  add(data, "2026-09-05", 100, "制作支払テスト");
  assert.equal(report(data).alerts[0].kind, "LARGE");
  data.bankTransactions[5].amount = 199; assert.equal(report(data).alertCount, 0);
  data.bankTransactions[5].amount = 200;
  data.bankTransactions = data.bankTransactions.filter((row) => row.transactionDate >= "2026-07-01");
  assert.equal(report(data).alertCount, 0);
});

test("volatile history is not called a stable price increase or large outlier", () => {
  const data = insightsFixture();
  [10, 500, 40, 60, 80, 300].forEach((value, index) => add(data, `2026-0${index + 4}-02`, value));
  add(data, today, 160); add(data, "2026-10-06", 10);
  assert.equal(report(data).alertCount, 0);
});

test("analysis is read-only including reviewed payments and source records", () => {
  const data = insightsFixture(); add(data, today, 120, "テストショップ", { reviewed: true }); add(data, today, 120, "テストショップ", { reviewed: true });
  const before = JSON.stringify(data);
  assert.equal(report(data).alertCount, 1); assert.equal(JSON.stringify(data), before);
});

test("exact-account selector maps unused parents to children without combining accounts", () => {
  const data = insightsFixture(), branch = data.bankAccounts[0];
  data.bankAccounts.unshift({ ...branch, id: "parent", sourceSubId: undefined });
  add(data, today, 100);
  assert.deepEqual(bankAnalysisAccounts(data, "JAPAN", "parent").accounts.map((row) => row.id), ["bank"]);
  assert.equal(bankAnalysisAccounts(data, "JAPAN", "parent").account?.id, "bank");
  assert.equal(bankAnalysisAccounts(data, "CHINA", "bank").account, undefined);
  assert.equal(bankAnalysisAccounts(data, "JAPAN", "nonexistent").account, undefined);
});

test("drill-down shows only the specified transaction and cannot cross companies", () => {
  const data = insightsFixture(); const row = add(data, today, 100); add(data, today, 100);
  const filters = bankFilters({ transaction: row.id });
  assert.deepEqual(selectBankTransactions(data, "JAPAN", filters).rows.map((item) => item.id), [row.id]);
  assert.equal(selectBankTransactions(data, "CHINA", filters).total, 0);
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ transaction: "missing" })).total, 0);
});

test("invalid and future months are rejected or normalized by the route parser", () => {
  for (const value of [undefined, "2026-13", "2026-11", "0000-01", "0099-01", "invalid"]) assert.equal(spendingMonth(value, today), "2026-10");
  assert.throws(() => report(insightsFixture(), "2026-11"));
  assert.throws(() => report(insightsFixture(), "2026-10", "2026-10-40"));
});

test("category drill-down exactly reconciles with the analysis period and account", () => {
  const data = insightsFixture(); add(data, today, 100);
  add(data, today, 999, "test", { sourceMissing: true });
  add(data, today, 999, "test", { treatment: "TRANSFER" });
  add(data, "2026-10-09", 999);
  add(data, today, 999, "test", { bankAccountId: "child" });
  add(data, today, 999, "test", { officeCode: "another" });
  data.bankAccounts.push({ ...data.bankAccounts[0], id: "child", sourceSubId: "another" });
  const result = selectBankTransactions(data, "JAPAN", bankFilters({ account: "bank", month: "2026-10", analysisThrough: today }));
  assert.equal(result.total, 1); assert.equal(result.summary.expense, report(data).current.amount);
  assert.equal(bankFilters({ analysisThrough: "2026-02-30" }).analysisThrough, undefined);
});

test("10,000 rows have bounded alert evidence, deterministic results and no mutation", () => {
  const data = insightsFixture();
  for (let i = 0; i < 10000; i++) add(data, today, 10 + i % 80, `テスト支払 ${i % 80}`);
  const result = report(data);
  assert.equal(result.alertCount, 80); assert.equal(result.alerts.length, 50);
  assert.ok(result.alerts.every((row) => row.rows.length <= 8));
  assert.ok(JSON.stringify(result).length < 100000);
  assert.deepEqual(result, report(data));
});
