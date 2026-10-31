import assert from "node:assert/strict";
import test from "node:test";
import { bankClassificationLabel, createBankSuggester } from "../src/lib/bank-classification";
import { bankDisplayRows, previewBankRules, saveBankEdits } from "../src/lib/banking";
import type { AccountingCategory, BankEdit, BankTransaction } from "../src/lib/banking-types";
import { admin, fixture, timestamp } from "./document-fixture";

const office = "0000-0001";
const category = (id: string, name: string, extra: Partial<AccountingCategory> = {}): AccountingCategory => ({
  id, name, company: "JAPAN", officeCode: office, group: "EXPENSE", available: true,
  createdAt: timestamp, updatedAt: timestamp, ...extra,
});
const transaction = (extra: Partial<BankTransaction> = {}): BankTransaction => ({
  id: "candidate", company: "JAPAN", officeCode: office, sourceId: "candidate", bankAccountId: "bank",
  transactionDate: "2026-10-01", amount: 1200, side: "EXPENSE", content: "Unknown merchant",
  sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL",
  classificationSource: "UNASSIGNED", reviewed: false, memo: "",
  createdAt: timestamp, updatedAt: timestamp, ...extra,
});
function setup() {
  const data = fixture();
  data.accountingCategories = [
    category("fees", "支払手数料"), category("utility", "水道光熱費"), category("supplies", "消耗品費"),
    category("travel", "旅費交通費"), category("misc-expense", "雑費"),
    category("misc-income", "雑収入", { group: "INCOME" }), category("interest", "受取利息", { group: "INCOME" }),
    category("sub", "Office", { parentId: "supplies" }),
  ];
  return data;
}
const confirmed = (extra: Partial<BankTransaction> = {}) => transaction({
  id: "past", sourceId: "past", transactionDate: "2026-09-01", reviewed: true,
  classificationSource: "MANUAL", categoryId: "supplies", ...extra,
});

test("guesses are opt-in, deterministic and never turn merchant identity into evidence", () => {
  const data = setup(), before = structuredClone(data);
  const conservative = createBankSuggester(data), explicitDefault = createBankSuggester(data, { allowGuesses: false });
  const suggest = createBankSuggester(data, { allowGuesses: true });
  for (const content of ["", "Unknown", "AMAZON", "楽天市場", "コンビニ", "保険料", "カード引落", "Suica チャージ", "タクシー 返金", "電気料金と電話料金"]) {
    const row = transaction({ content }), original = structuredClone(row);
    assert.equal(conservative(row), undefined, content);
    assert.equal(explicitDefault(row), undefined, content);
    const result = suggest(Object.freeze(row))!;
    assert.ok(result.categoryId, content);
    assert.equal(result.classificationSource, "AUTO");
    assert.equal(result.classificationConfidence, "GUESS");
    assert.equal(result.treatment, "NORMAL");
    assert.equal(result.subCategoryId, undefined);
    assert.ok(!("reviewed" in result));
    assert.match(result.classificationReason, /未確認/);
    assert.deepEqual(result, suggest(row));
    assert.deepEqual(row, original);
    assert.deepEqual(bankClassificationLabel({ ...row, ...result }), { kind: "GUESS", label: "推測・要確認" });
    result.categoryId = "edited-preview";
    assert.notEqual(suggest(row)!.categoryId, "edited-preview");
  }
  assert.deepEqual(data, before);
});

test("fallback respects direction before weak text hints and stays total with only unusual categories", () => {
  const data = setup(), suggest = createBankSuggester(data, { allowGuesses: true });
  assert.equal(suggest(transaction())!.categoryId, "misc-expense");
  assert.equal(suggest(transaction({ side: "INCOME" }))!.categoryId, "misc-income");
  for (const content of ["新幹線", "振込手数料", "支払手数料"]) {
    const result = suggest(transaction({ content, side: "INCOME" }))!;
    assert.equal(result.categoryId, "misc-income");
    assert.equal(result.classificationConfidence, "GUESS");
  }
  const expense = suggest(transaction({ content: "預金利息" }))!;
  assert.equal(expense.categoryId, "misc-expense");
  assert.equal(expense.classificationConfidence, "GUESS");
  for (const group of ["ASSET", "INCOME", "other", "費用", "収益"]) {
    data.accountingCategories = [category("only", "Custom", { group })];
    const result = createBankSuggester(data, { allowGuesses: true })(transaction())!;
    assert.equal(result.categoryId, "only");
    assert.equal(result.classificationConfidence, "GUESS");
    assert.equal(result.treatment, "NORMAL");
  }
});

