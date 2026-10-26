import assert from "node:assert/strict";
import test from "node:test";
import { bankAccountFilter } from "../src/lib/bank-account-options";
import { bankFilters, mergeBankMasters, mergeBankTransactions, selectBankTransactions, sourceKey } from "../src/lib/banking";
import { fixture } from "./document-fixture";

function accountsFixture() {
  const data = fixture();
  mergeBankMasters(data, "JAPAN", "office", [
    { id: "old", name: "PayPay銀行", serviceName: "PayPay銀行", isManual: false },
    { id: "old", subId: "a", name: "PayPay銀行 / ビジネス営業部 普通 1637691", serviceName: "PayPay銀行", isManual: false },
    { id: "new", name: "PayPay銀行", serviceName: "PayPay銀行", isManual: false },
    { id: "new", subId: "a", name: "PayPay銀行 / ビジネス営業部 普通 １６３７６９１", serviceName: "PayPay銀行", isManual: false },
    { id: "new", subId: "b", name: "PayPay銀行 / ビジネス営業部 普通 6582901", serviceName: "PayPay銀行", isManual: false },
  ], []);
  data.bankAccounts.find((account) => account.sourceId === "old" && account.sourceSubId)!.available = false;
  mergeBankTransactions(data, "JAPAN", "office", [
    { id: "old-tx", connected_account_id: "old", connected_sub_account_id: "a", date: "2026-09-01", value: 1000, side: "INCOME", content: "old", journalizing_status: "none" },
    { id: "new-tx", connected_account_id: "new", connected_sub_account_id: "a", date: "2026-09-02", value: 2000, side: "INCOME", content: "new", journalizing_status: "none" },
    { id: "other-tx", connected_account_id: "new", connected_sub_account_id: "b", date: "2026-09-03", value: 3000, side: "INCOME", content: "other", journalizing_status: "none" },
  ], { start: "2026-09-01", end: "2026-09-30" });
  return data;
}

const id = (source: string, sub = "") => sourceKey("JAPAN", "office", "account", source, sub);

test("account options hide empty connection headers and combine full-number reconnects without deleting data", () => {
  const data = accountsFixture(), before = structuredClone(data);
  const result = bankAccountFilter(data.bankAccounts, data.bankTransactions, "JAPAN");
  assert.equal(result.options.length, 2);
  assert.equal(result.options[0].id, id("new", "a"));
  assert.deepEqual(result.options[0].memberIds.sort(), [id("old", "a"), id("new", "a")].sort());
  assert.deepEqual(data, before);
});

test("old and new account filters include all matching history but exclude other accounts", () => {
  const data = accountsFixture();
  for (const account of [id("old", "a"), id("new", "a")]) {
    const result = selectBankTransactions(data, "JAPAN", bankFilters({ account }));
    assert.equal(result.total, 2); assert.equal(result.summary.income, 3000);
    assert.equal(bankAccountFilter(data.bankAccounts, data.bankTransactions, "JAPAN", account).selectedId, id("new", "a"));
  }
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ account: id("new", "b") })).total, 1);
});

test("bookmarked connection filters retain their original family scope", () => {
  const data = accountsFixture();
  const result = bankAccountFilter(data.bankAccounts, data.bankTransactions, "JAPAN", id("old"));
  assert.equal(result.selectedId, id("old"));
  assert.match(result.options.at(-1)!.name, /全口座/);
  assert.deepEqual([...result.memberIds].sort(), [id("old"), id("old", "a")].sort());
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ account: id("old") })).total, 1);
});

test("headers that own transactions remain reachable and do not widen a selected child", () => {
  const data = accountsFixture();
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "parent-tx", bankAccountId: id("new") });
  const result = bankAccountFilter(data.bankAccounts, data.bankTransactions, "JAPAN", id("old", "a"));
  assert.ok(result.options.some((option) => option.id === id("new")));
  assert.deepEqual([...result.memberIds].sort(), [id("old", "a"), id("new", "a")].sort());
  assert.equal(selectBankTransactions(data, "JAPAN", bankFilters({ account: id("old", "a") })).total, 2);
});

test("same labels never combine companies, offices, banks, branches or short card suffixes", () => {
  const data = accountsFixture(), sample = data.bankAccounts[1];
  data.bankAccounts.push(
    { ...sample, id: "china", company: "CHINA" },
    { ...sample, id: "office2", officeCode: "other-office" },
    { ...sample, id: "other-bank", serviceName: "別銀行" },
    { ...sample, id: "other-branch", name: "PayPay銀行 / 別支店 普通 1637691" },
    { ...sample, id: "card1", name: "カード / 6632" },
    { ...sample, id: "card2", name: "カード / 6632" },
    { ...sample, id: "unnamed1", name: "普通預金" },
    { ...sample, id: "unnamed2", name: "普通預金" },
  );
  const result = bankAccountFilter(data.bankAccounts, data.bankTransactions, "JAPAN");
  assert.equal(result.options.length, 9);
  assert.ok(result.options.every((option) => !option.memberIds.includes("china")));
  assert.equal(selectBankTransactions(data, "CHINA", bankFilters({ account: id("new", "a") })).total, 0);
});

test("analysis evidence links remain exact to the requested account", () => {
  const data = accountsFixture(); data.bankTransactions.forEach((row) => { row.side = "EXPENSE"; });
  const result = selectBankTransactions(data, "JAPAN", bankFilters({ account: id("old", "a"), analysisThrough: "2026-09-30" }));
  assert.equal(result.total, 1); assert.equal(result.summary.expense, 1000);
});
