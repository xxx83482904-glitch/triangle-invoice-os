import { z } from "zod";
import { assertBankAccess, treatmentLabels } from "@/lib/banking";
import type { CompanyScope } from "@/lib/company";
import type { AppData, User } from "@/lib/types";
import type { BankSyncChange, BankSyncReviewSnapshot, BankSyncRun, BankSyncSourceField, BankTransaction } from "@/lib/banking-types";

type Actor = Pick<User, "id" | "role">;
// Recent runs per company and change rows per run are bounded so the store stays small.
export const BANK_SYNC_RUN_LIMIT = 20;
export const BANK_SYNC_CHANGE_LIMIT = 500;
export const BANK_SYNC_SYSTEM_ACTOR = "system-moneyforward";
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const kindLabels: Record<BankSyncChange["kind"], string> = { CHANGED: "金額・日付・摘要などの変更", META: "連携元の仕訳状態・メモのみ", MISSING: "元明細なし", RESTORED: "元明細が復帰" };
const fieldLabels: Record<BankSyncSourceField, string> = { bankAccountId: "口座", transactionDate: "取引日", amount: "金額", side: "入出金", content: "摘要", sourceMemo: "連携元メモ", sourceStatus: "連携元の仕訳状態", sourceMissing: "元明細" };
const modeLabels: Record<BankSyncRun["mode"], string> = { recent: "通常同期", all: "全期間の再同期", range: "期間指定" };
const statusLabels: Record<BankSyncRun["status"], string> = { RUNNING: "実行中", SUCCESS: "完了", ERROR: "エラー" };
const sourceStatusLabels: Record<string, string> = { none: "未登録", registered: "登録済み", excluded: "対象外" };

export function beginBankSyncRun(data: AppData, input: { runId: string; company: CompanyScope; officeCode: string; actorId: string; mode: BankSyncRun["mode"] }) {
  const timestamp = new Date().toISOString();
  const run: BankSyncRun = { id: `bank-sync-run-${input.runId}`, company: input.company, runId: input.runId, officeCode: input.officeCode, actorId: input.actorId, mode: input.mode, status: "RUNNING", startedAt: timestamp,
    added: 0, changed: 0, metaOnly: 0, missing: 0, restored: 0, reviewCleared: 0, changes: [], truncated: false, createdAt: timestamp, updatedAt: timestamp };
  const runs = [run, ...(data.bankSyncRuns || [])];
  const kept = new Set(runs.filter((row) => row.company === input.company).slice(0, BANK_SYNC_RUN_LIMIT).map((row) => row.id));
  data.bankSyncRuns = runs.filter((row) => row.company !== input.company || kept.has(row.id));
  return run;
}

export function bankSyncRunFor(data: AppData, company: CompanyScope, runId: string) {
  return (data.bankSyncRuns || []).find((row) => row.company === company && row.runId === runId);
}

export function recordBankSyncRange(run: BankSyncRun, start: string, end: string) {
  run.rangeStart = start; run.rangeEnd = end; run.updatedAt = stamp(run.updatedAt);
}

export function recordBankSyncChanges(run: BankSyncRun, result: { imported: number; changes: BankSyncChange[] }) {
  run.added += result.imported;
  for (const change of result.changes) {
    if (change.kind === "CHANGED") run.changed++;
    else if (change.kind === "META") run.metaOnly++;
    else if (change.kind === "MISSING") run.missing++;
    else run.restored++;
    if (change.reviewCleared) run.reviewCleared++;
  }
  // Rows whose review was cleared are kept first so the restore list survives truncation.
  const merged = [...run.changes, ...result.changes];
  const priority = (change: BankSyncChange) => change.reviewCleared ? 0 : change.kind === "META" ? 2 : 1;
  const ordered = merged.map((change, index) => ({ change, index })).sort((a, b) => priority(a.change) - priority(b.change) || a.index - b.index).map((entry) => entry.change);
  if (ordered.length > BANK_SYNC_CHANGE_LIMIT) run.truncated = true;
  run.changes = ordered.slice(0, BANK_SYNC_CHANGE_LIMIT);
  run.updatedAt = stamp(run.updatedAt);
}

