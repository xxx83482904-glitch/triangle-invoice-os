"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import { Money } from "@/components/app/money";
import { OptionTabs } from "@/components/app/option-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { CardUseView } from "@/lib/card-receipts";
import type { CompanyScope } from "@/lib/company";
import type { ExpenseClaimView } from "@/lib/expense-claim-edits";
import type { ReceiptReading } from "@/lib/expense-receipt-reading";
import { formatDate } from "@/lib/format";
import { operationFailureToast } from "@/lib/operation-feedback";
import { prepareReceiptFile } from "@/lib/receipt-image";
import type { ExpensePaidWith } from "@/lib/types";
import { cardMatches } from "./capture/model";

export type Option = { value: string; label: string };
export type PayKind = "expense" | "card";
export type CardContext = { label: string; uses: Array<CardUseView & { documented: boolean }> };
export const selectClass = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Where the matching use will be, the same rule the server applies after the receipt is sent.
export function CardMatchNote({ card, target, amount, spentOn }: { card: CardContext; target?: CardUseView; amount: number; spentOn: string }) {
  const matches = target ? [] : cardMatches(card.uses, amount, spentOn), use = target || (matches.length === 1 ? matches[0] : undefined);
  return <div className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
    <CreditCard className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{card.label}</p>
      {use ? <p className="break-words">{target ? "この利用に付けます" : "この利用に自動で付けます"}：{formatDate(use.date)} {use.content} <Money value={use.amount} /></p>
        : matches.length > 1 ? <p>同じ金額の利用が{matches.length}件あります。登録したあと、どの利用か選んでください。</p>
          : <p>まだ明細に同じ金額の利用がありません。明細が届いたら自動で付けます。</p>}
    </div>
  </div>;
}

