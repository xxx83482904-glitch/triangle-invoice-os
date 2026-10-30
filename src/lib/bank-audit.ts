import { createHash } from "node:crypto";
import { assertBankAccess } from "@/lib/banking";
import { assertCan } from "@/lib/rbac";
import type { CompanyScope } from "@/lib/company";
import type { AppData, AuditLog, User } from "@/lib/types";
import type { BankTransaction } from "@/lib/banking-types";

type Change = { collection: string; id: string; index: number; before: BankTransaction | null; afterHash?: string };
function changes(log: AuditLog): Change[] {
  const patch = log.beforeStateJson as { format?: string; changes?: Change[] } | undefined;
  return patch?.format === "triangle-undo-patch-v1" && Array.isArray(patch.changes) ? patch.changes : [];
}
const fingerprint = (row: unknown) => createHash("sha256").update(JSON.stringify(row ?? null)).digest("hex");
const ownedChanges = (data: AppData, log: AuditLog, company: CompanyScope) => {
  const list = changes(log);
  return list.length && list.every((change) => change.collection === "bankTransactions" && change.before?.company === company
    && data.bankTransactions.some((row) => row.id === change.id && row.company === company)) ? list : [];
};
export type BankAuditEntry = { id: string; date: string; actor: string; action: string; count: number; undone: boolean; blocked: string; rows: Array<{ id: string; date: string; content: string; before: string; after: string }> };
function blockedReason(data: AppData, log: AuditLog, list: Change[]) {
  if (log.undoneAt) return "取消済み";
  if (list.some((change) => !change.afterHash)) return "旧履歴のため個別取消は利用できません";
  if (list.some((change) => fingerprint(data.bankTransactions.find((row) => row.id === change.id)) !== change.afterHash)) return "この操作の後に明細が更新されています";
  const ids = new Set(list.map((change) => change.id));
  if (data.bankReconciliations.some((link) => !link.deletedAt && ids.has(link.transactionId))
    || data.bankTransfers?.some((link) => !link.deletedAt && (ids.has(link.incomingId) || ids.has(link.outgoingId)))) return "照合を解除してから分類を戻してください";
  return "";
}
export function bankAuditEntries(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope): BankAuditEntry[] {
  assertBankAccess(user, company);
  const category = new Map(data.accountingCategories.filter((row) => row.company === company).map((row) => [row.id, row.name]));
  const describe = (row: BankTransaction) => {
    const splits = row.bookkeeping?.splits?.map((part) => `${category.get(part.categoryId) || "不明な科目"} ${part.amount.toLocaleString("ja-JP")}円${part.memo ? ` (${part.memo})` : ""}`).join(" + ");
    return [splits || category.get(row.categoryId || "") || "科目なし",
      { NORMAL: "通常", TRANSFER: "振替", EXCLUDED: "対象外" }[row.treatment],
      row.reviewed ? "確認済み" : "未確認", row.memo,
      row.bookkeeping?.hold ? `保留: ${row.bookkeeping.hold.question || "要確認"}` : "",
      row.bookkeeping?.invoiceRequirement === "NOT_REQUIRED" ? "請求書不要" : "",
    ].filter(Boolean).join(" / ");
  };
  return data.auditLogs.filter((log) => /^BANK_(CLASSIFY|BOOKKEEPING)/.test(log.action)).flatMap((log) => {
    const list = ownedChanges(data, log, company);
    if (!list.length) return [];
    return [{ id: log.id, date: log.createdAt, actor: data.users.find((row) => row.id === log.userId)?.name || "利用者", action: log.action === "BANK_CLASSIFY" ? "分類・確認" : "内訳・保留", count: list.length, undone: Boolean(log.undoneAt), blocked: blockedReason(data, log, list), rows: list.map((change) => {
      const row = data.bankTransactions.find((row) => row.id === change.id)!;
      return { id: row.id, date: row.transactionDate, content: row.content, before: describe(change.before!), after: describe(row) };
    }) }];
  }).slice(0, 50);
}
export function bankAuditUndoPatch(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, id: string) {
  assertBankAccess(user, company); assertCan(user, "undo:changes");
  const log = data.auditLogs.find((row) => row.id === id && /^BANK_(CLASSIFY|BOOKKEEPING)/.test(row.action));
  if (!log) throw new Error("操作履歴が見つかりません");
  const list = ownedChanges(data, log, company);
  if (!list.length) throw new Error("この操作は個別に取り消せません");
  const blocked = blockedReason(data, log, list);
  if (blocked) throw new Error(blocked);
  return { log, patch: log.beforeStateJson };
}