test("keyword suggestions including BZ and exchange fees are inferred, not confirmed", () => {
  const data = setup();
  for (const allowGuesses of [false, true]) {
    const suggest = createBankSuggester(data, { allowGuesses });
    for (const content of ["振込手数料", "BZ手数料", "ＢＺ手数料", "bz手数料", "為替手数料"]) {
      const row = transaction({ content }), result = suggest(row)!;
      assert.equal(result.categoryId, "fees", content);
      assert.equal(result.classificationConfidence, "INFERRED");
      assert.equal(result.classificationSource, "AUTO");
      assert.deepEqual(bankClassificationLabel({ ...row, ...result }), { kind: "INFERRED", label: "推定" });
    }
    assert.equal(suggest(transaction({ content: "預金利息", side: "INCOME" }))!.categoryId, "interest");
  }
});

test("no prediction can use a missing, unavailable, deleted, foreign or child category", () => {
  const data = setup();
  const invalid = [
    category("", "支払手数料"), category("disabled", "支払手数料", { available: false }),
    category("deleted", "支払手数料", { deletedAt: timestamp }),
    category("foreign-company", "支払手数料", { company: "CHINA" }),
    category("foreign-office", "支払手数料", { officeCode: "other-office" }),
    category("child", "支払手数料", { parentId: "missing-parent" }),
  ];
  for (const categories of [[], invalid]) {
    data.accountingCategories = categories;
    for (const allowGuesses of [false, true]) {
      assert.equal(createBankSuggester(data, { allowGuesses })(transaction({ content: "振込手数料" })), undefined);
    }
  }
  for (const officeCode of [office, undefined]) {
    data.accountingCategories = [...invalid, category("valid", "Custom", { officeCode })];
    assert.equal(createBankSuggester(data, { allowGuesses: true })(transaction({ content: "振込手数料" }))!.categoryId, "valid");
  }
  data.accountingCategories.push(category("china", "Custom", { company: "CHINA" }));
  assert.equal(createBankSuggester(data, { allowGuesses: true })(transaction({ company: "CHINA" }))!.categoryId, "china");
});

test("exact confirmed history keeps subcategories and requires matching company, office, account, side and content", () => {
  const data = setup();
  data.bankTransactions = [confirmed({ content: "ＡＣＭＥ  SUPPLIES", subCategoryId: "sub" })];
  const before = structuredClone(data), row = transaction({ content: "acme supplies" });
  for (const allowGuesses of [false, true]) {
    const suggest = createBankSuggester(data, { allowGuesses }), result = suggest(row)!;
    assert.equal(result.categoryId, "supplies");
    assert.equal(result.subCategoryId, "sub");
    assert.equal(result.classificationSource, "HISTORY");
    assert.equal(result.classificationConfidence, "HISTORY");
    assert.deepEqual(bankClassificationLabel({ ...row, ...result }), { kind: "HISTORY", label: "過去実績" });
    for (const extra of [{ bankAccountId: "card" }, { side: "INCOME" as const }, { officeCode: "other" }, { company: "CHINA" as const }, { content: "acme supplies online" }]) {
      assert.notEqual(suggest({ ...row, ...extra })?.classificationConfidence, "HISTORY");
    }
  }
  assert.deepEqual(data, before);
});

test("only reviewed history teaches previews, while conservative imports still require MANUAL", () => {
  const data = setup();
  for (const classificationSource of ["MANUAL", "AUTO", "RULE", "HISTORY"] as const) {
    data.bankTransactions = [confirmed({ classificationSource, classificationConfidence: "GUESS" })];
    assert.equal(createBankSuggester(data, { allowGuesses: true })(transaction())!.classificationConfidence, "HISTORY");
    assert.equal(createBankSuggester(data)(transaction())?.classificationConfidence, classificationSource === "MANUAL" ? "HISTORY" : undefined);
    for (const extra of [{ reviewed: false }, { sourceMissing: true }, { sourceStatus: "excluded" }]) {
      data.bankTransactions = [confirmed({ classificationSource, ...extra })];
      assert.equal(createBankSuggester(data, { allowGuesses: true })(transaction())!.classificationConfidence, "GUESS");
    }
  }
});

