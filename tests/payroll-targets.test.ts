import assert from "node:assert/strict";
import test from "node:test";
import { parsePayrollYear, payrollPeriod, payrollSummary, payrollYearCookieName } from "../src/lib/payroll-summary";
import { payrollFixture } from "./payroll-fixture";
import { isDefaultPayrollCategory, payrollSettingsView, savePayrollSettings, type PayrollSettingsInput } from "../src/lib/payroll-settings";
import { admin, timestamp } from "./document-fixture";
import { assertJapanData } from "../src/lib/japan-storage";
import type { AppData } from "../src/lib/types";

const today = "2026-11-01";
const save = (data: AppData, categoryIds: string[]) => savePayrollSettings(data, admin, "JAPAN", { mode: "CUSTOM", categoryIds, updatedAt: payrollSettingsView(data, "JAPAN").updatedAt });
const accountingData = (data: AppData) => { const copy = structuredClone(data); delete copy.payrollSettings; return copy; };

test("default payroll targets retain officer remuneration and exclude external remuneration, taxes and insurance", () => {
  const summary = payrollSummary(payrollFixture(), "JAPAN", 2026);
  assert.deepEqual(summary.categoryIds.sort(), ["salary", "wage", "bonus", "officer", "retirement", "commute"].sort());
  assert.equal(summary.total, 1290000);
  assert.ok(summary.rows.some((row) => row.payee === "合成ミドリ"));
  assert.ok(!summary.rows.some((row) => /税理士|税務署|区役所|年金|福利/.test(row.payee)));
});

test("default category names match six families, normalize spacing and do not match arbitrary remuneration", () => {
  for (const name of ["給与", "給料手当", "賞与", "役員　報酬", "退職金", "通勤手当"]) assert.ok(isDefaultPayrollCategory(name), name);
  for (const name of ["報酬", "支払報酬", "業務委託報酬", "税理士報酬", "源泉所得税", "住民税", "社会保険料", "法定福利費", "給与の源泉所得税", "役員報酬と支払報酬", "賞与の社会保険料", "税金・給与"]) assert.equal(isDefaultPayrollCategory(name), false, name);
});

test("custom IDs replace defaults, explicitly allow a chosen external category and empty means no targets", () => {
  const data = payrollFixture(), before = accountingData(data);
  save(data, ["officer"]); assert.equal(payrollSummary(data, "JAPAN", 2026).total, 400000);
  save(data, ["fee"]); assert.equal(payrollSummary(data, "JAPAN", 2026).total, 75000);
  save(data, []); assert.deepEqual(payrollSummary(data, "JAPAN", 2026).categoryIds, []); assert.equal(payrollSummary(data, "JAPAN", 2026).total, 0);
  assert.equal(payrollSettingsView(data, "JAPAN").mode, "CUSTOM"); assert.deepEqual(accountingData(data), before);
});

test("reset to defaults restores six families, future default categories stay automatic only in default mode", () => {
  const data = payrollFixture(); save(data, []);
  savePayrollSettings(data, admin, "JAPAN", { mode: "DEFAULT", updatedAt: data.payrollSettings![0].updatedAt });
  assert.equal(payrollSummary(data, "JAPAN", 2026).total, 1290000);
  data.accountingCategories.push({ ...data.accountingCategories[0], id: "new-salary", name: "給料手当" });
  assert.ok(payrollSettingsView(data, "JAPAN").categoryIds.includes("new-salary"));
  save(data, ["salary"]); assert.deepEqual(payrollSettingsView(data, "JAPAN").categoryIds, ["salary"]);
});

test("inactive categories preserve historical totals; deleted, foreign and subcategories cannot be targets", () => {
  const data = payrollFixture(); data.accountingCategories[0].available = false;
  assert.equal(payrollSummary(data, "JAPAN", 2026).total, 1290000); save(data, ["salary"]);
  data.accountingCategories.push({ ...data.accountingCategories[0], id: "child", parentId: "salary", name: "合成従業員" }, { ...data.accountingCategories[0], id: "foreign", company: "CHINA" }, { ...data.accountingCategories[0], id: "deleted", deletedAt: timestamp });
  for (const id of ["child", "foreign", "deleted", "unknown"]) assert.throws(() => save(data, [id]), /科目/);
  data.accountingCategories[0].deletedAt = timestamp;
  assert.deepEqual(payrollSettingsView(data, "JAPAN").missingCategoryIds, ["salary"]); assert.equal(payrollSummary(data, "JAPAN", 2026).total, 0);
  assert.deepEqual(data.payrollSettings![0].categoryIds, ["salary"]);
});

