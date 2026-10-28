import type { DocumentRow } from "@/lib/documents";
import { groupDocuments } from "@/lib/document-order";

export type IssuedGrouping = "none" | "month" | "client" | "project";
export function groupIssuedDocuments(rows: DocumentRow[], grouping: IssuedGrouping, limit: number): [string, DocumentRow[]][] {
  return grouping === "none" ? [["all", rows.slice(0, limit)]] : groupDocuments(rows, grouping === "month" ? "date-desc" : grouping, limit);
}

export function issuedRowAmounts(row: DocumentRow) {
  const total = row.total || 0, paid = row.paidAmount || 0;
  return { total, paid, outstanding: row.kind === "issued" && !["DRAFT", "CANCELED"].includes(row.status) ? Math.max(0, total - paid) : 0 };
}

export function issuedListSummary(rows: DocumentRow[]) {
  return rows.reduce((summary, row) => {
    if (row.kind !== "issued") return summary;
    if (row.needsReview) summary.review++;
    if (["DRAFT", "CANCELED"].includes(row.status)) return summary;
    const amounts = issuedRowAmounts(row);
    summary.total += amounts.total; summary.paid += amounts.paid; summary.outstanding += amounts.outstanding;
    return summary;
  }, { total: 0, paid: 0, outstanding: 0, review: 0 });
}