test("conflicting or invalid history remains red even when a keyword would otherwise be inferred", () => {
  const data = setup(), row = transaction({ content: "電気料金" });
  const invalidSelections: Partial<BankTransaction>[] = [
    { categoryId: "missing" }, { categoryId: undefined }, { categoryId: "sub" },
    { categoryId: "foreign-root" }, { categoryId: "deleted-root" }, { categoryId: "disabled-root" }, { categoryId: "foreign-company" },
    { subCategoryId: "missing" }, { subCategoryId: "foreign-sub" }, { subCategoryId: "deleted-sub" },
    { subCategoryId: "disabled-sub" }, { subCategoryId: "wrong-parent" },
  ];
  data.accountingCategories.push(
    category("foreign-root", "Foreign", { officeCode: "other" }),
    category("deleted-root", "Deleted", { deletedAt: timestamp }),
    category("disabled-root", "Disabled", { available: false }),
    category("foreign-company", "Foreign", { company: "CHINA" }),
    category("foreign-sub", "Foreign sub", { parentId: "supplies", officeCode: "other" }),
    category("deleted-sub", "Deleted sub", { parentId: "supplies", deletedAt: timestamp }),
    category("disabled-sub", "Disabled sub", { parentId: "supplies", available: false }),
    category("wrong-parent", "Other sub", { parentId: "fees" }),
  );
  for (const extra of [{ categoryId: "utility" }, { subCategoryId: "sub" }, ...invalidSelections]) {
    data.bankTransactions = [confirmed({ content: row.content }), confirmed({ id: "conflict", content: row.content, ...extra })];
    assert.equal(createBankSuggester(data)(row), undefined);
    const result = createBankSuggester(data, { allowGuesses: true })(row)!;
    assert.equal(result.categoryId, "utility");
    assert.equal(result.classificationConfidence, "GUESS");
    assert.equal(result.subCategoryId, undefined);
    assert.match(result.classificationReason, /競合|無効/);
    data.bankTransactions.reverse();
    assert.deepEqual(createBankSuggester(data, { allowGuesses: true })(row), result);
  }
});

test("ambiguous category matches are stable red guesses independent of category order", () => {
  const data = setup(), row = transaction({ content: "BZ手数料" });
  data.accountingCategories.push(category("fees-duplicate", "支払手数料"));
  assert.equal(createBankSuggester(data)(row), undefined);
  const result = createBankSuggester(data, { allowGuesses: true })(row)!;
  assert.equal(result.categoryId, "fees");
  assert.equal(result.classificationConfidence, "GUESS");
  data.accountingCategories.reverse();
  assert.deepEqual(createBankSuggester(data, { allowGuesses: true })(row), result);
});

test("preview never guesses transfer or exclusion and protects existing selections and explicit clears", () => {
  const data = setup();
  for (const treatment of ["TRANSFER", "EXCLUDED"] as const) {
    data.bankTransactions = [confirmed({ categoryId: undefined, treatment })];
    assert.equal(createBankSuggester(data)(transaction())!.treatment, treatment);
    const result = createBankSuggester(data, { allowGuesses: true })(transaction())!;
    assert.ok(result.categoryId);
    assert.equal(result.treatment, "NORMAL");
    assert.equal(result.classificationConfidence, "GUESS");
  }
  const suggest = createBankSuggester(data, { allowGuesses: true });
  for (const extra of [
    { reviewed: true }, { sourceMissing: true }, { sourceStatus: "excluded" },
    { treatment: "TRANSFER" as const }, { treatment: "EXCLUDED" as const },
    { classificationSource: "MANUAL" as const }, { categoryId: "fees", classificationSource: "AUTO" as const },
  ]) assert.equal(suggest(transaction({ content: "BZ手数料", ...extra })), undefined);
});