test("same-name categories from different offices remain distinct selectable IDs", () => {
  const data = payrollFixture(); data.accountingCategories.push({ ...data.accountingCategories[0], id: "salary-other", officeCode: "synthetic-second" });
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "other-salary", categoryId: "salary-other", officeCode: "synthetic-second", amount: 12345 });
  save(data, ["salary-other"]); assert.equal(payrollSummary(data, "JAPAN", 2026).total, 12345);
  assert.equal(payrollSettingsView(data, "JAPAN").options.filter((row) => row.name === "給与手当").length, 2);
});

test("settings reject stale first creation and edits without mutating anything", () => {
  const data = payrollFixture(); save(data, ["salary"]); const before = structuredClone(data);
  for (const updatedAt of ["", "stale"]) assert.throws(() => savePayrollSettings(data, admin, "JAPAN", { mode: "CUSTOM", categoryIds: ["officer"], updatedAt }), /更新/);
  assert.deepEqual(data, before);
  const row = data.payrollSettings![0], old = row.updatedAt; save(data, ["officer"]);
  assert.ok(row.updatedAt > old); assert.equal(row.createdById, "admin"); assert.equal(row.updatedById, "admin"); assert.equal(data.payrollSettings!.length, 1);
});

test("settings require permission, company scope, known IDs and valid payloads", () => {
  const data = payrollFixture(), before = structuredClone(data);
  const valid: PayrollSettingsInput = { mode: "CUSTOM", categoryIds: ["salary"], updatedAt: "" };
  for (const role of ["MAIL_EDITOR", "BILLING_EDITOR", "PROJECT_MANAGER", "CHIEF_DESIGNER", "DESIGNER", "GUEST"] as const) assert.throws(() => savePayrollSettings(data, { id: "admin", role }, "JAPAN", valid), /権限/);
  assert.throws(() => savePayrollSettings(data, admin, "CHINA", valid), /日本/);
  for (const input of [{ ...valid, categoryIds: ["salary", "salary"] }, { ...valid, categoryIds: [""] }, { ...valid, mode: "INVALID" }, { ...valid, updatedAt: undefined }, { ...valid, actorId: "another" }]) assert.throws(() => savePayrollSettings(data, admin, "JAPAN", input as PayrollSettingsInput));
  assert.deepEqual(data, before);
  savePayrollSettings(data, { id: "accounting", role: "ACCOUNTING" }, "JAPAN", valid); assert.equal(data.payrollSettings![0].createdById, "accounting");
});

test("company settings cannot affect another company and Japanese storage rejects foreign settings", () => {
  const data = payrollFixture(); data.payrollSettings = [{ id: "cn", company: "CHINA", mode: "CUSTOM", categoryIds: [], createdById: "synthetic", updatedById: "synthetic", createdAt: timestamp, updatedAt: timestamp }];
  assert.equal(payrollSettingsView(data, "JAPAN").mode, "DEFAULT"); assert.equal(payrollSummary(data, "JAPAN", 2026).total, 1290000);
  const foreign = structuredClone(data.payrollSettings[0]); save(data, ["salary"]); assert.deepEqual(data.payrollSettings[0], foreign); assert.throws(() => assertJapanData(data), /中国/);
  data.accountingCategories.unshift({ ...data.accountingCategories[0], company: "CHINA", name: "合成別会社の科目" });
  data.accountingCategories.push({ ...data.accountingCategories[0] });
  const result = save(data, ["salary"]); assert.deepEqual(result.categoryNames, ["給与手当"]);
  assert.deepEqual(payrollSummary(data, "JAPAN", 2026).rows.flatMap((row) => row.categories).filter((name) => name !== "給与手当"), []);
});

test("split rows count only selected allocations and never add the whole transaction again", () => {
  const data = payrollFixture(); data.bankTransactions = data.bankTransactions.filter((row) => row.id === "split");
  assert.equal(payrollSummary(data, "JAPAN", 2026).total, 100000);
  save(data, ["salary", "fee"]); assert.equal(payrollSummary(data, "JAPAN", 2026).total, 120000);
  data.bankTransactions[0].bookkeeping!.splits![0].amount = 90000;
  assert.equal(payrollSummary(data, "JAPAN", 2026).total, 0);
});

test("transfers, source-excluded, missing, foreign, income, invalid dates and nonpositive rows stay out", () => {
  const base = payrollFixture().bankTransactions[0];
  for (const patch of [{ treatment: "TRANSFER" }, { treatment: "EXCLUDED" }, { sourceStatus: "excluded" }, { sourceMissing: true }, { company: "CHINA" }, { side: "INCOME" }, { transactionDate: "2025-09-31" }, { amount: 0 }, { amount: -1 }, { amount: NaN }] as const) {
    const data = payrollFixture(); data.bankTransactions = [{ ...base, ...patch }]; assert.equal(payrollSummary(data, "JAPAN", 2026).total, 0, JSON.stringify(patch));
  }
});