export function finishBankSyncRun(run: BankSyncRun, status: "SUCCESS" | "ERROR", error?: string) {
  run.status = status; run.error = error; run.finishedAt = new Date().toISOString(); run.updatedAt = stamp(run.updatedAt);
}

// Empty string means the review state can be restored safely.
export function bankSyncRestoreBlocker(data: AppData, run: BankSyncRun, change: BankSyncChange, row: BankTransaction | undefined) {
  if (!change.reviewCleared || !change.before) return "確認が外れていない明細です";
  if (change.restoredAt) return "復元済み";
  if (!row || row.company !== run.company) return "明細が見つかりません";
  if (row.updatedAt !== change.afterUpdatedAt) return "同期後に編集されています";
  if (row.sourceMissing) return "元明細がありません";
  if (row.bookkeeping?.hold) return "保留中の明細です";
  const before = change.before;
  if (before.treatment === "NORMAL" && !before.categoryId && !row.bookkeeping?.splits?.length) return "勘定科目がありません";
  if (before.categoryId && !data.accountingCategories.some((item) => item.id === before.categoryId && item.company === run.company && !item.parentId && item.available && !item.deletedAt)) return "勘定科目が無効になっています";
  if (before.subCategoryId && !data.accountingCategories.some((item) => item.id === before.subCategoryId && item.company === run.company && item.parentId === before.categoryId && item.available && !item.deletedAt)) return "補助科目が無効になっています";
  if ((data.bankTransfers || []).some((link) => !link.deletedAt && [link.outgoingId, link.incomingId].includes(row.id))) return "資金移動と照合済みです。先に資金移動の照合を確認してください";
  return "";
}

export function pendingBankSyncReviewCount(data: AppData, company: CompanyScope) {
  const rows = new Map(data.bankTransactions.map((row) => [row.id, row]));
  return (data.bankSyncRuns || []).filter((run) => run.company === company)
    .reduce((total, run) => total + run.changes.filter((change) => !bankSyncRestoreBlocker(data, run, change, rows.get(change.transactionId))).length, 0);
}

export type BankSyncRunChangeView = {
  transactionId: string; kind: BankSyncChange["kind"]; kindLabel: string; date: string; account: string; content: string; amount: number; side: "INCOME" | "EXPENSE";
  fields: Array<{ label: string; before: string; after: string }>; reviewCleared: boolean; restorable: boolean; blocked: string; restoredAt?: string; before?: string; current: string;
};
export type BankSyncRunView = {
  id: string; runId: string; startedAt: string; finishedAt?: string; status: BankSyncRun["status"]; statusLabel: string; error?: string; mode: string; range: string; actor: string;
  added: number; changed: number; metaOnly: number; missing: number; restored: number; reviewCleared: number; pending: number; truncated: boolean; changes: BankSyncRunChangeView[];
};