test("labels separate evidence from review and conservatively interpret legacy low AI candidates", () => {
  const row = transaction({ categoryId: "supplies" });
  const cases: Array<[Partial<BankTransaction>, ReturnType<typeof bankClassificationLabel>]> = [
    [{ classificationConfidence: "GUESS" }, { kind: "GUESS", label: "推測・要確認" }],
    [{ classificationConfidence: "HISTORY" }, { kind: "HISTORY", label: "過去実績" }],
    [{ classificationConfidence: "INFERRED" }, { kind: "INFERRED", label: "推定" }],
    [{ classificationSource: "HISTORY" }, { kind: "HISTORY", label: "過去実績" }],
    [{ classificationSource: "RULE" }, { kind: "INFERRED", label: "推定" }],
    [{ classificationSource: "AUTO" }, { kind: "INFERRED", label: "推定" }],
    [{ classificationSource: "MANUAL" }, { kind: "INFERRED", label: "推定" }],
    [{}, { kind: "GUESS", label: "推測・要確認" }],
    [{ reviewed: true, classificationConfidence: "GUESS" }, { kind: "CONFIRMED", label: "分類確定" }],
    [{ categoryId: undefined, classificationConfidence: "HISTORY" }, { kind: "UNAVAILABLE", label: "候補なし" }],
    [{ categoryId: undefined, reviewed: true }, { kind: "UNAVAILABLE", label: "候補なし" }],
    [{ sourceMissing: true, reviewed: true }, { kind: "NOT_APPLICABLE", label: "対象外" }],
    [{ treatment: "TRANSFER" }, { kind: "NOT_APPLICABLE", label: "対象外" }],
    [{ treatment: "EXCLUDED" }, { kind: "NOT_APPLICABLE", label: "対象外" }],
    [{ treatment: "TRANSFER", reviewed: true, categoryId: undefined }, { kind: "CONFIRMED", label: "分類確定" }],
  ];
  for (const [extra, expected] of cases) {
    const input = Object.freeze({ ...row, ...extra });
    assert.deepEqual(bankClassificationLabel(input), expected);
  }
  for (const classificationSource of ["AUTO", "MANUAL"] as const) {
    for (const confidence of ["要確認・推定", "low", "unknown", "確度低", "不明"]) {
      assert.equal(bankClassificationLabel({ ...row, classificationSource, classificationReason: `AI候補（${confidence}）: 根拠不足` }).kind, "GUESS");
    }
    for (const confidence of ["確度高", "要確認"]) {
      assert.equal(bankClassificationLabel({ ...row, classificationSource, classificationReason: `AI候補（${confidence}）: 摘要の根拠` }).kind, "INFERRED");
    }
  }
});

test("BankEdit can carry optional candidate provenance without requiring it for legacy edits", () => {
  const row = transaction(), suggestion = createBankSuggester(setup(), { allowGuesses: true })(row)!;
  const edit: BankEdit = { id: row.id, updatedAt: row.updatedAt, treatment: row.treatment, reviewed: row.reviewed, memo: row.memo };
  const candidate: BankEdit = { ...edit, ...suggestion };
  assert.equal(edit.classificationConfidence, undefined);
  assert.equal(candidate.classificationSource, "AUTO");
  assert.equal(candidate.classificationConfidence, "GUESS");
  assert.equal(candidate.classificationReason, suggestion.classificationReason);
});

test("display and explicit previews share evidence without changing saved rows or versions", () => {
  const data = setup();
  data.bankTransactions = [transaction(), transaction({ id: "fee", content: "BZ手数料" }), transaction({ id: "missing", sourceMissing: true })];
  const before = structuredClone(data);
  const displayed = bankDisplayRows(data, data.bankTransactions);
  const preview = previewBankRules(data, admin, "JAPAN", undefined, true);
  assert.equal(preview.count, 2);
  for (const row of preview.rows) {
    const display = displayed.find((candidate) => candidate.id === row.id)!;
    assert.equal(display.categoryId, row.categoryId);
    assert.equal(display.classificationConfidence, row.classificationConfidence);
    assert.equal(display.predictionPending, true);
    assert.equal(display.updatedAt, timestamp);
    assert.equal(row.updatedAt, timestamp);
    assert.equal(display.reviewed, false);
  }
  assert.deepEqual(displayed[2], before.bankTransactions[2]);
  assert.deepEqual(data, before);
});

test("explicitly saved candidates keep evidence but do not teach history until reviewed", () => {
  for (const confidence of ["GUESS", "HISTORY", "INFERRED"] as const) {
    const data = setup(), row = transaction();
    data.bankTransactions = [row];
    const candidate = { ...bankDisplayRows(data, [row])[0], classificationConfidence: confidence };
    saveBankEdits(data, admin, "JAPAN", [candidate]);
    assert.equal(row.classificationSource, "MANUAL");
    assert.equal(row.classificationConfidence, confidence);
    assert.equal(row.classificationReason, candidate.classificationReason);
    assert.equal(row.reviewed, false);
    assert.equal(bankClassificationLabel(row).kind, confidence);
    assert.equal(createBankSuggester(data, { allowGuesses: true })(transaction({ id: "next" }))!.classificationConfidence, "GUESS");
    if (confidence === "GUESS") assert.throws(() => saveBankEdits(data, admin, "JAPAN", [{ ...row, reviewed: true }]), /推測/);
    saveBankEdits(data, admin, "JAPAN", [{ ...row, reviewed: true, acknowledgeGuess: confidence === "GUESS" }]);
    assert.equal(bankClassificationLabel(row).kind, "CONFIRMED");
    assert.equal(createBankSuggester(data, { allowGuesses: true })(transaction({ id: "next" }))!.classificationConfidence, "HISTORY");
  }
});
