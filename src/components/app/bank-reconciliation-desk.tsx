"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, Search, Unlink } from "lucide-react";
import { confirmBankReconciliationAction } from "@/app/banking/reconcile/actions";
import { BankAiPanel } from "@/components/app/bank-ai-panel";
import { bankSelectClass } from "@/components/app/banking-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { reconciliationCandidates, reconciliationPaymentOptions } from "@/lib/bank-reconciliation-matching";
import type { ReconciliationBank, ReconciliationInvoice, ReconciliationOverview } from "@/lib/bank-reconciliation";
import type { BankAiPreview } from "@/lib/bank-ai-types";
import type { CompanyScope } from "@/lib/company";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
const cents = (value: number) => Math.round(value * 100);
const remaining = (amount: number, allocated: number) => Math.max(0, cents(amount) - cents(allocated)) / 100;
type Props = {
  company: CompanyScope; rows: ReconciliationBank[]; selected?: ReconciliationBank;
  invoices: ReconciliationInvoice[]; links: ReconciliationOverview["links"];
  accounts: Array<{ id: string; name: string }>; page: number; total: number; focusInvoice: string;
  href: (values: Record<string, string>) => string; pending: boolean;
  onRemove: (link: ReconciliationOverview["links"][number]) => void;
  aiPreview?: BankAiPreview; aiConfigured: boolean; aiModel: string;
};

