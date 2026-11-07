"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Search, Unlink } from "lucide-react";
import { loadInvoiceBankLinksAction } from "@/app/banking/document-link-actions";
import { removeBankReconciliationAction } from "@/app/banking/reconcile/actions";
import { BankReconciliationConfirmation } from "@/components/app/bank-reconciliation-desk";
import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { reconciliationAmountGap } from "@/lib/bank-reconciliation-allocation";
import type { CompanyScope } from "@/lib/company";

export type InvoiceBankLinkData = Extract<Awaited<ReturnType<typeof loadInvoiceBankLinksAction>>, { success: true }>;
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s,¥￥]/g, "");

// Reconcile from the invoice side: pick the bank row that paid this invoice, then confirm with the same allocation
// step the bank ledger uses, so both entry points write the same reconciliation record under the same rules.
export function InvoiceBankLinksDialog({ company, initial, onClose }: { company: CompanyScope; initial: InvoiceBankLinkData; onClose: () => void }) {
  const [data, setData] = useState(initial), [pending, startTransition] = useTransition(), [saving, setSaving] = useState(false);
  const [query, setQuery] = useState(""), [chosenId, setChosenId] = useState(""), [removing, setRemoving] = useState("");
  const [error, setError] = useState(""), [done, setDone] = useState(false);
  const router = useRouter();
  const { invoice, links, blocked, candidates, banks, accounts, choices } = data;
  const busy = pending || saving;
  const kind = invoice?.kind === "issued" ? "issued" : "received";
  const candidateById = useMemo(() => new Map(candidates.map((row) => [row.bankId, row])), [candidates]);
  const chosen = banks.find((row) => row.id === chosenId);
  const visible = useMemo(() => {
    const term = normalized(query);
    if (!term) return [...candidates.map((row) => banks.find((bank) => bank.id === row.bankId)!).filter(Boolean), ...(candidates.length ? [] : banks.slice(0, 20))];
    return banks.filter((row) => normalized(`${row.date} ${row.content} ${row.amount} ${accounts[row.accountId] || ""}`).includes(term)).slice(0, 50);
  }, [query, candidates, banks, accounts]);

  async function reload() {
    if (!invoice) return;
    const result = await loadInvoiceBankLinksAction(company, kind, invoice.id, true);
    if (!result.success) throw new Error(result.error);
    setData(result); setChosenId(""); setRemoving(""); router.refresh();
  }
  function completed() {
    startTransition(async () => { try { await reload(); setDone(true); } catch { setError("保存後の情報を取得できません。画面を更新してください"); } });
  }
  function unlink(id: string, updatedAt: string) {
    setError(""); setDone(false);
    startTransition(async () => {
      try {
        const result = await removeBankReconciliationAction(company, id, updatedAt);
        if (!result.success) throw new Error(result.error);
        toast({ title: "照合を解除しました", variant: "success" }); await reload();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "結果を確認できません。画面を更新してください"); }
    });
  }

  const title = kind === "issued" ? "入金の照合" : "支払の照合";
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="break-words">{invoice ? `${invoice.party} / ${invoice.title}` : "請求書"}</DialogDescription></DialogHeader>
      {invoice ? <dl className="grid grid-cols-3 gap-2 border-b pb-3 text-sm tabular-nums">
        <div><dt className="text-xs text-muted-foreground">請求額</dt><dd><Money value={invoice.total} maximumFractionDigits={2} /></dd></div>
        <div><dt className="text-xs text-muted-foreground">照合済み</dt><dd><Money value={Math.max(0, invoice.total - invoice.outstanding)} maximumFractionDigits={2} /></dd></div>
        <div><dt className="text-xs text-muted-foreground">{kind === "issued" ? "未入金" : "未払い"}</dt><dd className={invoice.outstanding > 0 ? "font-medium" : ""}><Money value={invoice.outstanding} maximumFractionDigits={2} /></dd></div>
      </dl> : null}
      {done ? <p role="status" className="flex items-center gap-2 rounded-lg border border-primary/40 bg-selected p-3 text-sm"><Check className="size-4 shrink-0 text-primary" />{invoice && invoice.outstanding <= 0 ? "この請求書の照合が完了しました。" : "照合を保存しました。残りの明細も選べます。"}</p> : null}

      {links.length ? <section aria-label="照合済みの口座明細" className="space-y-2">
        <h3 className="text-xs text-muted-foreground">照合済みの口座明細</h3>
        <ul className="divide-y rounded-lg border">{links.map((link) => <li key={link.id} className="space-y-2 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1"><p className="break-words font-medium">{link.bank ? `${link.bank.date} ${link.bank.content}` : "削除された明細"}</p><p className="break-words text-xs text-muted-foreground">{link.bank?.account}{link.bank ? " / 明細 " : ""}{link.bank ? <Money value={link.bank.amount} maximumFractionDigits={2} /> : null} / 照合額 <Money value={link.amount} maximumFractionDigits={2} /></p></div>
            <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setRemoving(link.id)}><Unlink className="size-4" />解除</Button>
          </div>
          {link.issue ? <p className="break-words text-xs text-destructive">{link.issue}</p> : null}
          {removing === link.id ? <div className="flex flex-wrap items-center gap-2 border-l-2 border-destructive p-2"><p className="text-xs">照合を解除すると、照合で作った{kind === "issued" ? "入金" : "支払"}記録も取り消されます。</p><Button variant="destructive" className="min-h-11" disabled={busy} onClick={() => unlink(link.id, link.updatedAt)}>解除する</Button><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setRemoving("")}>キャンセル</Button></div> : null}
        </li>)}</ul>
      </section> : null}

      {blocked ? <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{blocked}</p>
        : invoice && invoice.outstanding <= 0 && !invoice.payments.some((payment) => payment.available > 0) ? null
        : invoice ? <section aria-label="照合する口座明細" className="min-w-0 space-y-3">
          {chosen ? <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2"><p className="min-w-0 break-words text-sm"><span className="text-muted-foreground">選択中の明細: </span>{chosen.date} {chosen.content} <Money value={chosen.amount} maximumFractionDigits={2} /></p><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setChosenId("")}>選択を変更</Button></div>
            <BankReconciliationConfirmation key={`${chosen.id}:${chosen.updatedAt}:${invoice.key}:${invoice.updatedAt}`} company={company} bank={chosen} invoice={invoice} invoices={choices.filter((row) => row.kind === invoice.kind)} onBusy={setSaving} onComplete={completed} />
          </> : <>
            <label className="relative block"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" aria-label="口座明細を検索" placeholder="摘要・金額・日付・口座" value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} /></label>
            {!query && !candidates.length ? <p className="text-xs text-muted-foreground">金額・名義・日付が近い明細は見つかりませんでした。新しい順に表示しています。検索で絞り込めます。</p> : null}
            {visible.length ? <ul aria-label="口座明細の候補" className="max-h-80 divide-y overflow-y-auto border-y">{visible.map((bank) => {
              const match = candidateById.get(bank.id), gap = reconciliationAmountGap(bank, invoice);
              return <li key={bank.id}><button className="w-full min-w-0 space-y-1 p-3 text-left hover:bg-muted" disabled={busy} onClick={() => setChosenId(bank.id)}>
                <span className="flex flex-wrap justify-between gap-2"><strong className="min-w-0 break-words font-medium">{bank.date} {bank.content}</strong><span className="tabular-nums"><Money value={bank.amount} maximumFractionDigits={2} /></span></span>
                <span className="block break-words text-xs text-muted-foreground">{accounts[bank.accountId] || "口座"}{bank.remaining < bank.amount ? <> / 未照合 <Money value={bank.remaining} maximumFractionDigits={2} /></> : null}{match ? ` / ${match.confidence === "strong" ? "有力候補" : "候補・要確認"}` : ""}{match?.reasons.length ? `（${match.reasons.join("・")}）` : ""}</span>
                <span className={`block break-words text-xs ${gap.kind === "exact" ? "font-medium text-primary" : gap.kind === "fee" ? "text-sky-700 dark:text-sky-300" : "text-muted-foreground"}`}>{gap.kind === "exact" ? "金額一致" : <>差額 <Money value={gap.amount} maximumFractionDigits={2} />・{gap.label}</>}</span>
              </button></li>;
            })}</ul> : <p className="text-sm text-muted-foreground">{query ? "該当する未照合の明細がありません。" : "未照合の明細がありません。"}</p>}
          </>}
        </section> : null}
      {busy ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />処理中です…</p> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}