test("default year is latest target year even when newer nonpayroll rows exist", () => {
  const data = payrollFixture();
  assert.deepEqual(payrollPeriod(data, "JAPAN", today), { year: 2026, source: "LATEST_PAYROLL", years: [2027, 2026, 2025, 2024] });
  assert.equal(payrollSummary(data, "JAPAN", 2027).total, 0);
  save(data, ["fee"]); assert.equal(payrollPeriod(data, "JAPAN", today).year, 2027);
});

test("valid URL takes precedence over memory, then latest data, while invalid preferences safely fall back", () => {
  const data = payrollFixture();
  assert.equal(payrollPeriod(data, "JAPAN", today, "2024", "2025").year, 2024);
  assert.equal(payrollPeriod(data, "JAPAN", today, undefined, "2025").source, "REMEMBERED");
  assert.equal(payrollPeriod(data, "JAPAN", today, undefined, "2025").year, 2025);
  assert.equal(payrollPeriod(data, "JAPAN", today, "bad", "2025").year, 2025);
  assert.equal(payrollPeriod(data, "JAPAN", today, "2025.5", "bad").year, 2026);
  assert.equal(payrollPeriod(data, "JAPAN", today, "2027", "2025").year, 2027);
  for (const value of ["", "0", "1900", "2201", "NaN", "Infinity", "2025.1", "2025e0", " 2025", "２０２５"]) assert.equal(parsePayrollYear(value), undefined);
  assert.equal(parsePayrollYear("1901"), 1901); assert.equal(parsePayrollYear("2200"), 2200);
});

test("no target rows falls back to latest bank year, no usable rows falls back to current year", () => {
  const data = payrollFixture(); save(data, []);
  assert.equal(payrollPeriod(data, "JAPAN", today).source, "LATEST_BANK"); assert.equal(payrollPeriod(data, "JAPAN", today).year, 2027);
  data.bankTransactions = []; assert.deepEqual(payrollPeriod(data, "JAPAN", today), { year: 2027, source: "CURRENT", years: [2027] });
  assert.equal(payrollPeriod(data, "JAPAN", today, undefined, "2024").year, 2024);
});

test("future, invalid, missing and foreign rows cannot move the automatic starting year", () => {
  const data = payrollFixture(), base = data.bankTransactions[0];
  data.bankTransactions.push({ ...base, id: "future", transactionDate: "2099-10-01" }, { ...base, id: "invalid", transactionDate: "2026-10-99" }, { ...base, id: "foreign", company: "CHINA", transactionDate: "2026-10-01" }, { ...base, id: "missing", sourceMissing: true, transactionDate: "2026-10-01" });
  assert.equal(payrollPeriod(data, "JAPAN", today).year, 2026); assert.ok(!payrollPeriod(data, "JAPAN", today).years.includes(2100));
});

test("fiscal boundary is September through August and month totals agree with selected allocations", () => {
  const data = payrollFixture(), base = data.bankTransactions[0];
  data.bankTransactions = [{ ...base, id: "aug", transactionDate: "2026-08-31", amount: 100 }, { ...base, id: "sep", transactionDate: "2026-09-01", amount: 200 }];
  assert.equal(payrollSummary(data, "JAPAN", 2026).total, 100); const next = payrollSummary(data, "JAPAN", 2027);
  assert.equal(next.total, 200); assert.equal(next.months[0], "2026-09"); assert.equal(next.months.at(-1), "2027-08"); assert.equal(next.monthTotals["2026-09"], 200);
});

test("year preference cookie keys are isolated by user and company and safe for unusual identifiers", () => {
  assert.notEqual(payrollYearCookieName("admin", "JAPAN"), payrollYearCookieName("accounting", "JAPAN"));
  assert.notEqual(payrollYearCookieName("admin", "JAPAN"), payrollYearCookieName("admin", "CHINA"));
  assert.ok(!/[;\s=]/.test(payrollYearCookieName("合成; user=1", "JAPAN")));
});

test("reading settings, years and summaries never materializes defaults or changes classification and review", () => {
  const data = payrollFixture(); data.bankTransactions[0].classificationConfidence = "GUESS";
  const before = structuredClone(data); payrollPeriod(data, "JAPAN", today); payrollSummary(data, "JAPAN", 2026); payrollSettingsView(data, "JAPAN");
  assert.deepEqual(data, before); assert.equal(Object.hasOwn(data, "payrollSettings"), false);
  save(data, ["salary"]); assert.deepEqual(accountingData(data), before);
});
