import type { ExpenseClaim, ExpenseClaimAction, ExpenseClaimStatus, ExpensePaidWith, User } from "@/lib/types";

export const expenseStatuses = ["SUBMITTED", "RETURNED", "APPROVED", "PAID", "WITHDRAWN"] as const;
export const expenseStatusLabels: Record<ExpenseClaimStatus, string> = {
  SUBMITTED: "申請中", RETURNED: "差戻し", APPROVED: "承認済み", PAID: "精算済み", WITHDRAWN: "取り下げ",
};
export const expensePaidWithLabels: Record<ExpensePaidWith, string> = { CASH: "現金", PERSONAL_CARD: "個人カード", OTHER: "その他" };
export const expenseActionLabels: Record<ExpenseClaimAction, string> = {
  SUBMIT: "提出", EDIT: "修正", RESUBMIT: "再提出", WITHDRAW: "取り下げ", APPROVE: "承認", RETURN: "差戻し", PAY: "精算", UNPAY: "精算取消", LINK_BANK: "口座明細と照合", UNLINK_BANK: "照合解除",
};

export function expenseMonth(row: Pick<ExpenseClaim, "spentOn">) {
  return row.spentOn.slice(0, 7);
}

export function expenseEditableBy(actor: Pick<User, "id">, row: Pick<ExpenseClaim, "submittedById" | "status">) {
  return row.submittedById === actor.id && (row.status === "SUBMITTED" || row.status === "RETURNED");
}