export function bankSyncRunViews(data: AppData, user: Actor, company: CompanyScope): BankSyncRunView[] {
  assertBankAccess(user, company);
  const rows = new Map(data.bankTransactions.map((row) => [row.id, row]));
  const accounts = new Map(data.bankAccounts.map((row) => [row.id, row.name]));
  const categories = new Map(data.accountingCategories.map((row) => [row.id, row.name]));
  const users = new Map(data.users.map((row) => [row.id, row.name]));
  const describe = (state: BankSyncReviewSnapshot) => [state.reviewed ? "確認済み" : "未確認",
    state.categoryId ? `${categories.get(state.categoryId) || "不明な科目"}${state.subCategoryId ? ` / ${categories.get(state.subCategoryId) || "不明な補助科目"}` : ""}` : state.treatment === "NORMAL" ? "科目なし" : "",
    state.treatment !== "NORMAL" ? treatmentLabels[state.treatment] : ""].filter(Boolean).join(" / ");
  const format = (key: BankSyncSourceField, value: string | number | boolean) => key === "side" ? (value === "INCOME" ? "入金" : "出金")
    : key === "bankAccountId" ? accounts.get(String(value)) || String(value)
    : key === "sourceStatus" ? sourceStatusLabels[String(value)] || String(value)
    : key === "sourceMissing" ? (value ? "なし" : "あり")
    : key === "amount" ? `${Number(value).toLocaleString("ja-JP")}円`
    : String(value) || "（空）";
  return (data.bankSyncRuns || []).filter((run) => run.company === company).map((run) => {
    const changes = run.changes.map((change): BankSyncRunChangeView => {
      const row = rows.get(change.transactionId), blocked = bankSyncRestoreBlocker(data, run, change, row);
      return { transactionId: change.transactionId, kind: change.kind, kindLabel: kindLabels[change.kind], date: row?.transactionDate || "", account: accounts.get(row?.bankAccountId || "") || "", content: row?.content || "", amount: row?.amount ?? 0, side: row?.side || "EXPENSE",
        fields: change.fields.map((field) => ({ label: fieldLabels[field.key], before: format(field.key, field.before), after: format(field.key, field.after) })),
        reviewCleared: change.reviewCleared, restorable: !blocked, blocked, restoredAt: change.restoredAt, before: change.before ? describe(change.before) : undefined, current: row ? describe(row) : "明細なし" };
    });
    return { id: run.id, runId: run.runId, startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status, statusLabel: statusLabels[run.status], error: run.error, mode: modeLabels[run.mode],
      range: run.rangeStart ? `${run.rangeStart}〜${run.rangeEnd || ""}` : "", actor: run.actorId === BANK_SYNC_SYSTEM_ACTOR ? "自動同期" : users.get(run.actorId) || "利用者",
      added: run.added, changed: run.changed, metaOnly: run.metaOnly, missing: run.missing, restored: run.restored, reviewCleared: run.reviewCleared, pending: changes.filter((change) => change.restorable).length, truncated: run.truncated, changes };
  });
}

const restoreSchema = z.object({ runId: z.string().min(1).max(200), transactionIds: z.array(z.string().min(1).max(1000)).min(1).max(BANK_SYNC_CHANGE_LIMIT) });
export type BankSyncRestoreInput = z.input<typeof restoreSchema>;

export function restoreBankSyncReview(data: AppData, actor: Actor, company: CompanyScope, input: BankSyncRestoreInput) {
  assertBankAccess(actor, company);
  const value = restoreSchema.parse(input);
  const run = bankSyncRunFor(data, company, value.runId);
  if (!run) throw new Error("同期の記録が見つかりません");
  const ids = new Set(value.transactionIds);
  const targets = run.changes.filter((change) => ids.has(change.transactionId));
  if (targets.length !== ids.size) throw new Error("同期の記録に含まれない明細があります。画面を更新してください");
  const rows = new Map(data.bankTransactions.map((row) => [row.id, row]));
  const skipped: Array<{ id: string; reason: string }> = [];
  // Every row is validated before any row changes so a rejected batch never partially saves.
  const restorable = targets.filter((change) => { const reason = bankSyncRestoreBlocker(data, run, change, rows.get(change.transactionId)); if (reason) skipped.push({ id: change.transactionId, reason }); return !reason; });
  const timestamp = new Date().toISOString();
  for (const change of restorable) {
    const row = rows.get(change.transactionId)!, before = change.before!;
    Object.assign(row, { categoryId: before.categoryId, subCategoryId: before.subCategoryId, treatment: before.treatment, classificationSource: before.classificationSource, classificationConfidence: before.classificationConfidence,
      classificationReason: before.classificationReason, ruleId: before.ruleId, reviewed: true, updatedAt: stamp(row.updatedAt) });
    change.restoredAt = timestamp;
  }
  if (restorable.length) run.updatedAt = stamp(run.updatedAt);
  return { restored: restorable.length, skipped };
}
