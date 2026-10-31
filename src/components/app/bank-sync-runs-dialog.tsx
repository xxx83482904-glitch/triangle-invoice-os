"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RotateCcw, ScrollText } from "lucide-react";
import { loadBankSyncRunsAction, restoreBankSyncReviewAction } from "@/app/banking/sync-review-actions";
import type { BankSyncRunView } from "@/lib/bank-sync-runs";
import type { CompanyScope } from "@/lib/company";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const money = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const when = (value?: string) => value ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "";
const key = (runId: string, id: string) => `${runId}\u0000${id}`;

export function BankSyncRunsDialog({ company, disabled = false, pending = 0 }: { company: CompanyScope; disabled?: boolean; pending?: number }) {
  const [open, setOpen] = useState(false), [runs, setRuns] = useState<BankSyncRunView[]>([]), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()), [confirm, setConfirm] = useState<string | null>(null), [busy, start] = useTransition();
  const router = useRouter();
  const reload = async () => { const result = await loadBankSyncRunsAction(company); if (!result.success) throw new Error(result.error); setRuns(result.rows); };
  const load = () => { setOpen(true); setError(""); setNotice(""); setConfirm(null); setSelected(new Set()); start(async () => { try { await reload(); } catch (e) { setError(e instanceof Error ? e.message : "同期の記録を読み込めませんでした"); } }); };
  const toggle = (runId: string, id: string, value: boolean) => setSelected((current) => { const next = new Set(current); if (value) next.add(key(runId, id)); else next.delete(key(runId, id)); return next; });
  const selectRun = (run: BankSyncRunView, value: boolean) => setSelected((current) => { const next = new Set(current); for (const change of run.changes) if (change.restorable) { if (value) next.add(key(run.runId, change.transactionId)); else next.delete(key(run.runId, change.transactionId)); } return next; });
  const selectedIn = (run: BankSyncRunView) => run.changes.filter((change) => change.restorable && selected.has(key(run.runId, change.transactionId))).map((change) => change.transactionId);
  function restore(run: BankSyncRunView) {
    const ids = selectedIn(run);
    if (!ids.length) return;
    start(async () => {
      try {
        const result = await restoreBankSyncReviewAction(company, run.runId, ids);
        if (!result.success) throw new Error(result.error);
        setConfirm(null); setSelected(new Set());
        setNotice(`${result.restored}件の確認状態を同期前に戻しました${result.skipped.length ? `。対象外 ${result.skipped.length}件（${[...new Set(result.skipped.map((row) => row.reason))].join("、")}）` : ""}`);
        await reload(); router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : "確認状態を戻せませんでした"); }
    });
  }
  return <>
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={load}><ScrollText className="size-4" />同期の影響{pending ? <span className="rounded-full bg-amber-500/15 px-1.5 text-amber-800 dark:text-amber-300">確認解除 {pending}件</span> : null}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-lg sm:max-w-4xl" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>Money Forward 同期の影響</DialogTitle><DialogDescription>同期ごとの追加・変更・確認解除の記録。金額・日付・摘要・口座が変わった明細と元明細がなくなった明細だけ確認が外れます。連携元の仕訳状態やメモだけの変化では確認状態・科目・メモ・分割・保留を維持します。</DialogDescription></DialogHeader>
        {busy ? <span role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />処理中</span> : null}
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="break-words text-sm">{notice}</p> : null}
        {!busy && !runs.length ? <p className="text-sm">同期の記録はまだありません。次回の同期から記録されます。</p> : null}
        {runs.map((run) => { const chosen = selectedIn(run); return <details key={run.id} className="border-b py-3">
          <summary className="cursor-pointer break-words text-sm">{when(run.startedAt)} · {run.mode}{run.range ? ` ${run.range}` : ""} · {run.statusLabel} · {run.actor} · 追加 {run.added} / 変更 {run.changed} / 元明細なし {run.missing} / 復帰 {run.restored} / 仕訳状態・メモのみ {run.metaOnly} · <strong className={run.reviewCleared ? "text-amber-800 dark:text-amber-300" : ""}>確認解除 {run.reviewCleared}</strong>{run.pending ? `（戻せる ${run.pending}）` : ""}{run.truncated ? " · 記録は一部のみ" : ""}</summary>
          {run.error ? <p className="mt-2 break-words text-xs text-destructive">{run.error}</p> : null}
          {!run.changes.length ? <p className="mt-2 text-xs text-muted-foreground">既存明細の変更はありません</p> : <>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Button type="button" variant="outline" size="sm" disabled={busy || !run.pending} onClick={() => selectRun(run, true)}>戻せる明細をすべて選択（{run.pending}件）</Button>
              {chosen.length ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => selectRun(run, false)}>選択を解除</Button> : null}
              <span className="text-muted-foreground">選択 {chosen.length}件</span>
            </div>
            <div className="mt-2 max-h-[48dvh] overflow-auto divide-y border-y">
              {run.changes.map((change) => { const id = key(run.runId, change.transactionId), checked = selected.has(id); return <label key={change.transactionId} className={`flex gap-2 py-2 text-xs ${change.restorable ? "cursor-pointer" : ""}`}>
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" aria-label={`${change.date} ${change.content || "摘要なし"} を選択`} checked={checked} disabled={busy || !change.restorable} onChange={(e) => toggle(run.runId, change.transactionId, e.target.checked)} />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block break-words font-medium">{change.date} / {change.account} / {change.content || "摘要なし"} / <span className={`tabular-nums ${change.side === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{money.format(change.amount)}</span></span>
                  <span className="block break-words text-muted-foreground">{change.kindLabel}{change.fields.length ? `：${change.fields.map((field) => `${field.label} ${field.before} → ${field.after}`).join("、")}` : ""}</span>
                  {change.before ? <span className="block break-words">同期前：{change.before} → 現在：{change.current}</span> : null}
                  {change.restoredAt ? <span className="block text-emerald-700 dark:text-emerald-400">復元済み {when(change.restoredAt)}</span> : change.reviewCleared && change.blocked ? <span className="block text-amber-700 dark:text-amber-300">{change.blocked}</span> : null}
                </span>
              </label>; })}
            </div>
            {chosen.length ? <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">{confirm === run.runId
              ? <><span>{chosen.length}件を同期前の確認状態・科目に戻しますか？</span><Button type="button" disabled={busy} onClick={() => restore(run)}><RotateCcw className="size-4" />戻す</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>キャンセル</Button></>
              : <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(run.runId)}><RotateCcw className="size-4" />選択した {chosen.length}件の確認状態を戻す</Button>}</div> : null}
          </>}
        </details>; })}
      </DialogContent>
    </Dialog>
  </>;
}
