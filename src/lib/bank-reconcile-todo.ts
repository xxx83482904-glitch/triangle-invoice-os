import { inferObligationKind } from "@/lib/obligation-classification";
import { payrollCategoryPattern } from "@/lib/payroll-settings";

export const RECONCILE_TODO_STATUS = "todo";
export const RECONCILE_TODO_NOTE = "今月と先月の明細のうち、請求書が必要なものです。手数料・利息・税金・保険料・給与・返済は除いています。";

type TodoRow = { state: string; date: string; content: string; categoryName?: string; invoiceRequirement?: string };

// The dashboard asks people to clear this month and last month. Older rows stay in the full list.
export function reconcileTodoSince(today: string) {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}

const compact = (value: string) => value.normalize("NFKC").replace(/\s+/g, "");
const noDocumentContent = /手数料|振込料|テスウリ[ヨョ]ウ|利息|リソク|給与|給料|賞与|キ[ユュ][ウー]ヨ|シ[ヨョ]ウヨ|返済|ヘンサイ|国庫金|コ[ツッ]コキン|ゼイムシ[ヨョ]|ゼイキン|ネンキン|シ[ヤャ]カイホケン|ロウドウホケン/;
const noDocumentCategory = /利息|租税公課|法人税|消費税|源泉所得税|住民税|社会保険料|法定福利|税金|借入|返済/;

// A default for undecided rows only: rows set to 請求書必要 always count. The rows stay in the full list.
export function noDocumentExpected(row: Pick<TodoRow, "content" | "categoryName" | "invoiceRequirement">) {
  if (row.invoiceRequirement === "REQUIRED") return false;
  const content = compact(row.content), category = compact(row.categoryName || "");
  return noDocumentContent.test(content) || Boolean(inferObligationKind(content)) || noDocumentCategory.test(category) || payrollCategoryPattern.test(category);
}

export function isReconcileTodo(row: TodoRow, today: string) {
  return row.state === "unmatched" && row.date >= reconcileTodoSince(today) && !noDocumentExpected(row);
}
