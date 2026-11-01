import { Check } from "lucide-react";

export function ReviewStatusTag({ reviewed, missing = false }: { reviewed: boolean; missing?: boolean }) {
  return <span className={`bank-review-tag whitespace-nowrap ${missing ? "is-missing" : reviewed ? "is-reviewed" : ""}`}>
    {reviewed ? <Check className="size-3 shrink-0" /> : null}{missing ? "元明細なし" : reviewed ? "確認済み" : "未確認"}
  </span>;
}
