import type { AppData } from "@/lib/types";
import type { BankTransaction } from "@/lib/banking-types";

type Selection = Pick<BankTransaction, "categoryId" | "subCategoryId" | "treatment">;
export type BankSuggestion = Selection & {
  classificationSource: "HISTORY" | "AUTO";
  classificationReason: string;
};

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");
const historyKey = (row: BankTransaction) => JSON.stringify([row.company, row.officeCode, row.bankAccountId, row.side, normalize(row.content)]);
const selectionKey = (row: Selection) => JSON.stringify([row.categoryId || "", row.subCategoryId || "", row.treatment]);

// These are provisional suggestions, not journal entries or tax determinations.
const patterns = [
  { category: "支払手数料", side: "EXPENSE", terms: ["振込手数料", "振込料金", "送金手数料", "振込料", "振替手数料", "フリコミテスウリョウ", "フリコミテスウリヨウ"] },
  { category: "水道光熱費", side: "EXPENSE", terms: ["電気料金", "ガス料金", "水道料金", "電力料金", "東京電力", "関西電力", "東京ガス", "大阪ガス", "水道局", "トウキョウデンリョク", "トウキヨウデンリヨク", "トウキョウガス", "トウキヨウガス"] },
  { category: "通信費", side: "EXPENSE", terms: ["電話料金", "携帯電話料金", "インターネット利用料", "通信料金", "切手代", "郵便料金"] },
  { category: "旅費交通費", side: "EXPENSE", terms: ["電車運賃", "新幹線", "タクシー", "高速道路料金", "首都高速", "nexco", "etc利用"] },
  { category: "荷造運賃", side: "EXPENSE", terms: ["宅配便送料", "宅急便送料", "荷物送料"] },
  { category: "受取利息", side: "INCOME", terms: ["預金利息", "受取利息"] },
] as const;

export function createBankSuggester(data: AppData) {
  const categories = new Map(data.accountingCategories.map((row) => [row.id, row]));
  const names = new Map<string, string[]>();
  for (const row of categories.values()) {
    if (row.parentId || !row.available || row.deletedAt) continue;
    const key = JSON.stringify([row.company, normalize(row.name)]);
    names.set(key, [...(names.get(key) || []), row.id]);
  }
  const valid = (row: BankTransaction) => {
    const category = categories.get(row.categoryId || "");
    const sub = categories.get(row.subCategoryId || "");
    return (!row.categoryId || Boolean(category && category.company === row.company && !category.parentId && category.available && !category.deletedAt))
      && (!row.subCategoryId || Boolean(sub && sub.company === row.company && sub.parentId === row.categoryId && sub.available && !sub.deletedAt))
      && (row.treatment !== "NORMAL" || Boolean(row.categoryId));
  };
  const history = new Map<string, Selection | null>();
  for (const row of data.bankTransactions) {
    if (row.classificationSource !== "MANUAL" || !row.reviewed || row.sourceMissing || row.sourceStatus === "excluded" || !normalize(row.content)) continue;
    const key = historyKey(row);
    const previous = history.get(key);
    if (!valid(row) || previous === null || (previous && selectionKey(previous) !== selectionKey(row))) {
      history.set(key, null);
    } else {
      history.set(key, { categoryId: row.categoryId, subCategoryId: row.subCategoryId, treatment: row.treatment });
    }
  }

  return (row: BankTransaction): BankSuggestion | undefined => {
    const key = historyKey(row);
    if (history.has(key)) {
      const previous = history.get(key);
      return previous ? { ...previous, classificationSource: "HISTORY", classificationReason: "同じ口座・入出金・摘要の確認済み明細" } : undefined;
    }
    if (row.company !== "JAPAN") return;
    const content = normalize(row.content);
    // Refunds, card settlements, top-ups and mixed payments need explicit evidence.
    if (/返金|返還|取消|チャージ|立替|精算|カード引落|カード引き落とし/.test(content)) return;
    const matches = patterns.flatMap((pattern) => {
      if (pattern.side !== row.side) return [];
      const term = pattern.terms.find((term) => content.includes(term));
      return term ? [{ pattern, term }] : [];
    });
    if (matches.length !== 1) return;
    const { pattern, term } = matches[0];
    const ids = (names.get(JSON.stringify([row.company, normalize(pattern.category)])) || [])
      .filter((id) => !categories.get(id)!.officeCode || categories.get(id)!.officeCode === row.officeCode);
    if (ids.length !== 1) return;
    return { categoryId: ids[0], subCategoryId: undefined, treatment: "NORMAL", classificationSource: "AUTO", classificationReason: `摘要: ${term}` };
  };
}
