import { Badge } from "@/components/ui/badge";
import type { IssuedInvoiceStatus, ProjectStatus, ReceivedInvoiceStatus } from "@/lib/types";

const labels = {
  PLANNING: "計画中",
  IN_PROGRESS: "進行中",
  WAITING: "待機",
  COMPLETED: "完了",
  ARCHIVED: "アーカイブ",
  DRAFT: "下書き",
  ISSUED: "発行済み",
  SENT: "送付済み",
  WAITING_PAYMENT: "入金待ち",
  PARTIALLY_PAID: "一部入金",
  PAID: "入金/支払済み",
  OVERDUE: "期限超過",
  CANCELED: "キャンセル",
  REISSUED: "再発行済み",
  RECEIVED: "受領済み",
  OCR_PENDING: "読み取り待ち",
  REVIEWING: "確認中",
  APPROVAL_PENDING: "承認待ち",
  SCHEDULED: "支払予定",
  ON_HOLD: "保留",
  REJECTED: "差し戻し",
} satisfies Partial<Record<ProjectStatus | IssuedInvoiceStatus | ReceivedInvoiceStatus, string>>;

export function StatusBadge({
  status,
}: {
  status: ProjectStatus | IssuedInvoiceStatus | ReceivedInvoiceStatus | string;
}) {
  const tone =
    status === "OVERDUE" || status === "REJECTED"
      ? "border-red-300 bg-red-50 text-red-700"
      : status === "APPROVAL_PENDING" || status === "WAITING_PAYMENT" || status === "PARTIALLY_PAID"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : status === "PAID" || status === "COMPLETED"
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-border bg-muted text-foreground";

  return (
    <Badge variant="outline" className={tone}>
      {labels[status as keyof typeof labels] ?? status}
    </Badge>
  );
}
