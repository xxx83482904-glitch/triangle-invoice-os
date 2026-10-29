import type { AccountingCategory, BankEdit, BankTransaction } from "@/lib/banking-types";

export const bankCategorySections = [
  { id: "EXPENSE", label: "経費・仕入", tone: "text-rose-700 dark:text-rose-300" },
  { id: "INCOME", label: "売上・収益", tone: "text-emerald-700 dark:text-emerald-300" },
  { id: "ASSET", label: "資産", tone: "text-sky-700 dark:text-sky-300" },
  { id: "LIABILITY", label: "負債", tone: "text-amber-800 dark:text-amber-300" },
  { id: "EQUITY", label: "純資産", tone: "text-violet-700 dark:text-violet-300" },
  { id: "OTHER", label: "その他", tone: "text-muted-foreground" },
] as const;

export function bankCategorySection(group: string) {
  const normalized = group.trim().toUpperCase();
  const id = normalized === "REVENUE" ? "INCOME" : normalized === "CAPITAL" ? "EQUITY" : normalized;
  return bankCategorySections.find((section) => section.id === id) ?? bankCategorySections[5];
}

export function categorySupportsTransactions(category: AccountingCategory, rows: BankTransaction[]) {
  return category.available && !category.deletedAt && rows.every((row) =>
    row.company === category.company && (!category.officeCode || category.officeCode === row.officeCode));
}

const normalizedSearch = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();

export function bankCategoryCatalog(categories: AccountingCategory[], rows: BankTransaction[] = [], search = "") {
  const query = normalizedSearch(search);
  const available = categories.filter((category) => categorySupportsTransactions(category, rows));
  return bankCategorySections.map((section) => ({
    ...section,
    entries: available.filter((category) => !category.parentId && bankCategorySection(category.group).id === section.id)
      .map((category) => {
        const children = available.filter((child) => child.parentId === category.id).sort((a, b) => a.name.localeCompare(b.name, "ja"));
        const parentMatches = normalizedSearch(`${section.label} ${category.name}`).includes(query);
        return { category, children: parentMatches ? children : children.filter((child) => normalizedSearch(child.name).includes(query)), parentMatches };
      })
      .filter((entry) => entry.parentMatches || entry.children.length)
      .sort((a, b) => a.category.name.localeCompare(b.category.name, "ja")),
  })).filter((section) => section.entries.length);
}

export function applyBankCategoryDrafts(rows: BankTransaction[], drafts: Record<string, BankEdit>, category: AccountingCategory, child?: AccountingCategory) {
  if (category.parentId || !categorySupportsTransactions(category, rows) ||
    (child && (child.parentId !== category.id || !categorySupportsTransactions(child, rows)))) {
    throw new Error("選択した明細に適用できない科目です");
  }
  const next = { ...drafts };
  for (const row of rows) {
    const current = drafts[row.id] ?? row;
    next[row.id] = {
      id: row.id, updatedAt: current.updatedAt, memo: current.memo, treatment: current.treatment,
      categoryId: category.id, subCategoryId: child?.id, reviewed: false,
      classificationSource: "MANUAL", classificationConfidence: "INFERRED", classificationReason: "手動選択（未確定）",
    };
  }
  return next;
}
