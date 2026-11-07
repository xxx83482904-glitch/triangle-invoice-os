"use client";

import { startTransition, useEffect, useState, useSyncExternalStore } from "react";
import { loadBankDraftRowsAction, saveBankAutosaveAction } from "@/app/banking/actions";
import { undoBankAuditAction } from "@/app/banking/audit-actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { BankAutosaveQueue, type BankAutosaveNotice } from "@/lib/bank-autosave";
import type { CompanyScope } from "@/lib/company";

// Autosave transitions must not drive the workspace's blocking pending flag.
function bankAction<T>(action: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => startTransition(async () => {
    try { resolve(await action()); } catch (error) { reject(error); }
  }));
}

function notifySaved(company: CompanyScope, queue: BankAutosaveQueue, notice: BankAutosaveNotice) {
  let undoStarted = false;
  const undo = async () => {
    if (undoStarted) return;
    if (!queue.beginUndo(notice.rowIds)) {
      toast({ title: "対象の明細に保存中または保存できなかった変更があります", description: "保存を完了するか、変更を取り消してから元に戻してください。" });
      return;
    }
    undoStarted = true;
    const errors: string[] = [];
    let restored = 0;
    try {
      for (const id of [...notice.auditIds].reverse()) {
        try {
          const result = await bankAction(() => undoBankAuditAction(company, id));
          if (!result.success) errors.push(result.error); else restored++;
        } catch { errors.push("元に戻す操作の結果を確認できませんでした。変更履歴を確認してください"); }
      }
      for (let offset = 0; offset < notice.rowIds.length; offset += 500) {
        const result = await bankAction(() => loadBankDraftRowsAction(company, notice.rowIds.slice(offset, offset + 500)));
        if (!result.success) throw new Error(result.error);
        queue.receive(result.displayRows);
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : "最新の明細を取得できませんでした"); }
    finally { queue.endUndo(notice.rowIds); }
    toast({ title: errors.length ? (restored ? "一部の変更を元に戻しました" : "元に戻せませんでした") : "変更を元に戻しました",
      description: errors.length ? [...new Set(errors)].join("。") : undefined, variant: errors.length ? "destructive" : "success", duration: 10000 });
  };
  toast({ title: notice.count ? `${notice.count}件${notice.label}` : "保存できませんでした",
    description: <div className="flex flex-wrap items-center gap-2">{notice.failed ? <span>保存できなかった明細 {notice.failed}件。行の理由を確認してください。</span> : null}
      {notice.auditIds.length ? <Button size="sm" variant="outline" onClick={() => void undo()}>元に戻す</Button> : null}</div>,
    variant: notice.failed ? "destructive" : "success", duration: 10000 });
}

export function useBankAutosave(company: CompanyScope) {
  const [queue] = useState(() => {
    const value = new BankAutosaveQueue({
      save: async (edits) => {
        const result = await bankAction(() => saveBankAutosaveAction(company, edits));
        if (!result.success) throw new Error(result.error);
        return result;
      },
      onNotice: (notice) => notifySaved(company, value, notice),
    });
    return value;
  });
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useEffect(() => { queue.activate(); return () => queue.deactivate(); }, [queue]);
  return { ...snapshot, queue };
}
