import { bankClassificationLabel, type ClassificationLabelRow } from "@/lib/bank-classification";

// Presentation only. Keep the existing classification / guess-review decision functions intact.
export function bankClassificationPresentation(row: ClassificationLabelRow) {
  const status = row.bookkeeping?.hold ? { kind: "HELD", label: "保留" } as const
    : row.reviewed ? { kind: "REVIEWED", label: "確認済み" } as const
      : { kind: "UNREVIEWED", label: "未確認" } as const;
  const confidence = bankClassificationLabel({ ...row, reviewed: false, bookkeeping: undefined }).kind;
  const basis = row.sourceMissing ? { kind: "MISSING", label: "元明細なし" }
    : row.treatment === "TRANSFER" ? { kind: "TRANSFER", label: "振替" }
      : row.treatment === "EXCLUDED" ? { kind: "EXCLUDED", label: "対象外" }
        : row.bookkeeping?.splits?.length ? { kind: "SPLIT", label: "科目分割" }
          : !row.categoryId ? { kind: "UNAVAILABLE", label: "候補なし" }
            : confidence === "GUESS" ? { kind: "GUESS", label: "推測" }
              : confidence === "HISTORY" ? { kind: "HISTORY", label: "過去実績" }
                : row.classificationSource === "RULE" ? { kind: "RULE", label: "ルール" }
                  : row.classificationSource === "MANUAL" ? { kind: "MANUAL", label: "手動" }
                    : { kind: "INFERRED", label: "推定" };
  return { basis, status, reason: row.classificationReason || "分類の理由は記録されていません" };
}
