"use client";

import { useState, useTransition } from "react";
import { reflectMailDocumentToReceivedInvoice } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import type { MailInvoiceDefaults } from "@/lib/mail-invoice-defaults";

type Option = { value: string; label: string };
export function MailInvoiceReflectionForm({ mailDocumentId, mailUpdatedAt, defaults, vendors, projects, statusOptions, broken, disabled }: {
  mailDocumentId: string; mailUpdatedAt?: string; defaults?: MailInvoiceDefaults;
  vendors: Option[]; projects: Option[]; statusOptions: Option[]; broken?: boolean; disabled?: boolean;
}) {
  const [fields, setFields] = useState<{ vendorId: string; projectId: string; status: string; issueDate: string; dueDate: string; total: string }>(() => ({ vendorId: "", projectId: "", status: "REVIEWING", issueDate: "", dueDate: "", total: "", ...defaults }));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const change = (key: keyof typeof fields, value: string) => setFields((current) => ({ ...current, [key]: value }));
  const selectClass = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
  return <form aria-label={broken ? "受領請求書を作り直す" : "受領請求書へ反映"} className="space-y-3 rounded-lg border bg-muted/20 p-3" onSubmit={(event) => {
    event.preventDefault(); if (pending || disabled) return;
    const form = new FormData(event.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        const result = await reflectMailDocumentToReceivedInvoice(form);
        if (!result.ok) { setError(result.error); return; }
        toast({ title: "受領請求書に反映しました", variant: "success" });
      } catch { setError("保存できませんでした。通信状況を確認して再試行してください。"); }
    });
  }}>
    <div className="text-sm font-medium">{broken ? "受領請求書を作り直す" : "受領請求書へ反映"}</div>
    <p className="text-xs text-muted-foreground">この郵便物の原本名・OCRからの候補です。保存前に確認してください。日付は空欄でも保存できます。金額の空欄は未確認の0円として保存します。</p>
    <input type="hidden" name="mailDocumentId" value={mailDocumentId} />
    <input type="hidden" name="mailUpdatedAt" value={mailUpdatedAt || ""} />
    <fieldset disabled={disabled || pending} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="grid min-w-0 gap-1 text-xs">支払先（必須）<select name="vendorId" required value={fields.vendorId} onChange={(event) => change("vendorId", event.target.value)} className={selectClass}><option value="">支払先を選択</option>{vendors.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
      <label className="grid min-w-0 gap-1 text-xs">案件（必須）<select name="projectId" required value={fields.projectId} onChange={(event) => change("projectId", event.target.value)} className={selectClass}><option value="">案件を選択</option>{projects.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
      <label className="grid gap-1 text-xs">状態<select name="status" value={fields.status} onChange={(event) => change("status", event.target.value)} className={selectClass}>{!statusOptions.some((row) => row.value === "REVIEWING") ? <option value="REVIEWING">確認中</option> : null}{statusOptions.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
      <label className="grid gap-1 text-xs">請求日<Input name="issueDate" type="date" value={fields.issueDate} onChange={(event) => change("issueDate", event.target.value)} /></label>
      <label className="grid gap-1 text-xs">支払期限<Input name="dueDate" type="date" value={fields.dueDate} onChange={(event) => change("dueDate", event.target.value)} /></label>
      <label className="grid gap-1 text-xs">合計<Input name="total" type="number" min="0" step="1" value={fields.total} onChange={(event) => change("total", event.target.value)} className="font-mono" /></label>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Button type="submit" disabled={disabled || pending} size="sm">{pending ? "保存中…" : "反映"}</Button>
  </form>;
}
