import type { AppData } from "@/lib/types";
import type { AccountingCategory, BankClassificationConfidence, BankTransaction } from "@/lib/banking-types";
import { bankSettlementClassificationProtected, knownBankCardSettlement } from "@/lib/bank-card-settlement";

type Selection = Pick<BankTransaction, "categoryId" | "subCategoryId" | "treatment">;
export type BankSuggestion = Selection & {
  classificationSource: "HISTORY" | "AUTO";
  classificationReason: string;
  classificationConfidence: BankClassificationConfidence;
};

const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");
const historyKey = (row: BankTransaction) => JSON.stringify([row.company, row.officeCode, row.bankAccountId, row.side, normalize(row.content)]);
const selectionKey = (row: Selection) => JSON.stringify([row.categoryId || "", row.subCategoryId || "", row.treatment]);

// These are provisional suggestions, not journal entries or tax determinations.
const patterns = [
  { category: "支払手数料", side: "EXPENSE", terms: ["振込手数料", "振込料金", "送金手数料", "振込料", "振替手数料", "bz手数料", "為替手数料", "フリコミテスウリョウ", "フリコミテスウリヨウ"] },
  { category: "水道光熱費", side: "EXPENSE", terms: ["電気料金", "ガス料金", "水道料金", "電力料金", "東京電力", "関西電力", "東京ガス", "大阪ガス", "水道局", "トウキョウデンリョク", "トウキヨウデンリヨク", "トウキョウガス", "トウキヨウガス"] },
  { category: "通信費", side: "EXPENSE", terms: ["電話料金", "携帯電話料金", "インターネット利用料", "通信料金", "切手代", "郵便料金"] },
  { category: "旅費交通費", side: "EXPENSE", terms: ["電車運賃", "新幹線", "タクシー", "高速道路料金", "首都高速", "nexco", "etc利用"] },
  { category: "荷造運賃", side: "EXPENSE", terms: ["宅配便送料", "宅急便送料", "荷物送料"] },
  { category: "受取利息", side: "INCOME", terms: ["預金利息", "受取利息"] },
] as const;

const inScope = (category: AccountingCategory, row: BankTransaction) => category.company === row.company
  && (!category.officeCode || category.officeCode === row.officeCode) && category.available && !category.deletedAt;

// Direction ranks candidates, but is not evidence of business use or tax treatment.
export const bankCategorySide = (category: AccountingCategory) => {
  const group = normalize(category.group);
  if (["expense", "費用", "経費"].includes(group)) return "EXPENSE";
  if (["income", "revenue", "収益", "収入"].includes(group)) return "INCOME";
};

export function createBankSuggester(data: AppData, { allowGuesses = false }: { allowGuesses?: boolean } = {}) {
  const categories = new Map(data.accountingCategories.map((row) => [row.id, row]));
  const names = new Map<string, string[]>();
  for (const row of categories.values()) {
    if (!row.id || row.parentId || !row.available || row.deletedAt) continue;
    const key = JSON.stringify([row.company, normalize(row.name)]);
    names.set(key, [...(names.get(key) || []), row.id]);
  }
  const valid = (row: BankTransaction) => {
    const category = categories.get(row.categoryId || "");
    const sub = categories.get(row.subCategoryId || "");
    return (!row.categoryId || Boolean(category && !category.parentId && inScope(category, row)))
      && (!row.subCategoryId || Boolean(row.categoryId && sub && sub.parentId === row.categoryId && inScope(sub, row)))
      && (row.treatment !== "NORMAL" || Boolean(row.categoryId));
  };
  const history = new Map<string, Selection | null>();
  for (const row of data.bankTransactions) {
    // Preview can learn from explicitly reviewed candidates with preserved provenance.
    // Import/sync retain their existing manual-history-only policy.
    if (row.bookkeeping?.splits?.length || row.bookkeeping?.hold || (!allowGuesses && row.classificationSource !== "MANUAL") || !row.reviewed || row.sourceMissing || row.sourceStatus === "excluded" || !normalize(row.content) || knownBankCardSettlement(data, row)) continue;
    const key = historyKey(row);
    const previous = history.get(key);
    if (!valid(row) || previous === null || (previous && selectionKey(previous) !== selectionKey(row))) {
      history.set(key, null);
    } else {
      history.set(key, { categoryId: row.categoryId, subCategoryId: row.subCategoryId, treatment: row.treatment });
    }
  }

  return (row: BankTransaction): BankSuggestion | undefined => {
    if (row.bookkeeping?.splits?.length || row.bookkeeping?.hold) return;
    const settlement = knownBankCardSettlement(data, row);
    if (settlement) {
      if (row.sourceMissing || row.sourceStatus === "excluded" || bankSettlementClassificationProtected(data, row)) return;
      return { categoryId: undefined, subCategoryId: undefined, treatment: "TRANSFER", classificationSource: "AUTO", classificationConfidence: "INFERRED", classificationReason: settlement.reason };
    }
    if (allowGuesses && (row.categoryId || row.reviewed || row.sourceMissing || row.sourceStatus === "excluded" || row.classificationSource === "MANUAL" || row.treatment !== "NORMAL")) return;
    const content = normalize(row.content);
    const matches = row.company === "JAPAN" ? patterns.flatMap((pattern) => {
      if (pattern.side !== row.side) return [];
      const term = pattern.terms.find((term) => content.includes(term));
      return term ? [{ pattern, term }] : [];
    }) : [];
    const guess = (reason: string): BankSuggestion | undefined => {
      if (!allowGuesses) return;
      let closest: AccountingCategory | undefined, bestScore = -1;
      for (const category of categories.values()) {
        if (!category.id || category.parentId || !inScope(category, row)) continue;
        const side = bankCategorySide(category), name = normalize(category.name);
        const related = matches.some(({ pattern }) => normalize(pattern.category) === name) || (name.length > 1 && content.includes(name));
        const generic = (row.side === "EXPENSE" ? ["雑費", "その他費用", "諸経費"] : ["雑収入", "その他収益"]).includes(name);
        const score = (side === row.side ? 100 : side === undefined ? 50 : 0) + (related ? 20 : 0) + (generic ? 10 : 0) + (category.officeCode === row.officeCode ? 1 : 0);
        if (score > bestScore || (score === bestScore && category.id < closest!.id)) {
          closest = category;
          bestScore = score;
        }
      }
      if (!closest) return;
      return { categoryId: closest.id, subCategoryId: undefined, treatment: "NORMAL", classificationSource: "AUTO", classificationConfidence: "GUESS", classificationReason: `${reason}。入出金方向・摘要と利用可能な科目からの仮候補（用途・税務処理は未確認）` };
    };
    const key = historyKey(row);
    if (history.has(key)) {
      const previous = history.get(key);
      if (!previous) return guess("過去の確認済み分類が競合、または参照科目が無効");
      if (allowGuesses && previous.treatment !== "NORMAL") return guess("過去の分類は振替・対象外のため通常取引の根拠にできません");
      return { ...previous, classificationSource: "HISTORY", classificationConfidence: "HISTORY", classificationReason: "同じ口座・入出金・摘要の確認済み明細" };
    }
    // Refunds, card settlements, top-ups and mixed payments need explicit evidence.
    if (/返金|返還|取消|チャージ|立替|精算|カード引落|カード引き落とし/.test(content)) return guess("返金・精算等の取引内容は要確認");
    if (matches.length !== 1) return guess(matches.length ? "複数の摘要キーワードが該当" : "確認済み履歴・明確な摘要の根拠なし");
    const { pattern, term } = matches[0];
    const ids = (names.get(JSON.stringify([row.company, normalize(pattern.category)])) || [])
      .filter((id) => !categories.get(id)!.officeCode || categories.get(id)!.officeCode === row.officeCode);
    if (ids.length !== 1) return guess("摘要に対応する有効な科目を一意に特定できません");
    return { categoryId: ids[0], subCategoryId: undefined, treatment: "NORMAL", classificationSource: "AUTO", classificationConfidence: "INFERRED", classificationReason: `摘要: ${term}` };
  };
}