// One receipt: a reimbursement claim (new or edited) or a company card receipt. The file is read by OCR, which only
// fills fields the person hasn't typed in.
export function ExpenseForm({ row, kind = "expense", card, target, company, today, projects, categories, pending, save }: {
  row?: ExpenseClaimView; kind?: PayKind; card?: CardContext; target?: CardUseView; company: CompanyScope; today: string; projects: Option[]; categories: Option[];
  pending: boolean; save: (data: FormData, kind: PayKind) => void;
}) {
  const [spentOn, setSpentOn] = useState(row?.spentOn || target?.date || today), [amount, setAmount] = useState(row ? String(row.amount) : target ? String(Math.round(target.amount)) : ""), [payee, setPayee] = useState(row?.payee || "");
  const [paidWith, setPaidWith] = useState<ExpensePaidWith>(row?.paidWith || "CASH"), [ocrText, setOcrText] = useState(row?.ocrText || "");
  const [purpose, setPurpose] = useState(row?.purpose || ""), [categoryId, setCategoryId] = useState(row?.categoryId || "");
  const [registrationNumber, setRegistrationNumber] = useState(row?.registrationNumber || "");
  const [tax10, setTax10] = useState(row?.taxBreakdown?.rate10 ? String(row.taxBreakdown.rate10) : ""), [tax8, setTax8] = useState(row?.taxBreakdown?.rate8 ? String(row.taxBreakdown.rate8) : "");
  const [reading, setReading] = useState(false), [ocrRead, setOcrRead] = useState(false), [ocrError, setOcrError] = useState(""), [warnings, setWarnings] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  const isCard = kind === "card";
  useEffect(() => () => request.current?.abort(), []);
  const readReceipt = async (file?: File) => {
    request.current?.abort(); request.current = null;
    setOcrText(""); setOcrRead(false); setOcrError(""); setWarnings([]); setReading(false);
    if (!file) return;
    const controller = new AbortController(); request.current = controller; setReading(true);
    try {
      const data = new FormData(); data.set("company", company); data.set("file", await prepareReceiptFile(file));
      const response = await fetch("/api/uploads/expenses/ocr", { method: "POST", body: data, signal: controller.signal });
      const body = await response.json() as Partial<ReceiptReading> & { error?: string };
      if (!response.ok) throw new Error(body.error || "領収書を読み取れませんでした");
      if (controller.signal.aborted) return;
      // Input entered while OCR runs always wins over the draft.
      setSpentOn((current) => current || body.spentOn || "");
      setAmount((current) => current || (typeof body.amount === "number" && body.amount > 0 ? String(body.amount) : ""));
      setPayee((current) => current || body.payee || "");
      setPurpose((current) => current || body.purpose || ""); setCategoryId((current) => current || body.categoryId || "");
      if (body.paidWith && !row) setPaidWith(body.paidWith);
      setRegistrationNumber((current) => current || body.registrationNumber || "");
      setTax10((current) => current || (body.taxBreakdown?.rate10 ? String(body.taxBreakdown.rate10) : ""));
      setTax8((current) => current || (body.taxBreakdown?.rate8 ? String(body.taxBreakdown.rate8) : ""));
      setOcrText(body.ocrText || ""); setOcrRead(true); setWarnings(body.warnings || []);
    } catch (error) {
      if (!controller.signal.aborted) { setOcrError("読み取れませんでした。領収書を確認して手入力で続けられます。"); toast(operationFailureToast(error)); }
    } finally { if (request.current === controller) setReading(false); }
  };
  const amountValue = Number(amount.replaceAll(",", "")) || 0;
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!pending && !reading) save(new FormData(event.currentTarget), kind); }}>
    <input type="hidden" name="company" value={company} /><input type="hidden" name="ocrText" value={ocrText} />
    {row ? <><input type="hidden" name="claimId" value={row.id} /><input type="hidden" name="version" value={row.updatedAt} /></> : null}
    {isCard && target ? <input type="hidden" name="transactionId" value={target.id} /> : null}
    <label className="block space-y-1 text-sm"><span>{row ? "領収書を差し替え（任意）" : "領収書の写真・PDF"}</span>
      <Input name="file" type="file" accept="image/*,application/pdf" required={!row} disabled={pending} className="h-auto py-2" onChange={(event) => { void readReceipt(event.target.files?.[0]); }} />
      <span className="block text-xs text-muted-foreground">PDF・JPEG・PNG、10MB以内</span>
    </label>
    {reading ? <p role="status" className="text-xs text-muted-foreground">領収書を読み取り中…</p> : null}
    {ocrRead ? <p role="status" className="text-xs text-muted-foreground">領収書から読み取った値です。領収書と見比べて直してください。</p> : null}
    {warnings.map((warning) => <p key={warning} role="status" className="border-l-2 border-amber-500 pl-2 text-xs">{warning}</p>)}
    {ocrError ? <p role="status" className="text-xs text-muted-foreground">{ocrError}</p> : null}
    <div className="grid grid-cols-2 gap-3">
      <label className="min-w-0 space-y-1 text-sm"><span>支払日</span><Input name="spentOn" type="date" value={spentOn} max={today} required disabled={pending} onChange={(event) => setSpentOn(event.target.value)} /></label>
      <label className="min-w-0 space-y-1 text-sm"><span>金額（円）</span><Input name="amount" type="number" value={amount} min={1} step={1} required disabled={pending} onChange={(event) => setAmount(event.target.value)} /></label>
    </div>
    {isCard && card ? <CardMatchNote card={card} target={target} amount={amountValue} spentOn={spentOn} /> : null}
    <label className="block space-y-1 text-sm"><span>支払先</span><Input name="payee" value={payee} maxLength={100} required disabled={pending} onChange={(event) => setPayee(event.target.value)} /></label>
    <label className="block space-y-1 text-sm"><span>用途</span><Input name="purpose" value={purpose} maxLength={200} required disabled={pending} onChange={(event) => setPurpose(event.target.value)} /></label>
    <label className="block space-y-1 text-sm"><span>勘定科目</span><select name="categoryId" value={categoryId} className={selectClass} disabled={pending} onChange={(event) => setCategoryId(event.target.value)}>
      <option value="">未設定</option>{row?.categoryId && !categories.some((item) => item.value === row.categoryId) ? <option value={row.categoryId} disabled>{row.categoryName}（利用不可）</option> : null}
      {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <label className="block space-y-1 text-sm"><span>案件</span><select name="projectId" defaultValue={row?.projectId || ""} className={selectClass} disabled={pending}>
      <option value="">共通経費（案件なし）</option>{row?.projectId && !projects.some((item) => item.value === row.projectId) ? <option value={row.projectId} disabled>{row.projectName}（利用不可）</option> : null}
      {projects.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    {isCard ? null : <OptionTabs label="立替方法" caption="立替方法" name="paidWith" value={paidWith} options={[["CASH", "現金"], ["PERSONAL_CARD", "個人カード"], ["OTHER", "その他"]]} disabled={pending} onChange={setPaidWith} />}
    <div className="grid grid-cols-3 gap-3">
      <label className="min-w-0 space-y-1 text-sm"><span>登録番号</span><Input name="registrationNumber" value={registrationNumber} placeholder="T1234…" maxLength={20} disabled={pending} onChange={(event) => setRegistrationNumber(event.target.value)} /></label>
      <label className="min-w-0 space-y-1 text-sm"><span>消費税10%</span><Input name="tax10" type="number" min={0} step={1} value={tax10} disabled={pending} onChange={(event) => setTax10(event.target.value)} /></label>
      <label className="min-w-0 space-y-1 text-sm"><span>消費税8%</span><Input name="tax8" type="number" min={0} step={1} value={tax8} disabled={pending} onChange={(event) => setTax8(event.target.value)} /></label>
    </div>
    <label className="block space-y-1 text-sm"><span>メモ</span><Textarea name="memo" defaultValue={row?.memo || ""} maxLength={1000} disabled={pending} /></label>
    <Button type="submit" disabled={pending || reading}>{pending ? "保存中…" : isCard ? "この内容で登録" : row?.status === "RETURNED" ? "修正して再提出" : row ? "変更を保存" : "領収書を提出"}</Button>
  </form>;
}
