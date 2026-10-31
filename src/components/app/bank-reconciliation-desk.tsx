"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Search, Unlink } from "lucide-react";
import { BankReconciliationAllocation as BankReconciliationConfirmation } from "@/components/app/bank-reconciliation-allocation";
import { BankAiPanel } from "@/components/app/bank-ai-panel";
import { BankReconciliationReaffirm } from "@/components/app/bank-reconciliation-reaffirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reconciliationCandidates } from "@/lib/bank-reconciliation-matching";
import type { ReconciliationBank, ReconciliationInvoice, ReconciliationOverview } from "@/lib/bank-reconciliation";
import type { BankAiPreview } from "@/lib/bank-ai-types";
import type { CompanyScope } from "@/lib/company";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
const cents = (value: number) => Math.round(value * 100);
type Props = {
  company: CompanyScope; rows: ReconciliationBank[]; selected?: ReconciliationBank;
  invoices: ReconciliationInvoice[]; links: ReconciliationOverview["links"];
  accounts: Array<{ id: string; name: string }>; page: number; total: number; focusInvoice: string;
  href: (values: Record<string, string>) => string; pending: boolean;
  onRemove: (link: ReconciliationOverview["links"][number]) => void;
  aiPreview?: BankAiPreview; aiConfigured: boolean; aiModel: string;
  feeCategories?: Array<{ id: string; name: string }>;
};

export { BankReconciliationAllocation as BankReconciliationConfirmation } from "@/components/app/bank-reconciliation-allocation";

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
        <span className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{row.date}</span><span>{row.side === "INCOME" ? "入金" : "出金"}{row.state === "matched" ? "・照合済み" : row.state === "conflict" ? "・要再確認" : row.state === "not_required" ? "・請求書不要" : row.state === "excluded" ? "・振替・対象外" : row.allocated > 0 ? "・一部照合" : ""}</span></span>
        <span className="block break-words font-medium">{row.content || "摘要なし"}</span><span className="block break-all text-base font-semibold tabular-nums">{money(row.remaining || row.amount)}</span>
      </button></li>)}</ul>
      {!rows.length ? <p className="py-8 text-sm text-muted-foreground">該当する明細はありません。</p> : null}
    </section>
    <section aria-label="照合の詳細" className={`min-w-0 md:pl-5 ${showList ? "hidden md:block" : ""}`}>
      <Button variant="ghost" className="min-h-11 md:hidden" disabled={busy} onClick={() => setShowList(true)}><ArrowLeft className="size-4" />明細一覧</Button>
      {selected ? <>
        <header className="space-y-2 border-b py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{selected.date} / {selected.side === "INCOME" ? "入金" : "出金"}</p><h2 className="mt-1 break-words text-base font-semibold">{selected.content || "摘要なし"}</h2></div><div className="min-w-0"><p className="text-xs text-muted-foreground">未照合額</p><p className="break-all text-2xl font-semibold tabular-nums">{money(selected.remaining)}</p></div></div><p className="break-words text-xs text-muted-foreground">{accounts.find((row) => row.id === selected.accountId)?.name}{selected.allocated > 0 ? ` / 照合済み ${money(selected.allocated)}` : ""}</p></header>
        {selected.issue || selected.conflict ? <p role="alert" className="flex items-start gap-2 border-l-2 border-amber-500 p-3 text-sm"><CircleAlert className="size-4 shrink-0" />{selected.issue || "照合後に元データが変わっています。下の照合済みの記録で内容を確認して維持するか、解除して見直してください。"}</p> : null}
        {selected.transferCounterpart ? <section className="space-y-1 border-b py-3 text-sm"><h3 className="font-medium">資金移動の照合先</h3><Link className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={`/banking?${new URLSearchParams({ company, transaction: selected.transferCounterpart.id })}`} target="_blank" rel="noreferrer">{selected.transferCounterpart.account} / {selected.transferCounterpart.date} / {money(selected.transferCounterpart.amount)}<ArrowUpRight className="size-4 shrink-0" /></Link><p className="break-words text-xs">{selected.transferCounterpart.content}</p></section> : null}
        {selected.settlement ? <section className="space-y-1 border-b py-3 text-sm"><h3 className="font-medium">{selected.settlement.provider}のカード精算</h3><p className="text-xs">利用明細・請求期間は未照合。請求書への支払い追加はできません。</p>{selected.settlement.accounts.map((account) => <Link key={account.id} className="inline-flex min-h-11 items-center gap-1 text-primary underline" href={`/banking?${new URLSearchParams({ company, account: account.id })}`} target="_blank" rel="noreferrer">{account.name}<ArrowUpRight className="size-4" /></Link>)}{!selected.settlement.accounts.length ? <p className="text-xs text-muted-foreground">対応するカード口座は未取得です。</p> : null}</section> : null}
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
          {chosen ? <BankReconciliationConfirmation key={`${selected.id}:${selected.updatedAt}:${selected.remaining}:${chosen.key}:${chosen.updatedAt}:${chosen.payments.map((row) => `${row.id}:${row.available}:${row.updatedAt}`).join()}`} company={company} bank={selected} invoice={chosen} invoices={choices} feeCategories={props.feeCategories} onBusy={setSaving} onComplete={complete} /> : <p className="border-b py-5 text-sm text-muted-foreground">請求書を選択すると照合額を確認できます。</p>}
        </> : !selected.issue && !selected.conflict && !selected.remaining ? <p className="flex items-center gap-2 py-5 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" />この明細は照合済みです</p> : null}
        {selectedLinks.length ? <section className="border-t py-3"><h3 className="text-xs font-semibold">照合済みの記録</h3><ul className="divide-y">{selectedLinks.map((link) => { const title = invoices.find((row) => row.key === link.invoiceKey)?.title || "削除・移動された請求書"; return <li key={link.id} className="py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words">{title} / {money(link.amount)}</span><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => onRemove(link)}><Unlink className="size-4" />照合解除</Button></div>{link.issue ? <p className="text-xs text-destructive">{link.issue}</p> : null}{link.issue ? link.reaffirmable ? <div className="mt-1"><BankReconciliationReaffirm company={company} target={{ kind: "link", link, title }} disabled={busy} /></div> : <p className="text-xs text-muted-foreground">維持できません: {link.reaffirmBlocker}</p> : null}{link.reaffirmedAt && !link.issue ? <p className="text-xs text-muted-foreground">内容確認のうえ維持 {new Date(link.reaffirmedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p> : null}{link.note ? <p className="break-words text-xs text-muted-foreground">{link.note}</p> : null}</li>; })}</ul></section> : null}
        {actionable && aiPreview && props.selected?.id === selected.id ? <details className="border-t py-2"><summary className="min-h-11 cursor-pointer content-center text-sm text-muted-foreground">AIで追加確認</summary><BankAiPanel key={aiPreview.revision} company={company} preview={aiPreview} configured={aiConfigured} model={aiModel} onChooseInvoice={(key) => { if (!busy && choices.some((row) => row.key === key)) setSelectedKey(key); }} /></details> : actionable ? <Button variant="ghost" disabled={busy} className="min-h-11 text-sm text-muted-foreground" onClick={() => router.refresh()}>この明細のAI確認を読み込む</Button> : null}
        <Link className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground" href={`/banking?company=${company}&transaction=${encodeURIComponent(selected.id)}`}>元の銀行明細<ArrowUpRight className="size-3" /></Link>
      </> : <p className="py-12 text-center text-sm text-muted-foreground">照合する銀行明細を選択してください。</p>}
    </section>
  </div>;
}