export type ClassificationLabelRow = Pick<BankTransaction, "categoryId" | "reviewed" | "treatment" | "classificationSource" | "classificationConfidence" | "classificationReason" | "sourceMissing" | "bookkeeping">;
const classificationLabels = {
  GUESS: "推測・要確認",
  HISTORY: "過去実績",
  INFERRED: "推定",
  CONFIRMED: "分類確定",
  UNAVAILABLE: "候補なし",
  NOT_APPLICABLE: "対象外",
} as const;

// Pure presentation state: only explicit review can confirm a classification.
export function bankClassificationLabel(row: ClassificationLabelRow): { kind: keyof typeof classificationLabels; label: string } {
  if (!row.sourceMissing && row.bookkeeping?.hold) return { kind: "GUESS", label: "保留・要確認" };
  if (!row.sourceMissing && row.bookkeeping?.splits?.length && !row.reviewed) return { kind: "INFERRED", label: "科目分割・未確認" };
  let kind: keyof typeof classificationLabels;
  if (row.sourceMissing) kind = "NOT_APPLICABLE";
  else if (row.reviewed && (row.categoryId || row.bookkeeping?.splits?.length || row.treatment !== "NORMAL")) kind = "CONFIRMED";
  else if (row.treatment !== "NORMAL") kind = "NOT_APPLICABLE";
  else if (!row.categoryId) kind = "UNAVAILABLE";
  else if (row.classificationConfidence) kind = row.classificationConfidence;
  else {
    const reason = normalize(row.classificationReason || "");
    // Old low/unknown AI results used "要確認・推定", despite being guesses.
    if (reason.startsWith("ai候補")) kind = /^ai候補\((確度高|要確認)\)/.test(reason) ? "INFERRED" : "GUESS";
    else if (row.classificationSource === "HISTORY") kind = "HISTORY";
    else kind = row.classificationSource === "UNASSIGNED" ? "GUESS" : "INFERRED";
  }
  return { kind, label: classificationLabels[kind] };
}

export const GUESS_REVIEW_BLOCKER = "推測のままの分類です。摘要と科目を確認して「内容を確認して確定」を選ぶか、科目を選び直してください";
export const GUESS_ACKNOWLEDGED_PREFIX = "推測候補を内容確認のうえ確定";

// A guess stays a guess until a person says they looked at it; this decides which rows need that step.
export function isGuessClassification(row: ClassificationLabelRow) {
  return Boolean(row.categoryId) && !row.bookkeeping?.hold && !row.bookkeeping?.splits?.length && row.treatment === "NORMAL"
    && bankClassificationLabel({ ...row, reviewed: false }).kind === "GUESS";
}

export function stripGuessAcknowledgement(reason?: string) {
  if (!reason || !reason.startsWith(GUESS_ACKNOWLEDGED_PREFIX)) return reason;
  return reason.slice(GUESS_ACKNOWLEDGED_PREFIX.length).replace(/^:\s*/, "") || undefined;
}

export function acknowledgedGuessReason(reason?: string) {
  const base = stripGuessAcknowledgement(reason);
  return `${GUESS_ACKNOWLEDGED_PREFIX}${base ? `: ${base}` : ""}`.slice(0, 1000);
}
