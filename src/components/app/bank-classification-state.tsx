import { bankClassificationPresentation } from "@/lib/bank-classification-presentation";
import type { ClassificationLabelRow } from "@/lib/bank-classification";

export function BankClassificationState({ row }: { row: ClassificationLabelRow }) {
  const { basis, status } = bankClassificationPresentation(row);
  return <div className="flex flex-wrap items-center gap-1">
    <span data-classification={basis.kind} aria-label={`根拠: ${basis.label}`} title="分類の根拠（理由は記帳詳細で確認できます）" className="inline-flex whitespace-nowrap rounded border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{basis.label}</span>
    <span aria-label={`状態: ${status.label}`} className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold ${status.kind === "REVIEWED" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : status.kind === "HELD" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-300 bg-amber-50 text-amber-800"}`}>{status.label}</span>
  </div>;
}
