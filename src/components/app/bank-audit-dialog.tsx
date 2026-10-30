"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, LoaderCircle, Undo2 } from "lucide-react";
import { loadBankAuditAction, undoBankAuditAction } from "@/app/banking/audit-actions";
import type { BankAuditEntry } from "@/lib/bank-audit";
import type { CompanyScope } from "@/lib/company";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function BankAuditDialog({ company, disabled = false }: { company: CompanyScope; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [rows, setRows] = useState<BankAuditEntry[]>([]), [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null), [pending, start] = useTransition();
  const router = useRouter();
  const load = () => { setOpen(true); setError(""); start(async () => { try { const result = await loadBankAuditAction(company); if (!result.success) throw new Error(result.error); setRows(result.rows); } catch (e) { setError(e instanceof Error ? e.message : "履歴を読み込めませんでした"); } }); };
  function undo(id: string) {
    start(async () => { try { const result = await undoBankAuditAction(company, id); if (!result.success) throw new Error(result.error); setConfirm(null); const next = await loadBankAuditAction(company); if (next.success) setRows(next.rows); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : "取り消せませんでした"); } });
  }
  return <><Button variant="outline" size="sm" disabled={disabled} onClick={load}><History className="size-4" />変更履歴</Button><Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-lg sm:max-w-3xl" aria-describedby={undefined}><DialogHeader><DialogTitle>分類・確認の変更履歴</DialogTitle></DialogHeader>
    {pending && <span role="status" className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />処理中</span>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!pending && !rows.length && <p>表示できる変更履歴はありません</p>}
    {rows.map((row) => <details key={row.id} className="border-b py-3"><summary className="cursor-pointer break-words">{new Date(row.date).toLocaleString("ja-JP")} · {row.action} · {row.count}件 · {row.actor}{row.undone ? "（取消済み）" : ""}</summary>
      <div className="mt-3 space-y-3">{row.rows.map((item) => <div key={item.id} className="border-l-2 pl-3 text-xs break-words"><p>{item.date} {item.content}</p><p className="text-muted-foreground">変更前：{item.before}</p><p>現在：{item.after}</p></div>)}</div>
      <div className="mt-3">{row.blocked ? <p className="text-xs text-muted-foreground">{row.blocked}</p> : confirm === row.id ? <div className="flex flex-wrap items-center gap-2"><span>{row.count}件を変更前に戻しますか？</span><Button disabled={pending} onClick={() => undo(row.id)}><Undo2 className="size-4" />取り消しを確定</Button><Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>キャンセル</Button></div> : <Button variant="outline" disabled={pending} onClick={() => setConfirm(row.id)}><Undo2 className="size-4" />この操作を取り消す</Button>}</div>
    </details>)}
  </DialogContent></Dialog></>;
}
