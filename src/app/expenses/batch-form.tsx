"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ReceiptReading } from "@/lib/expense-receipt-reading";
import { operationFailureToast } from "@/lib/operation-feedback";
import { prepareReceiptFile } from "@/lib/receipt-image";
import type { ExpensePaidWith } from "@/lib/types";
import { amountOf, cardMatches, emptyFields, missing, type Fields } from "./capture/model";
import { selectClass, type CardContext, type Option, type PayKind } from "./expense-form";

type Row = { key: string; name: string; file?: File; state: "preparing" | "reading" | "ready" | "sending"; fields: Fields; touched: Partial<Record<keyof Fields, true>>; ocrText: string; warnings: string[]; error: string };
const readKeys = ["spentOn", "amount", "payee", "purpose", "categoryId", "paidWith", "registrationNumber"] as const;

// Several receipts at once, as on the phone: each file is read (two at a time), the person checks the values in a
// table, and every complete row is sent with one press. Only blank fields the person hasn't touched are filled.
export function BatchForm({ kind, card, company, today, projects, categories, onClose, onFinished }: {
  kind: PayKind; card?: CardContext; company: CompanyScope; today: string; projects: Option[]; categories: Option[]; onClose: () => void; onFinished: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]), [sending, setSending] = useState(false), [paidWith, setPaidWith] = useState<ExpensePaidWith>("CASH");
  const reading = useRef(new Set<string>()), input = useRef<HTMLInputElement>(null);
  const update = useCallback((key: string, change: (row: Row) => Row) => setRows((list) => list.map((row) => row.key === key ? change(row) : row)), []);
  const isCard = kind === "card";

  useEffect(() => {
    const waiting = rows.filter((row) => row.state === "reading" && row.file && !reading.current.has(row.key));
    for (const row of waiting.slice(0, Math.max(0, 2 - reading.current.size))) {
      reading.current.add(row.key);
      const data = new FormData(); data.set("company", company); data.set("file", row.file!);
      void fetch("/api/uploads/expenses/ocr", { method: "POST", body: data, signal: AbortSignal.timeout(100_000) })
        .then(async (response) => { const body = await response.json() as Partial<ReceiptReading> & { error?: string }; if (!response.ok) throw new Error(body.error); return body; })
        .then((body) => update(row.key, (current) => {
          const fields = { ...current.fields };
          for (const key of readKeys) {
            const raw = body[key], value = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
            if (value && !current.touched[key] && (!fields[key] || key === "paidWith")) fields[key] = value as never;
          }
          if (body.taxBreakdown?.rate10 && !fields.tax10) fields.tax10 = String(body.taxBreakdown.rate10);
          if (body.taxBreakdown?.rate8 && !fields.tax8) fields.tax8 = String(body.taxBreakdown.rate8);
          return { ...current, state: current.state === "sending" ? "sending" : "ready", fields, ocrText: body.ocrText || "", warnings: body.warnings || [] };
        }))
        .catch(() => update(row.key, (current) => ({ ...current, state: current.state === "sending" ? "sending" : "ready", warnings: ["自動で読み取れませんでした。領収書を見ながら入力してください。"] })))
        .finally(() => { reading.current.delete(row.key); setRows((list) => [...list]); });
    }
  }, [rows, company, update]);

  const add = (list: FileList | null) => {
    const created = Array.from(list || []).map((file): Row => ({ key: crypto.randomUUID(), name: file.name, state: "preparing", fields: emptyFields(paidWith), touched: {}, ocrText: "", warnings: [], error: "" }));
    const files = Array.from(list || []);
    setRows((current) => [...current, ...created]);
    created.forEach((row, index) => void prepareReceiptFile(files[index])
      .then((file) => update(row.key, (current) => ({ ...current, file, state: "reading" })))
      .catch((error) => update(row.key, (current) => ({ ...current, state: "ready", error: error instanceof Error ? error.message : "読み込めませんでした" }))));
  };
  const change = (key: string, field: keyof Fields, value: string) => update(key, (row) => ({ ...row, fields: { ...row.fields, [field]: value }, touched: { ...row.touched, [field]: true }, error: "" }));
  const setAll = (field: keyof Fields, value: string) => setRows((list) => list.map((row) => ({ ...row, fields: { ...row.fields, [field]: value }, touched: { ...row.touched, [field]: true } })));

  const ready = rows.filter((row) => row.state === "ready" && row.file && !missing(row.fields, today).length);
  const submit = async () => {
    if (sending || !ready.length) return;
    setSending(true);
    let count = 0;
    for (const row of ready) {
      update(row.key, (current) => ({ ...current, state: "sending", error: "" }));
      const data = new FormData();
      data.set("company", company); data.set("ocrText", row.ocrText); data.set("file", row.file!);
      for (const [key, value] of Object.entries(row.fields)) if (!(isCard && key === "paidWith")) data.set(key, value);
      try {
        const response = await fetch(isCard ? "/api/uploads/card-receipts" : "/api/uploads/expenses", { method: "POST", body: data });
        const body = await response.json() as { id?: string; error?: string };
        if (!response.ok || !body.id) throw new Error(body.error || "送信できませんでした");
        count++; setRows((list) => list.filter((item) => item.key !== row.key));
      } catch (error) {
        update(row.key, (current) => ({ ...current, state: "ready", error: error instanceof Error ? error.message : "送信できませんでした" }));
      }
    }
    setSending(false);
    if (!count) { toast(operationFailureToast(new Error("送信できませんでした。各行のエラーを確認してください"))); return; }
    const left = rows.length - count;
    toast({ title: `${count}件を${isCard ? "登録" : "申請"}しました。${left ? `残り${left}件を確認してください。` : ""}`, variant: "success" });
    if (!left) onFinished();
  };

  return <Card variant="section" className="min-w-0"><CardContent className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="min-w-0 flex-1 text-sm font-medium">{isCard ? `会社カードの領収書をまとめて登録（${card?.label || ""}）` : "領収書をまとめて申請"}</h2>
      <Button type="button" variant="ghost" size="icon" aria-label="まとめて登録を閉じる" disabled={sending} onClick={() => { if (!rows.length || window.confirm("読み込んだ領収書を破棄して閉じますか？")) onClose(); }}><X className="size-4" /></Button>
    </div>
    <input ref={input} type="file" accept="image/*,application/pdf" multiple className="sr-only" aria-label="領収書の写真・PDFを選ぶ（複数可）" onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={sending} onClick={() => input.current?.click()}>写真・PDFを選ぶ（複数可）</Button>
      {rows.length ? <label className="flex items-center gap-2 text-sm"><span className="whitespace-nowrap text-muted-foreground">案件をまとめて設定</span>
        <select className={`${selectClass} w-56`} defaultValue="" disabled={sending} onChange={(event) => { if (event.target.value) setAll("projectId", event.target.value === "__none" ? "" : event.target.value); event.target.value = ""; }}>
          <option value="">選ぶ…</option><option value="__none">共通経費（案件なし）</option>{projects.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></label> : null}
      {!isCard && rows.length ? <label className="flex items-center gap-2 text-sm"><span className="whitespace-nowrap text-muted-foreground">立替方法</span>
        <select className={`${selectClass} w-32`} value={paidWith} disabled={sending} onChange={(event) => { setPaidWith(event.target.value as ExpensePaidWith); setAll("paidWith", event.target.value); }}>
          <option value="CASH">現金</option><option value="PERSONAL_CARD">個人カード</option><option value="OTHER">その他</option>
        </select></label> : null}
    </div>
    {!rows.length ? <p className="py-8 text-center text-sm text-muted-foreground">領収書の写真やPDFを複数選ぶと、1枚ずつ読み取って下に並べます。</p> : <ul className="space-y-2" aria-label="読み込んだ領収書">{rows.map((row) => {
      const gaps = row.state === "ready" ? missing(row.fields, today) : [], amount = amountOf(row.fields);
      const matches = isCard && card ? cardMatches(card.uses, amount, row.fields.spentOn) : [];
      return <li key={row.key} className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          {row.state === "preparing" || row.state === "reading" ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" />読み取り中</span>
            : row.state === "sending" ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" />送信中</span>
              : gaps.length ? <span className="text-amber-700 dark:text-amber-300">{gaps.join("・")}が未入力</span> : <span>送信できます</span>}
          {isCard && row.state === "ready" && amount ? <span>{matches.length === 1 ? "カード利用に自動で付けます" : matches.length > 1 ? `同じ金額の利用${matches.length}件・登録後に選択` : "明細の反映待ちになります"}</span> : null}
          <Button type="button" variant="ghost" size="icon" aria-label={`${row.name}を外す`} disabled={sending || row.state === "sending"} onClick={() => setRows((list) => list.filter((item) => item.key !== row.key))}><Trash2 className="size-4" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[9.5rem_8rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,10rem)_minmax(0,12rem)]">
          <Input aria-label="支払日" type="date" max={today} value={row.fields.spentOn} disabled={row.state === "sending"} onChange={(event) => change(row.key, "spentOn", event.target.value)} />
          <Input aria-label="金額（円）" type="number" min={1} step={1} placeholder="金額" value={row.fields.amount} disabled={row.state === "sending"} onChange={(event) => change(row.key, "amount", event.target.value)} />
          <Input aria-label="支払先" placeholder="支払先" maxLength={100} value={row.fields.payee} disabled={row.state === "sending"} onChange={(event) => change(row.key, "payee", event.target.value)} />
          <Input aria-label="用途" placeholder="用途" maxLength={200} value={row.fields.purpose} disabled={row.state === "sending"} onChange={(event) => change(row.key, "purpose", event.target.value)} />
          <select aria-label="勘定科目" className={selectClass} value={row.fields.categoryId} disabled={row.state === "sending"} onChange={(event) => change(row.key, "categoryId", event.target.value)}>
            <option value="">科目未設定</option>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select aria-label="案件" className={selectClass} value={row.fields.projectId} disabled={row.state === "sending"} onChange={(event) => change(row.key, "projectId", event.target.value)}>
            <option value="">共通経費（案件なし）</option>{projects.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </div>
        {row.warnings.map((warning) => <p key={warning} className="border-l-2 border-amber-500 pl-2 text-xs">{warning}</p>)}
        {row.error ? <p role="alert" className="text-xs text-destructive">{row.error}</p> : null}
      </li>;
    })}</ul>}
    {rows.length ? <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-3 text-sm">
      <span className="text-muted-foreground">送信できる {ready.length}件・合計 <Money value={ready.reduce((sum, row) => sum + amountOf(row.fields), 0)} /></span>
      <Button type="button" disabled={sending || !ready.length} onClick={() => void submit()}>{sending ? "送信中…" : `${ready.length}件をまとめて${isCard ? "登録" : "申請"}`}</Button>
    </div> : null}
  </CardContent></Card>;
}
