"use client";

import { useState, useTransition } from "react";
import { CalendarDays, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { saveReconciliationInstallmentsAction } from "@/app/banking/reconcile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReconciliationInvoice } from "@/lib/bank-reconciliation";
import type { CompanyScope } from "@/lib/company";
import { toast } from "@/hooks/use-toast";

export function BankReconciliationInstallments({ company, invoice }: { company: CompanyScope; invoice: ReconciliationInvoice }) {
  const [rows, setRows] = useState(() => invoice.installmentSchedule.map((row) => ({ ...row, amount: String(row.amount) })));
  const [pending, startTransition] = useTransition(), [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const total = rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100;
  const valid = Number.isFinite(total) && total <= invoice.total && rows.every((row) => row.dueDate && Number(row.amount) > 0 && Math.abs(Number(row.amount) * 100 - Math.round(Number(row.amount) * 100)) < 0.001);
  function save() {
    startTransition(async () => {
      try {
        const result = await saveReconciliationInstallmentsAction(company, { invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt, installments: rows.map((row) => ({ ...row, amount: Number(row.amount) })) });
        if (!result.success) { setError(result.error); return; }
        setDirty(false); setError(""); toast({ title: "分割予定を保存しました。入金記録は変更していません", variant: "success" });
      } catch { setError("保存結果を確認できません。画面を更新して予定を確認してください。"); }
    });
  }
  return <details className="border-t pt-2"><summary className="min-h-11 cursor-pointer content-center text-sm">分割入金予定 {invoice.installmentSchedule.length}件</summary>
    <p className="mb-3 text-xs text-muted-foreground">予定のみ・入金未確定。期日を過ぎても入金済みにはなりません。</p>
    <div className="space-y-2">{rows.map((row, index) => <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-end gap-2" key={row.id}>
      <label className="grid min-w-0 gap-1 text-xs">予定日 {index + 1}<Input type="date" className="min-h-11 min-w-0" value={row.dueDate} disabled={pending} onChange={(e) => { setRows(rows.map((item) => item.id === row.id ? { ...item, dueDate: e.target.value } : item)); setDirty(true); }} /></label>
      <label className="grid min-w-0 gap-1 text-xs">予定額<Input type="number" step="0.01" min="0.01" className="min-h-11" value={row.amount} disabled={pending} onChange={(e) => { setRows(rows.map((item) => item.id === row.id ? { ...item, amount: e.target.value } : item)); setDirty(true); }} /></label>
      <Button className="size-11" size="icon" variant="ghost" title="予定を削除" aria-label={`予定${index + 1}を削除`} disabled={pending} onClick={() => { setRows(rows.filter((item) => item.id !== row.id)); setDirty(true); }}><Trash2 className="size-4" /></Button>
      <Input className="col-span-3 min-h-11" aria-label={`予定${index + 1}のメモ`} placeholder="予定メモ" value={row.note || ""} maxLength={500} disabled={pending} onChange={(e) => { setRows(rows.map((item) => item.id === row.id ? { ...item, note: e.target.value } : item)); setDirty(true); }} />
    </div>)}</div>
    <div className="flex flex-wrap items-center gap-3 py-2"><Button variant="outline" className="min-h-11" disabled={pending || rows.length >= 100} onClick={() => { setRows([...rows, { id: crypto.randomUUID(), dueDate: invoice.dueDate || "", amount: String(Math.max(0, invoice.total - (Number.isFinite(total) ? total : 0))) }]); setDirty(true); }}><Plus className="size-4" />予定を追加</Button><span className="inline-flex items-center gap-1 text-xs"><CalendarDays className="size-4" />予定合計 {Number.isFinite(total) ? total.toLocaleString("ja-JP") : "-"} / 請求額 {invoice.total.toLocaleString("ja-JP")}</span><Button className="min-h-11" disabled={pending || !dirty || !valid} onClick={save}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}予定を保存</Button></div>
    {total > invoice.total ? <p role="alert" className="text-xs text-destructive">予定合計が請求額を超えています。</p> : null}{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </details>;
}
