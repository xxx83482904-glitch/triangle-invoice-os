"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, CreditCard, FileCheck2, LoaderCircle, Search, Unlink } from "lucide-react";
import { confirmBankTransferAction, loadBankLinksAction, removeBankTransferAction } from "@/app/banking/link-actions";
import { removeBankReconciliationAction } from "@/app/banking/reconcile/actions";
import { BankReconciliationConfirmation } from "@/components/app/bank-reconciliation-desk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reconciliationCandidates } from "@/lib/bank-reconciliation-matching";
import type { CompanyScope } from "@/lib/company";

export type BankLinkData = Extract<Awaited<ReturnType<typeof loadBankLinksAction>>, { success: true }>;
const money = (amount: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(amount);
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").trim();

export function BankLinksDialog({ company, initial, onClose }: { company: CompanyScope; initial: BankLinkData; onClose: () => void }) {
  const [data, setData] = useState(initial), [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [tab, setTab] = useState(initial.transfer.link ? "transfer" : initial.links.length ? "invoice" : initial.settlement ? "card" : "invoice");
  const [query, setQuery] = useState(""), [chosenKey, setChosenKey] = useState("");
  const [counterpartId, setCounterpartId] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [removing, setRemoving] = useState("");
  const router = useRouter();
  const { bank, invoices, links, transfer, settlement, settlementSaved } = data;
  const busy = pending || saving;
  const candidates = useMemo(() => new Map(reconciliationCandidates(bank, invoices, invoices.length).map((row) => [row.key, row])), [bank, invoices]);
  const choices = invoices.filter((row) => row.eligible && !row.conflict && (row.outstanding > 0 || row.payments.some((payment) => payment.available > 0)));
  const chosen = choices.find((row) => row.key === chosenKey);
  const visible = choices.filter((row) => normalized(`${row.party} ${row.project} ${row.title} ${row.total}`).includes(normalized(query)))
    .sort((a, b) => (candidates.get(b.key)?.score || 0) - (candidates.get(a.key)?.score || 0) || b.date.localeCompare(a.date));
  const counterpart = transfer.candidates.find((row) => row.id === counterpartId);
  async function reload() {
    const result = await loadBankLinksAction(company, bank.id);
    if (!result.success) throw new Error(result.error);
    setData(result); setChosenKey(""); setCounterpartId(""); setAcknowledged(false); setRemoving(""); router.refresh();
  }
  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setError(""); startTransition(async () => {
      try { const result = await action(); if (!result.success) throw new Error(result.error); await reload(); }
      catch (error) { setError(error instanceof Error ? error.message : "結果を確認できません。再実行する前に画面を更新してください"); }
    });
  }
  function completed() {
    startTransition(async () => { try { await reload(); } catch { setError("保存後の情報を取得できません。画面を更新してください"); } });
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>{bank.side === "INCOME" ? "入金" : "出金"}の照合</DialogTitle><DialogDescription className="break-words">{bank.date} / {transfer.row.account}</DialogDescription></DialogHeader>
      <div className="flex flex-wrap justify-between gap-3 border-b pb-3"><p className="min-w-0 flex-1 break-words text-sm">{bank.content}</p><strong className="break-all tabular-nums">{money(bank.amount)}</strong></div>
      <Tabs value={tab} onValueChange={(next) => { if (!busy) { setTab(next); setQuery(""); setRemoving(""); } }}>
        <TabsList className="w-full min-h-12" aria-label="明細の照合方法">
          {settlement ? <TabsTrigger value="card" disabled={busy} className="min-h-11 min-w-0 px-2 text-xs sm:text-sm"><CreditCard />カード精算</TabsTrigger> : null}
          <TabsTrigger value="invoice" disabled={busy} className="min-h-11 min-w-0 px-2 text-xs sm:text-sm"><FileCheck2 />請求書照合</TabsTrigger>
          <TabsTrigger value="transfer" disabled={busy} className="min-h-11 min-w-0 px-2 text-xs sm:text-sm"><ArrowLeftRight />資金移動</TabsTrigger>
        </TabsList>
        {settlement ? <TabsContent value="card" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3"><h3 className="text-sm font-semibold">{settlement.provider}の月次カード精算</h3><span className="text-xs text-muted-foreground">{settlement.conflict ? "保存済み分類・照合を要確認" : settlementSaved ? "振替扱い・保存済み" : "振替候補・未保存"}</span></div>
          {settlement.conflict ? <p role="alert" className="border-l-2 border-amber-500 p-3 text-sm">{settlement.conflict}</p> : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-sm"><dt className="text-muted-foreground">引落日</dt><dd>{bank.date}</dd><dt className="text-muted-foreground">銀行の出金</dt><dd className="break-all tabular-nums">{money(bank.amount)}</dd><dt className="text-muted-foreground">経費集計</dt><dd className="break-words">{settlement.conflict ? "既存の分類・照合との整合性を要確認" : settlementSaved ? "精算額は対象外・カード利用側で分類" : "振替候補の保存後に精算額を対象外・カード利用側で分類"}</dd><dt className="text-muted-foreground">銀行残高</dt><dd>引落額を差し引く</dd><dt className="text-muted-foreground">利用明細・請求期間</dt><dd>未照合</dd></dl>
          <h4 className="border-t pt-3 text-sm font-medium">アプラスのカード口座</h4>
          {settlement.accounts.length ? <ul className="divide-y">{settlement.accounts.map((account) => <li key={account.id}><Link className="flex min-h-11 items-center gap-2 py-3 text-sm text-primary underline-offset-4 hover:underline" href={`/banking?${new URLSearchParams({ company, account: account.id })}`} target="_blank" rel="noopener noreferrer"><CreditCard className="size-4 shrink-0" /><span className="min-w-0 break-words">{account.name}</span></Link></li>)}</ul> : <p className="text-sm text-muted-foreground">同じ事業者のアプラスカード口座は未取得です。</p>}
          <p className="text-xs text-muted-foreground">引落月と利用月は異なる場合があります。請求期間・利用明細の組み合わせは自動確定していません。</p>
        </TabsContent> : null}
        <TabsContent value="invoice" className="min-w-0 space-y-3">
          <p className="flex flex-wrap justify-between gap-2 text-sm"><span>照合済み {money(bank.allocated)}</span><strong>未照合 {money(bank.remaining)}</strong></p>
          {bank.issue || bank.conflict ? <p role="alert" className="border-l-2 border-amber-500 p-3">{bank.issue || "照合後に元データが変わっています。照合を解除して再確認してください"}</p> : bank.remaining > 0 ? <>
            {chosen ? <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2"><div className="min-w-0"><strong className="block break-words">{chosen.party}</strong><p className="break-words text-xs text-muted-foreground">{chosen.project} / {chosen.title}</p></div><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setChosenKey("")}>選択を変更</Button></div> : <>
              <label className="relative block"><Search className="absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input className="min-h-11 pl-9" aria-label="対応する請求書を検索" placeholder="取引先・案件・請求書番号・金額" value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} /></label>
              <ul aria-label="対応する請求書" className="max-h-72 divide-y overflow-y-auto border-y">{visible.map((invoice) => <li key={invoice.key}>
                <button className="w-full min-w-0 space-y-1 p-3 text-left hover:bg-muted" disabled={busy} onClick={() => setChosenKey(invoice.key)}>
                  <span className="flex flex-wrap justify-between gap-2"><strong className="min-w-0 break-words">{invoice.party}</strong><span className="tabular-nums">{money(invoice.total)}</span></span>
                  <span className="block break-words text-xs text-muted-foreground">{invoice.project} / {invoice.title} / {invoice.date || "日付未設定"}</span>
                  <span className="block text-xs">未入金・未払い {money(invoice.outstanding)}{candidates.has(invoice.key) ? ` / ${candidates.get(invoice.key)!.confidence === "strong" ? "有力候補" : "候補・要確認"}` : ""}</span>
                </button>
              </li>)}</ul>
              {!visible.length ? <p className="py-3 text-muted-foreground">対応する請求書がありません。</p> : null}
            </>}
            {chosen ? <BankReconciliationConfirmation key={`${bank.id}:${chosen.key}:${chosen.updatedAt}:${bank.remaining}`} company={company} bank={bank} invoice={chosen} onBusy={setSaving} onComplete={completed} /> : null}
          </> : <p className="flex items-center gap-2 py-2 text-primary"><Check className="size-4" />照合済み</p>}
          {links.length ? <ul aria-label="照合済みの請求書" className="divide-y border-t">{links.map((link) => {
            const invoice = invoices.find((row) => row.key === link.invoiceKey);
            return <li key={link.id} className="space-y-2 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words">{invoice ? <Link href={invoice.href} className="text-primary underline" target="_blank" rel="noreferrer">{invoice.party} / {invoice.title}</Link> : "削除・移動された請求書"} / {money(link.amount)}</span><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setRemoving(link.id)}><Unlink className="size-4" />解除</Button></div>{link.issue ? <p className="text-destructive">{link.issue}</p> : null}
              {removing === link.id ? <div className="flex flex-wrap items-center gap-2 border-l-2 border-destructive p-2"><p className="text-xs">{link.createdPayment ? "照合時に作成した入金・支払い記録も取り消します。" : "既存の支払い記録は残ります。"}</p><Button variant="destructive" className="min-h-11" disabled={busy} onClick={() => run(() => removeBankReconciliationAction(company, link.id, link.updatedAt))}>照合解除を確定</Button><Button variant="ghost" disabled={busy} className="min-h-11" onClick={() => setRemoving("")}>キャンセル</Button></div> : null}
            </li>;
          })}</ul> : null}
        </TabsContent>
        <TabsContent value="transfer" className="min-w-0 space-y-3">
          {transfer.issue ? <p role="alert" className="border-l-2 border-amber-500 p-3">{transfer.issue}</p> : null}
          {transfer.link ? <>
            <h3 className="text-sm font-semibold">資金移動の照合済み</h3><p className="break-words">{transfer.link.counterpart?.account} / {transfer.link.counterpart?.date}</p><p className="break-words text-muted-foreground">{transfer.link.counterpart?.content}</p>
            {removing === transfer.link.id ? <div className="space-y-2 border-l-2 border-destructive p-3"><p>両側の振替扱いを照合前に戻します。</p><Button className="min-h-11" variant="destructive" disabled={busy} onClick={() => run(() => removeBankTransferAction(company, transfer.link!.id, transfer.link!.updatedAt))}>資金移動の照合解除を確定</Button><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setRemoving("")}>キャンセル</Button></div> : <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setRemoving(transfer.link!.id)}><Unlink className="size-4" />資金移動の照合を解除</Button>}
          </> : !transfer.issue ? <>
            <h3 className="text-sm font-semibold">{bank.side === "INCOME" ? "移動元の出金明細" : "移動先の入金明細"}</h3>
            <Input className="min-h-11" aria-label="資金移動の相手明細を検索" placeholder="口座名・摘要・日付" value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} />
            <ul aria-label="資金移動の候補" className="max-h-72 divide-y overflow-y-auto border-y">{transfer.candidates.filter((row) => normalized(`${row.account} ${row.content} ${row.date}`).includes(normalized(query))).map((row) => <li key={row.id}><button className={`flex min-h-11 w-full items-start gap-2 p-3 text-left ${counterpartId === row.id ? "bg-primary/10" : "hover:bg-muted"}`} aria-pressed={counterpartId === row.id} disabled={busy} onClick={() => { setCounterpartId(row.id); setAcknowledged(false); }}><Check className={`mt-0.5 size-4 shrink-0 ${counterpartId === row.id ? "text-primary" : "invisible"}`} /><span className="min-w-0"><strong className="block break-words">{row.account}</strong><span className="block break-words">{row.date} / {row.content}</span><span className="tabular-nums">{money(row.amount)}</span></span></button></li>)}</ul>
            {!transfer.candidates.length ? <p className="text-muted-foreground">同額・逆方向の未照合明細がありません。相手口座の明細を同期して確認してください。金額差は自動消込しません。</p> : null}
            {counterpart ? <><p className="text-xs text-muted-foreground">両口座の残高計算には残し、通常の収入・経費集計から除外します。</p><label className="flex min-h-11 items-start gap-3 py-2"><input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} /><span>自社口座間・同じ通貨の同じ資金移動と確認済み</span></label><Button className="min-h-11 w-full" disabled={busy || !acknowledged} onClick={() => run(() => confirmBankTransferAction(company, { transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, counterpartId: counterpart.id, counterpartUpdatedAt: counterpart.updatedAt, acknowledged: true }))}><ArrowLeftRight className="size-4" />資金移動の照合を確定</Button></> : null}
          </> : null}
        </TabsContent>
      </Tabs>
      {busy ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />処理中...</p> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}
