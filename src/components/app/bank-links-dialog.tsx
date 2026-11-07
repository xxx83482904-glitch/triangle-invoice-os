"use client";
import { Money } from "@/components/app/money";

import Link from "next/link";
import { useOperationError } from "@/hooks/use-operation-error";
import { OperationPending } from "@/components/app/operation-feedback";
import { toast } from "@/hooks/use-toast";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ArrowRight, Check, CreditCard, Eye, FileCheck2, LoaderCircle, Search, Unlink } from "lucide-react";
import { confirmBankTransferAction, loadBankLinksAction, removeBankTransferAction } from "@/app/banking/link-actions";
import { removeBankReconciliationAction } from "@/app/banking/reconcile/actions";
import { BankReconciliationConfirmation } from "@/components/app/bank-reconciliation-desk";
import { BankInvoicePreview } from "@/components/app/bank-invoice-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reconciliationCandidates } from "@/lib/bank-reconciliation-matching";
import { reconciliationAmountGap } from "@/lib/bank-reconciliation-allocation";
import type { CompanyScope } from "@/lib/company";

export type BankLinkData = Extract<Awaited<ReturnType<typeof loadBankLinksAction>>, { success: true }>;
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").trim();

// next: the following unreconciled row in the ledger, offered once this row is fully reconciled.
export function BankLinksDialog({ company, initial, onClose, next }: { company: CompanyScope; initial: BankLinkData; onClose: () => void; next?: { label: string; open: () => void } }) {
  const [data, setData] = useState(initial), [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false), [error, setError] = useOperationError(company);
  const [tab, setTab] = useState(initial.transfer.link ? "transfer" : initial.links.length ? "invoice" : initial.settlement ? "card" : "invoice");
  const [query, setQuery] = useState(""), [chosenKey, setChosenKey] = useState("");
  const [counterpartId, setCounterpartId] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [removing, setRemoving] = useState("");
  const [previewKey, setPreviewKey] = useState(initial.links[0]?.invoiceKey || ""), [done, setDone] = useState(false);
  const router = useRouter();
  const { bank, invoices, links, transfer, settlement, settlementSaved } = data;
  const busy = pending || saving;
  const candidates = useMemo(() => new Map(reconciliationCandidates(bank, invoices, invoices.length).map((row) => [row.key, row])), [bank, invoices]);
  const choices = invoices.filter((row) => row.eligible && !row.conflict && (row.outstanding > 0 || row.payments.some((payment) => payment.available > 0)));
  const chosen = choices.find((row) => row.key === chosenKey);
  const visible = choices.filter((row) => normalized(`${row.party} ${row.project} ${row.title} ${row.total}`).includes(normalized(query)))
    .sort((a, b) => (candidates.get(b.key)?.score || 0) - (candidates.get(a.key)?.score || 0) || b.date.localeCompare(a.date));
  const counterpart = transfer.candidates.find((row) => row.id === counterpartId);
  const previewInvoice = tab === "invoice" ? chosen || invoices.find((row) => row.key === previewKey) : undefined;
  const finished = done && (bank.remaining <= 0 || Boolean(transfer.link));
  async function reload() {
    const result = await loadBankLinksAction(company, bank.id);
    if (!result.success) throw new Error(result.error);
    setData(result); setChosenKey(""); setCounterpartId(""); setAcknowledged(false); setRemoving(""); router.refresh();
  }
  function run(action: () => Promise<{ success: boolean; error?: string }>, completes = false) {
    if (company === "JAPAN" && busy) return;
    setError(""); setDone(false); startTransition(async () => {
      try { const result = await action(); if (!result.success) throw new Error(result.error); if (company === "JAPAN") toast({ title: "照合を更新しました", variant: "success" }); await reload(); setDone(completes); }
      catch (error) { setError(error instanceof Error ? error.message : "結果を確認できません。再実行する前に画面を更新してください"); }
    });
  }
  function completed() {
    if (chosenKey) setPreviewKey(chosenKey);
    startTransition(async () => { try { await reload(); setDone(true); } catch { setError("保存後の情報を取得できません。画面を更新してください"); } });
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className={`max-h-[90dvh] overflow-y-auto sm:max-w-3xl ${previewInvoice ? "lg:max-w-6xl" : ""}`} showCloseButton={!busy} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>{bank.side === "INCOME" ? "入金" : "出金"}の照合</DialogTitle><DialogDescription className="break-words">{bank.date} / {transfer.row.account}</DialogDescription></DialogHeader>
      <div className="flex flex-wrap justify-between gap-3 border-b pb-3"><p className="min-w-0 flex-1 break-words text-sm">{bank.content}</p><strong className="break-all tabular-nums font-medium"><Money value={bank.amount} maximumFractionDigits={2} /></strong></div>
      {finished && next ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-selected p-3 text-sm"><span className="flex min-w-0 items-center gap-2"><Check className="size-4 shrink-0 text-primary" /><span className="min-w-0 break-words">この明細の照合が完了しました。次: {next.label}</span></span><Button className="min-h-11" disabled={busy} onClick={next.open}>次の未照合へ<ArrowRight className="size-4" /></Button></div> : null}
      <div className={previewInvoice ? "grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start" : "min-w-0"}>
      <Tabs className="min-w-0" value={tab} onValueChange={(value) => { if (!busy) { setTab(value); setQuery(""); setRemoving(""); } }}>
        <TabsList className="w-full min-h-12" aria-label="明細の照合方法">
          {settlement ? <TabsTrigger value="card" disabled={busy} className="min-h-11 min-w-0 px-2 text-xs sm:text-sm"><CreditCard />カード精算</TabsTrigger> : null}
          <TabsTrigger value="invoice" disabled={busy} className="min-h-11 min-w-0 px-2 text-xs sm:text-sm"><FileCheck2 />請求書照合</TabsTrigger>
          <TabsTrigger value="transfer" disabled={busy} className="min-h-11 min-w-0 px-2 text-xs sm:text-sm"><ArrowLeftRight />資金移動</TabsTrigger>
        </TabsList>
        {settlement ? <TabsContent value="card" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3"><h3 className="text-sm font-semibold">{settlement.provider}の月次カード精算</h3><span className="text-xs text-muted-foreground">{settlement.conflict ? "保存済み分類・照合を要確認" : settlementSaved ? "振替扱い・保存済み" : "振替候補・未保存"}</span></div>
          {settlement.conflict ? <p role="alert" className="border-l-2 border-amber-500 p-3 text-sm">{settlement.conflict}</p> : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-sm"><dt className="text-muted-foreground">引落日</dt><dd>{bank.date}</dd><dt className="text-muted-foreground">銀行の出金</dt><dd className="break-all tabular-nums"><Money value={bank.amount} maximumFractionDigits={2} /></dd><dt className="text-muted-foreground">経費集計</dt><dd className="break-words">{settlement.conflict ? "既存の分類・照合との整合性を要確認" : settlementSaved ? "精算額は対象外・カード利用側で分類" : "振替候補の保存後に精算額を対象外・カード利用側で分類"}</dd><dt className="text-muted-foreground">銀行残高</dt><dd>引落額を差し引く</dd><dt className="text-muted-foreground">利用明細・請求期間</dt><dd>未照合</dd></dl>
          <h4 className="border-t pt-3 text-sm font-medium">アプラスのカード口座</h4>
          {settlement.accounts.length ? <ul className="divide-y">{settlement.accounts.map((account) => <li key={account.id}><Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking?${new URLSearchParams({ company, account: account.id })}`} target="_blank" rel="noopener noreferrer"><CreditCard className="size-4 shrink-0" /><span className="min-w-0 break-words">{account.name}</span></Link></Button></li>)}</ul> : <p className="text-sm text-muted-foreground">同じ事業者のアプラスカード口座は未取得です。</p>}
          <p className="text-xs text-muted-foreground">引落月と利用月は異なる場合があります。請求期間・利用明細の組み合わせは自動確定していません。</p>
        </TabsContent> : null}
        <TabsContent value="invoice" className="min-w-0 space-y-3">
          <p className="flex flex-wrap justify-between gap-2 text-sm"><span>照合済み <Money value={bank.allocated} maximumFractionDigits={2} /></span><strong className="font-medium">未照合 <Money value={bank.remaining} maximumFractionDigits={2} /></strong></p>
          {bank.issue || bank.conflict ? <p role="alert" className="border-l-2 border-amber-500 p-3">{bank.issue || "照合後に元データが変わっています。照合を解除して再確認してください"}</p> : bank.remaining > 0 ? <>
            {chosen ? <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2"><div className="min-w-0"><strong className="block break-words">{chosen.party}</strong><p className="break-words text-xs text-muted-foreground">{chosen.project} / {chosen.title}</p></div><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setChosenKey("")}>選択を変更</Button></div> : <>
              <label className="relative block"><Search className="absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input className="min-h-11 pl-9" aria-label="対応する請求書を検索" placeholder="取引先・案件・請求書番号・金額" value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} /></label>
              <ul aria-label="対応する請求書" className="max-h-72 divide-y overflow-y-auto border-y">{visible.map((invoice) => {
                const gap = reconciliationAmountGap(bank, invoice);
                return <li key={invoice.key} className={`flex min-w-0 items-stretch ${previewKey === invoice.key ? "bg-selected" : ""}`}>
                <button className="min-w-0 flex-1 space-y-1 p-3 text-left hover:bg-muted" disabled={busy} onClick={() => setChosenKey(invoice.key)}>
                  <span className="flex flex-wrap justify-between gap-2"><strong className="min-w-0 break-words">{invoice.party}</strong><span className="tabular-nums"><Money value={invoice.total} maximumFractionDigits={2} /></span></span>
                  <span className="block break-words text-xs text-muted-foreground">{invoice.project} / {invoice.title} / {invoice.date || "日付未設定"}</span>
                  <span className="block text-xs">未入金・未払い <Money value={invoice.outstanding} maximumFractionDigits={2} />{candidates.has(invoice.key) ? ` / ${candidates.get(invoice.key)!.confidence === "strong" ? "有力候補" : "候補・要確認"}` : ""}</span>
                  <span className={`block break-words text-xs ${gap.kind === "exact" ? "font-medium text-primary" : gap.kind === "fee" ? "text-sky-700 dark:text-sky-300" : "text-muted-foreground"}`}>{gap.kind === "exact" ? "金額一致" : <>差額 <Money value={gap.amount} maximumFractionDigits={2} />・{gap.label}</>}</span>
                </button>
                {invoice.originalHref ? <Button variant="ghost" size="icon" className="size-11 shrink-0 self-center" aria-label={`${invoice.party} / ${invoice.title}の原本をプレビュー`} title="原本をプレビュー" aria-pressed={previewKey === invoice.key} disabled={busy} onClick={() => setPreviewKey(invoice.key)}><Eye className="size-4" /></Button> : null}
              </li>;
              })}</ul>
              {!visible.length ? <p className="py-3 text-muted-foreground">対応する請求書がありません。</p> : null}
            </>}
            {chosen ? <BankReconciliationConfirmation key={`${bank.id}:${chosen.key}`} company={company} bank={bank} invoice={chosen} invoices={choices} onBusy={setSaving} onComplete={completed} /> : null}
          </> : <p className="flex items-center gap-2 py-2 text-primary"><Check className="size-4" />照合済み</p>}
          {links.length ? <ul aria-label="照合済みの請求書" className="divide-y border-t">{links.map((link) => {
            const invoice = invoices.find((row) => row.key === link.invoiceKey);
            return <li key={link.id} className="space-y-2 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words">{invoice ? <Link href={invoice.href} className="text-primary hover:underline underline-offset-4 hover:text-primary" target="_blank" rel="noreferrer">{invoice.party} / {invoice.title}</Link> : "削除・移動された請求書"} / <Money value={link.amount} maximumFractionDigits={2} />{link.fee ? <span className="text-xs text-muted-foreground">（手数料 <Money value={link.fee.amount} maximumFractionDigits={2} /> {link.fee.borneBy === "payer" ? "先方差引" : "込み"}）</span> : null}</span><span className="flex flex-wrap gap-1">{invoice?.originalHref ? <Button variant="ghost" className="min-h-11" aria-pressed={!chosen && previewKey === invoice.key} disabled={busy} onClick={() => { setChosenKey(""); setPreviewKey(invoice.key); }}><Eye className="size-4" />原本</Button> : null}<Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setRemoving(link.id)}><Unlink className="size-4" />解除</Button></span></div>{link.issue ? <p className="text-destructive">{link.issue}</p> : null}
              {removing === link.id ? <div className="flex flex-wrap items-center gap-2 border-l-2 border-destructive p-2"><p className="text-xs">{link.createdPayment ? "照合時に作成した入金・支払い記録も取り消します。" : "既存の支払い記録は残ります。"}</p><Button variant="destructive" className="min-h-11" disabled={busy} onClick={() => run(() => removeBankReconciliationAction(company, link.id, link.updatedAt))}><OperationPending pending={company === "JAPAN" && pending}>照合解除を確定</OperationPending></Button><Button variant="ghost" disabled={busy} className="min-h-11" onClick={() => setRemoving("")}>キャンセル</Button></div> : null}
            </li>;
          })}</ul> : null}
        </TabsContent>
        <TabsContent value="transfer" className="min-w-0 space-y-3">
          {transfer.issue ? <p role="alert" className="border-l-2 border-amber-500 p-3">{transfer.issue}</p> : null}
          {transfer.link ? <>
            <h3 className="text-sm font-semibold">資金移動の照合済み</h3><p className="break-words">{transfer.link.counterpart?.account} / {transfer.link.counterpart?.date}</p><p className="break-words text-muted-foreground">{transfer.link.counterpart?.content}</p>
            {transfer.link.counterpart ? <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={`/banking?${new URLSearchParams({ company, transaction: transfer.link.counterpart.id })}`} target="_blank" rel="noreferrer"><ArrowLeftRight className="size-4" />相手側の明細 / <Money value={transfer.link.counterpart.amount} maximumFractionDigits={2} /></Link></Button> : null}
            {removing === transfer.link.id ? <div className="space-y-2 border-l-2 border-destructive p-3"><p>両側の振替扱いを照合前に戻します。</p><Button className="min-h-11" variant="destructive" disabled={busy} onClick={() => run(() => removeBankTransferAction(company, transfer.link!.id, transfer.link!.updatedAt))}><OperationPending pending={company === "JAPAN" && pending}>資金移動の照合解除を確定</OperationPending></Button><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setRemoving("")}>キャンセル</Button></div> : <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setRemoving(transfer.link!.id)}><Unlink className="size-4" />資金移動の照合を解除</Button>}
          </> : !transfer.issue ? <>
            <h3 className="text-sm font-semibold">{bank.side === "INCOME" ? "移動元の出金明細" : "移動先の入金明細"}</h3>
            <Input className="min-h-11" aria-label="資金移動の相手明細を検索" placeholder="口座名・摘要・日付" value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} />
            <ul aria-label="資金移動の候補" className="max-h-72 divide-y overflow-y-auto border-y">{transfer.candidates.filter((row) => normalized(`${row.account} ${row.content} ${row.date}`).includes(normalized(query))).map((row) => <li key={row.id}><button className={`flex min-h-11 w-full items-start gap-2 p-3 text-left ${counterpartId === row.id ? "bg-selected" : "hover:bg-muted"}`} aria-pressed={counterpartId === row.id} disabled={busy} onClick={() => { setCounterpartId(row.id); setAcknowledged(false); }}><Check className={`mt-0.5 size-4 shrink-0 ${counterpartId === row.id ? "text-primary" : "invisible"}`} /><span className="min-w-0"><strong className="block break-words">{row.account}</strong><span className="block break-words">{row.date} / {row.content}</span><span className="tabular-nums"><Money value={row.amount} maximumFractionDigits={2} /></span>{row.feeDifference ? <span className="block text-xs text-amber-700 dark:text-amber-300">差額 <Money value={row.feeDifference} maximumFractionDigits={2} /> を送金手数料として資金移動に記録</span> : null}</span></button></li>)}</ul>
            {!transfer.candidates.length ? <p className="text-muted-foreground">同額・逆方向の未照合明細がありません。相手口座の明細を同期して確認してください。金額差は自動消込しません。</p> : null}
            {counterpart ? <><p className="text-xs text-muted-foreground">両口座の残高計算には残し、通常の収入・経費集計から除外します。</p><label className="flex min-h-11 items-start gap-3 py-2"><input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} /><span>自社口座間・同じ通貨の同じ資金移動と確認済み</span></label><Button className="min-h-11 w-full" disabled={busy || !acknowledged} onClick={() => run(() => confirmBankTransferAction(company, { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, counterpartId: counterpart.id, counterpartUpdatedAt: counterpart.updatedAt, acknowledged: true, ...(counterpart.feeDifference ? { fee: { amount: counterpart.feeDifference } } : {}) }), true)}><OperationPending pending={company === "JAPAN" && pending}><ArrowLeftRight className="size-4" />資金移動の照合を確定</OperationPending></Button></> : null}
          </> : null}
        </TabsContent>
      </Tabs>
      {previewInvoice ? <div className="min-w-0 border-t pt-4 lg:sticky lg:top-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5"><BankInvoicePreview company={company} invoice={previewInvoice} /></div> : null}
      </div>
      {busy ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />処理中...</p> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}