function Confirmation({ company, bank, invoice, onBusy, onComplete }: {
  company: CompanyScope; bank: ReconciliationBank; invoice: ReconciliationInvoice;
  onBusy: (busy: boolean) => void; onComplete: (amount: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  const available = reconciliationPaymentOptions(bank, invoice);
  const [mode, setMode] = useState<"existing" | "new">(available.length ? "existing" : "new");
  const [paymentId, setPaymentId] = useState(available[0]?.id || "");
  const [amount, setAmount] = useState(String(Math.min(bank.remaining, available[0]?.available || invoice.outstanding)));
  const [acknowledged, setAcknowledged] = useState(false), [note, setNote] = useState(""), [error, setError] = useState("");
  const payment = available.find((row) => row.id === paymentId), value = Number(amount);
  const target = mode === "existing" ? payment?.available || 0 : invoice.outstanding;
  const max = Math.min(bank.remaining, target);
  const valid = Number.isFinite(value) && value > 0 && value <= max && Math.abs(value * 100 - cents(value)) < 0.001;
  const bankRest = remaining(bank.remaining, valid ? value : 0), invoiceRest = remaining(target, valid ? value : 0);
  function submit() {
    if (!valid || !acknowledged || pending) return;
    onBusy(true);
    startTransition(async () => {
      try {
        const result = await confirmBankReconciliationAction(company, {
          transactionId: bank.id, transactionUpdatedAt: bank.updatedAt, invoiceKind: invoice.kind, invoiceId: invoice.id, invoiceUpdatedAt: invoice.updatedAt,
          mode, paymentId: mode === "existing" ? paymentId : undefined, paymentUpdatedAt: mode === "existing" ? payment?.updatedAt : undefined,
          amount: value, acknowledged: true, note,
        });
        if (!result.success) { setError(result.error); return; }
        toast({ title: result.createdPayment ? "照合し、入金・支払いを登録しました" : "登録済みの入金・支払いと照合しました", variant: "success" });
        onComplete(value);
      } catch { setError("結果を確認できませんでした。再度確定する前に画面を更新してください。"); }
      finally { onBusy(false); }
    });
  }
  return <section aria-label="照合の確定" className="space-y-3 border-t bg-primary/[0.03] px-4 py-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-words text-xs text-muted-foreground">請求額 {money(invoice.total)} / 支払い登録済み {money(invoice.paid)}</p><Link className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs text-primary" href={invoice.href} target="_blank" rel="noreferrer">書類を確認<ArrowUpRight className="size-4" /></Link></div>
    {invoice.needsReview || invoice.stateMismatch ? <p className="text-xs text-amber-700 dark:text-amber-400">OCR・支払い状態に確認事項があります。原本と金額を確認してください。</p> : null}
    {available.length ? <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid min-w-0 gap-1 text-xs">記録方法<select className={bankSelectClass} disabled={pending} value={mode} onChange={(e) => { const next = e.target.value as typeof mode; setMode(next); setAmount(String(Math.min(bank.remaining, next === "existing" ? payment?.available || 0 : invoice.outstanding))); setAcknowledged(false); }}><option value="existing">登録済みの支払いと照合</option><option value="new" disabled={!invoice.outstanding}>未登録分の支払いを追加</option></select></label>
      {mode === "existing" ? <label className="grid min-w-0 gap-1 text-xs">既存の記録<select className={bankSelectClass} disabled={pending} value={paymentId} onChange={(e) => { setPaymentId(e.target.value); setAmount(String(Math.min(bank.remaining, available.find((row) => row.id === e.target.value)?.available || 0))); setAcknowledged(false); }}>{available.map((row) => <option key={row.id} value={row.id}>{row.date} / {money(row.available)} / {row.method}</option>)}</select></label> : null}
    </div> : null}
    {payment && mode === "existing" && payment.date !== bank.date ? <p className="text-xs text-amber-700 dark:text-amber-400">記録日 {payment.date} と銀行日が異なります。既存の日付は保持します。</p> : null}
    <div className="grid items-end gap-3 sm:grid-cols-[minmax(140px,1fr)_minmax(0,1fr)]">
      <label className="grid min-w-0 gap-1 text-xs">今回の照合額<Input className="min-h-11 text-base tabular-nums" type="number" inputMode="decimal" step="0.01" min="0.01" max={max} disabled={pending} value={amount} onChange={(e) => { setAmount(e.target.value); setAcknowledged(false); }} /></label>
      <p className="min-h-11 content-center text-xs text-muted-foreground">{mode === "new" ? `${bank.date} の${bank.side === "INCOME" ? "入金" : "支払い"}を登録` : "支払いを重複登録しません"}</p>
    </div>
    {amount && !valid ? <p role="alert" className="text-xs text-destructive">照合額は0より大きく、{money(max)}以下（小数点以下2桁まで）にしてください。</p> : null}
    <div aria-live="polite" className={`flex flex-wrap gap-x-5 gap-y-1 text-sm ${bankRest || invoiceRest ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
      {!bankRest && !invoiceRest && valid ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="size-4" />差額なし</span> : <><span>銀行の残り <strong className="tabular-nums">{money(bankRest)}</strong></span><span>{mode === "existing" ? "既存記録" : "請求書"}の残り <strong className="tabular-nums">{money(invoiceRest)}</strong></span></>}
    </div>
    {(bankRest > 0 || invoiceRest > 0) && valid ? <p className="text-xs text-muted-foreground">差額は残します。手数料や合算とみなして自動消込しません。</p> : null}
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input className="size-5 shrink-0 accent-primary" type="checkbox" checked={acknowledged} disabled={pending} onChange={(e) => setAcknowledged(e.target.checked)} /><span>同じ通貨・支払い、二重計上なしと確認済み</span></label>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <Button className="min-h-11 w-full" disabled={pending || !valid || !acknowledged} onClick={submit}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}照合を確定</Button>
    <details><summary className="min-h-11 cursor-pointer content-center text-xs text-muted-foreground">照合メモ（任意）</summary><Input aria-label="照合メモ" className="min-h-11" value={note} maxLength={1000} disabled={pending} onChange={(e) => setNote(e.target.value)} /></details>
  </section>;
}

export function BankReconciliationDesk(props: Props) {
  const { company, rows, invoices, links, accounts, href, onRemove, pending, aiPreview, aiConfigured, aiModel } = props;
  const router = useRouter();
  const [activeId, setActiveId] = useState(props.selected?.id || "");
  const [selectedKey, setSelectedKey] = useState(props.focusInvoice);
  const [query, setQuery] = useState(""), [showAll, setShowAll] = useState(false), [showList, setShowList] = useState(!props.selected);
  const [saving, setSaving] = useState(false);
  const selected = rows.find((row) => row.id === activeId) || (props.selected?.id === activeId ? props.selected : undefined);
  const busy = saving || pending;
  const actionable = selected && !selected.issue && !selected.conflict && selected.remaining > 0;
  const candidates = useMemo(() => selected ? reconciliationCandidates(selected, invoices, invoices.length) : [], [selected, invoices]);
  const candidateMap = new Map(candidates.map((row) => [row.key, row]));
  const normalized = query.normalize("NFKC").toLocaleLowerCase("ja").trim();
  const choices = selected ? invoices.filter((row) => row.eligible && !row.conflict && (selected.side === "INCOME" ? row.kind === "issued" : row.kind === "received") && (row.outstanding > 0 || row.payments.some((payment) => payment.available > 0))) : [];
  const filtered = choices.filter((row) => !normalized || `${row.title} ${row.party} ${row.project} ${row.total} ${row.outstanding} ${row.payments.map((payment) => payment.available).join(" ")}`.normalize("NFKC").toLocaleLowerCase("ja").includes(normalized.replace(/(?<=\d),(?=\d)/g, "")));
  const visible = filtered.filter((row) => query || showAll || candidateMap.has(row.key) || row.key === selectedKey).toSorted((a, b) => (candidateMap.get(b.key)?.score || 0) - (candidateMap.get(a.key)?.score || 0) || b.date.localeCompare(a.date));
  const chosen = actionable ? choices.find((row) => row.key === selectedKey) : undefined;
  const selectedLinks = links.filter((row) => row.transactionId === selected?.id);
  function selectBank(id: string) {
    setActiveId(id); setSelectedKey(props.focusInvoice); setQuery(""); setShowAll(false); setShowList(false);
    window.history.replaceState(null, "", href({ transaction: id, page: String(props.page) }));
  }
  function complete(amount: number) {
    setSelectedKey("");
    if (selected && cents(amount) >= cents(selected.remaining)) {
      const index = rows.findIndex((row) => row.id === selected.id);
      const next = [...rows.slice(index + 1), ...rows.slice(0, index)].find((row) => row.id !== selected.id && row.state === "unmatched");
      router.replace(href({ transaction: next?.id || "", page: String(props.page) }), { scroll: false });
    } else router.refresh();
  }
  return <div className="grid min-w-0 border-t md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.5fr)]">
    <section aria-label="銀行明細" className={`min-w-0 md:border-r md:pr-4 ${showList ? "" : "hidden md:block"}`}>
      <div className="flex min-h-12 items-center justify-between gap-2 text-sm"><h2 className="font-semibold">銀行明細 <span className="font-normal text-muted-foreground">{props.total}件</span></h2><div className="flex items-center gap-1"><Button size="icon" className="size-11" variant="ghost" aria-label="前のページ" title="前のページ" disabled={props.page === 1 || busy} onClick={() => router.push(href({ page: String(props.page - 1) }))}><ChevronLeft className="size-4" /></Button><span className="text-xs tabular-nums">{props.page}/{Math.max(1, Math.ceil(props.total / 50))}</span><Button size="icon" className="size-11" variant="ghost" aria-label="次のページ" title="次のページ" disabled={props.page * 50 >= props.total || busy} onClick={() => router.push(href({ page: String(props.page + 1) }))}><ChevronRight className="size-4" /></Button></div></div>
      <ul className="max-h-[65dvh] divide-y overflow-y-auto">{rows.map((row) => <li key={row.id}><button disabled={busy} aria-pressed={selected?.id === row.id} className={`w-full min-w-0 space-y-2 border-l-2 p-3 text-left text-sm transition-colors ${selected?.id === row.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`} onClick={() => selectBank(row.id)}>
        <span className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{row.date}</span><span>{row.side === "INCOME" ? "入金" : "出金"}{row.state === "matched" ? "・照合済み" : row.state === "conflict" ? "・要再確認" : row.state === "excluded" ? "・対象外" : row.allocated > 0 ? "・一部照合" : ""}</span></span>
        <span className="block break-words font-medium">{row.content || "摘要なし"}</span><span className="block break-all text-base font-semibold tabular-nums">{money(row.remaining || row.amount)}</span>
      </button></li>)}</ul>
      {!rows.length ? <p className="py-8 text-sm text-muted-foreground">該当する明細はありません。</p> : null}
    </section>
    <section aria-label="照合の詳細" className={`min-w-0 md:pl-5 ${showList ? "hidden md:block" : ""}`}>
      <Button variant="ghost" className="min-h-11 md:hidden" disabled={busy} onClick={() => setShowList(true)}><ArrowLeft className="size-4" />明細一覧</Button>
      {selected ? <>
        <header className="space-y-2 border-b py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{selected.date} / {selected.side === "INCOME" ? "入金" : "出金"}</p><h2 className="mt-1 break-words text-base font-semibold">{selected.content || "摘要なし"}</h2></div><div className="min-w-0"><p className="text-xs text-muted-foreground">未照合額</p><p className="break-all text-2xl font-semibold tabular-nums">{money(selected.remaining)}</p></div></div><p className="break-words text-xs text-muted-foreground">{accounts.find((row) => row.id === selected.accountId)?.name}{selected.allocated > 0 ? ` / 照合済み ${money(selected.allocated)}` : ""}</p></header>
        {selected.issue || selected.conflict ? <p role="alert" className="flex items-start gap-2 border-l-2 border-amber-500 p-3 text-sm"><CircleAlert className="size-4 shrink-0" />{selected.issue || "照合後に元データが変わっています。既存の照合を解除して見直してください。"}</p> : null}
        {actionable ? <>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2"><h3 className="text-sm font-semibold">対応する請求書</h3>{chosen ? <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setSelectedKey("")}>選択を変更</Button> : <label className="relative min-w-0 flex-1 sm:max-w-64"><Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" /><Input aria-label="請求書を検索" className="min-h-11 pl-9" placeholder="取引先・案件・金額" value={query} disabled={busy} onChange={(e) => setQuery(e.target.value)} /></label>}</div>
          {!chosen ? <div role="group" aria-label="候補の絞り込み" className="mb-2 flex gap-1"><Button variant={!showAll ? "secondary" : "ghost"} className="min-h-11" aria-pressed={!showAll} disabled={busy} onClick={() => setShowAll(false)}>候補 {candidates.length}</Button><Button variant={showAll ? "secondary" : "ghost"} className="min-h-11" aria-pressed={showAll} disabled={busy} onClick={() => setShowAll(true)}>すべて {choices.length}</Button></div> : null}
          <ul className="max-h-80 divide-y overflow-y-auto border-y" aria-label="請求書の候補">{(chosen ? [chosen] : visible.slice(0, 100)).map((invoice) => {
            const candidate = candidateMap.get(invoice.key);
            return <li key={invoice.key}><button disabled={busy} aria-pressed={chosen?.key === invoice.key} onClick={() => setSelectedKey(invoice.key)} className={`flex min-h-11 w-full min-w-0 items-start gap-3 p-3 text-left text-sm ${chosen?.key === invoice.key ? "bg-primary/10" : "hover:bg-muted"}`}>
              <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${chosen?.key === invoice.key ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>{chosen?.key === invoice.key ? <Check className="size-3" /> : null}</span>
              <span className="min-w-0 flex-1"><span className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span className="min-w-0 break-words font-medium">{invoice.party}</span><span className="break-all font-semibold tabular-nums">{money(invoice.total)}</span></span><span className="mt-1 block break-words text-xs text-muted-foreground">{invoice.project} / {invoice.title} / 期日 {invoice.dueDate || "未設定"}</span>
              {candidate ? <><span className={`mt-2 block text-xs ${candidate.confidence === "strong" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>{candidate.confidence === "strong" ? "有力候補" : "要確認"}{candidate.difference !== 0 ? ` / 銀行との差 ${money(candidate.difference)}` : " / 金額一致"}</span><span className="mt-1 block break-words text-xs text-muted-foreground">{[...candidate.reasons, ...candidate.warnings].join(" / ")}</span></> : <span className="mt-1 block text-xs text-muted-foreground">一致する根拠なし・内容を確認</span>}</span>
            </button></li>;
          })}</ul>
          {!chosen && !visible.length ? <p className="py-5 text-sm text-muted-foreground">{query ? "検索に一致する請求書はありません。" : "確かな候補がありません。すべての請求書から選択できます。"}</p> : null}
          {!chosen && visible.length > 100 ? <p className="py-2 text-xs text-muted-foreground">先頭100件を表示。検索で絞り込めます。</p> : null}
          {chosen ? <Confirmation key={`${selected.id}:${selected.updatedAt}:${selected.remaining}:${chosen.key}:${chosen.updatedAt}:${chosen.payments.map((row) => `${row.id}:${row.available}:${row.updatedAt}`).join()}`} company={company} bank={selected} invoice={chosen} onBusy={setSaving} onComplete={complete} /> : <p className="border-b py-5 text-sm text-muted-foreground">請求書を選択すると照合額を確認できます。</p>}
        </> : !selected.issue && !selected.conflict && !selected.remaining ? <p className="flex items-center gap-2 py-5 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" />この明細は照合済みです</p> : null}
        {selectedLinks.length ? <section className="border-t py-3"><h3 className="text-xs font-semibold">照合済みの記録</h3><ul className="divide-y">{selectedLinks.map((link) => <li key={link.id} className="py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words">{invoices.find((row) => row.key === link.invoiceKey)?.title || "削除・移動された請求書"} / {money(link.amount)}</span><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => onRemove(link)}><Unlink className="size-4" />照合解除</Button></div>{link.issue ? <p className="text-xs text-destructive">{link.issue}</p> : null}{link.note ? <p className="break-words text-xs text-muted-foreground">{link.note}</p> : null}</li>)}</ul></section> : null}
        {actionable && aiPreview && props.selected?.id === selected.id ? <details className="border-t py-2"><summary className="min-h-11 cursor-pointer content-center text-sm text-muted-foreground">AIで追加確認</summary><BankAiPanel key={aiPreview.revision} company={company} preview={aiPreview} configured={aiConfigured} model={aiModel} onChooseInvoice={(key) => { if (!busy && choices.some((row) => row.key === key)) setSelectedKey(key); }} /></details> : actionable ? <Button variant="ghost" disabled={busy} className="min-h-11 text-sm text-muted-foreground" onClick={() => router.refresh()}>この明細のAI確認を読み込む</Button> : null}
        <Link className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground" href={`/banking?company=${company}&transaction=${encodeURIComponent(selected.id)}`}>元の銀行明細<ArrowUpRight className="size-3" /></Link>
      </> : <p className="py-12 text-center text-sm text-muted-foreground">照合する銀行明細を選択してください。</p>}
    </section>
  </div>;
}
