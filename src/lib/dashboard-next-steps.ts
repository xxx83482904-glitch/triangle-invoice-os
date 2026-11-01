import { bankReconciliationOverview } from "@/lib/bank-reconciliation";
import type { DashboardSummary } from "@/lib/dashboard";
import { dashboardWorkRows, type DashboardNextStep } from "@/lib/dashboard-work";
import { integrityReport } from "@/lib/integrity";
import { can } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

export function dashboardNextSteps(data: AppData, user: Pick<User, "id" | "role">, summary: DashboardSummary, fileExists?: (url?: string) => boolean | undefined): DashboardNextStep[] {
  if (summary.company !== "JAPAN") return [];
  const query = "company=JAPAN";
  const steps: DashboardNextStep[] = [];
  const deadline = (view: "income" | "expense", timing: "overdue" | "soon") => {
    const rows = dashboardWorkRows(summary, view, timing);
    const verb = view === "income" ? "入金" : "支払";
    steps.push({ id: `${view}-${timing}`, label: timing === "overdue" ? `${verb}期限を過ぎた${view === "income" ? "未入金" : "未払い"}` : `7日以内に期限が来る${view === "income" ? "未入金" : "未払い"}`,
      count: rows.length, amount: rows.reduce((sum, row) => sum + Math.round(row.remaining * 100), 0) / 100,
      reason: timing === "overdue" ? `${verb}期限を過ぎています。記録と対応状況を確認してください。` : `今日から7日以内が${verb}期限です。`, target: { view, timing } });
  };
  deadline("expense", "overdue"); deadline("income", "overdue");
  const overview = can(user, "view:banking") ? bankReconciliationOverview(data, "JAPAN", summary.today) : undefined;
  if (overview) {
    const integrity = integrityReport(data, "JAPAN", { today: summary.today, overview, fileExists });
    steps.push({ id: "integrity", label: "整合性チェックの要対応", count: integrity.severity.ERROR, reason: "照合や支払記録などに不整合があります。",
      caveat: "開く先は警告・参考も含む一覧のため、総件数は異なります。既知は除外しています。", target: { href: `/banking/integrity?${query}` } });
  }
  deadline("expense", "soon"); deadline("income", "soon");
  steps.push({ id: "documents", label: "書類確認", count: summary.review.length, reason: "下書き・入力不足・支払記録の確認が残っています。", target: { view: "review", timing: "all" } });
  if (overview) {
    steps.push({ id: "bank-unreviewed", label: "未確認の口座明細", count: summary.banking.unreviewed, reason: "科目と内容の確認が残っています。", target: { href: `/banking?${query}&status=unreviewed` } });
    steps.push({ id: "bank-unmatched", label: "銀行・書類照合の未照合", count: overview.banks.filter((row) => row.state === "unmatched").length, reason: "対応する書類との照合が残っています。", target: { href: `/banking/reconcile?${query}&status=unmatched` } });
  }
  if (can(user, "view:mailSorter")) steps.push({ id: "mail", label: "未処理の郵便物", count: summary.pendingMail, reason: "手動の書類整理が未処理です。",
    caveat: "未処理の受領請求書を含む件数です。開く先は郵便物全件のため件数が異なります。", target: { href: `/mail-sorter?${query}` } });
  return steps.filter((step) => step.count > 0);
}
