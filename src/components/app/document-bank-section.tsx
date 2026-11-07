"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Link2, LoaderCircle, RefreshCw, Unlink } from "lucide-react";
import { loadInvoiceBankLinksAction, loadMailBankLinksAction } from "@/app/banking/document-link-actions";
import { removeBankReceiptAction } from "@/app/banking/receipt-actions";
import { InvoiceBankLinksDialog, type InvoiceBankLinkData } from "@/components/app/invoice-bank-links-dialog";
import { MailBankLinkDialog, type MailBankLinkData } from "@/components/app/mail-bank-link-dialog";
import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";

export type DocumentBankTarget = { kind: "issued" | "received"; id: string } | { kind: "mail"; id: string; hint?: { amount?: number; date?: string } };
type InvoiceSummary = Extract<Awaited<ReturnType<typeof loadInvoiceBankLinksAction>>, { success: true }>;
type MailSummary = Extract<Awaited<ReturnType<typeof loadMailBankLinksAction>>, { success: true }>;

const box = "workspace-detail-group space-y-3";

// The "銀行照合" block in any document's detail: what this document is matched or linked to, and the way to do it here.
// Invoices reconcile amounts against bank rows; mail links to bank rows as evidence (its invoice, if any, reconciles amounts).
export function DocumentBankSection({ company, target }: { company: CompanyScope; target: DocumentBankTarget }) {
  if (target.kind === "mail") return <MailBankSection company={company} id={target.id} hint={target.hint} />;
  return <section aria-label="銀行照合" className={box}><h3 className="flex items-center gap-2 text-sm font-semibold"><Landmark className="size-4" />銀行照合</h3><InvoiceBankBlock company={company} kind={target.kind} id={target.id} /></section>;
}

function useLoad<T extends { success: boolean }>(load: () => Promise<T | { success: false; error: string }>, deps: unknown[]) {
  const [value, setValue] = useState<Extract<T, { success: true }> | null>(null), [error, setError] = useState(""), [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    load().then((result) => { if (!active) return; if (result.success) { setValue(result as Extract<T, { success: true }>); setError(""); } else setError((result as { error: string }).error); })
      .catch(() => { if (active) setError("照合情報を取得できませんでした"); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { value, error, reload: () => setVersion((current) => current + 1) };
}

function Failure({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div className="space-y-2 text-sm"><p role="alert" className="break-words text-destructive">{error}</p><Button variant="outline" className="min-h-11" onClick={onRetry}><RefreshCw className="size-4" />再読み込み</Button></div>;
}
const Loading = () => <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />照合情報を読み込み中…</p>;

function InvoiceBankBlock({ company, kind, id }: { company: CompanyScope; kind: "issued" | "received"; id: string }) {
  const { value, error, reload } = useLoad<InvoiceSummary>(() => loadInvoiceBankLinksAction(company, kind, id), [company, kind, id]);
  const [dialog, setDialog] = useState<InvoiceBankLinkData | null>(null), [opening, startOpening] = useTransition(), [openError, setOpenError] = useState("");
  if (error) return <Failure error={error} onRetry={reload} />;
  if (!value) return <Loading />;
  const { invoice, links, blocked } = value;
  const reconciled = invoice ? Math.max(0, invoice.total - invoice.outstanding) : links.reduce((sum, row) => sum + row.amount, 0);
  function open() {
    setOpenError(""); startOpening(async () => {
      const result = await loadInvoiceBankLinksAction(company, kind, id, true);
      if (result.success) setDialog(result); else setOpenError(result.error);
    });
  }
  return <div className="space-y-3">
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
      <span>{links.length ? `${links.length}件の明細と照合済み` : "口座明細と未照合"}</span>
      {invoice ? <><span>照合済み <Money value={reconciled} maximumFractionDigits={2} /></span><span>{kind === "issued" ? "未入金" : "未払い"} <Money value={invoice.outstanding} maximumFractionDigits={2} /></span></> : null}
    </p>
    {links.length ? <ul className="space-y-1 text-sm">{links.map((link) => <li key={link.id} className="break-words">{link.bank ? <>{link.bank.date} {link.bank.content}<span className="text-muted-foreground"> / {link.bank.account} / </span><Money value={link.amount} maximumFractionDigits={2} /></> : "削除された明細"}{link.issue ? <span className="block text-xs text-destructive">{link.issue}</span> : null}</li>)}</ul> : null}
    {blocked ? <p className="text-xs text-muted-foreground">{blocked}</p> : <Button variant="outline" className="min-h-11" disabled={opening} onClick={open}>{opening ? <LoaderCircle className="size-4 animate-spin" /> : <Landmark className="size-4" />}{links.length ? "照合を確認・追加" : "口座明細と照合"}</Button>}
    {openError ? <p role="alert" className="break-words text-sm text-destructive">{openError}</p> : null}
    {dialog ? <InvoiceBankLinksDialog company={company} initial={dialog} onClose={() => { setDialog(null); reload(); }} /> : null}
  </div>;
}

function MailBankSection({ company, id, hint }: { company: CompanyScope; id: string; hint?: { amount?: number; date?: string } }) {
  const { value, error, reload } = useLoad<MailSummary>(() => loadMailBankLinksAction(company, id), [company, id]);
  const [dialog, setDialog] = useState<MailBankLinkData | null>(null), [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState(""), [actionError, setActionError] = useState("");
  const router = useRouter();
  function open() {
    setActionError(""); startTransition(async () => {
      const result = await loadMailBankLinksAction(company, id, true);
      if (result.success) setDialog(result); else setActionError(result.error);
    });
  }
  function unlink(attachmentId: string) {
    setActionError(""); startTransition(async () => {
      const result = await removeBankReceiptAction(company, attachmentId);
      if (!result.success) { setActionError(result.error); return; }
      toast({ title: "紐づけを外しました", variant: "success" }); setRemoving(""); reload(); router.refresh();
    });
  }
  return <section aria-label="銀行照合" className={box}>
    <h3 className="flex items-center gap-2 text-sm font-semibold"><Landmark className="size-4" />銀行照合</h3>
    {error ? <Failure error={error} onRetry={reload} /> : !value ? <Loading /> : <>
      {/* Only invoices move money; other mail (receipts, notices, contracts) is evidence only. */}
      {value.invoiceId || value.mail.category === "INVOICE" ? <div className="space-y-2 border-b pb-3">
        <h4 className="text-xs text-muted-foreground">請求書としての照合（金額）</h4>
        {value.invoiceId ? <InvoiceBankBlock company={company} kind="received" id={value.invoiceId} />
          : <p className="text-xs text-muted-foreground">受領請求書として登録すると、口座明細と金額を照合できます。</p>}
      </div> : null}
      <div className="space-y-2">
        <h4 className="text-xs text-muted-foreground">証憑として紐づけ（金額は動きません）</h4>
        {value.links.length ? <ul className="divide-y rounded-lg border">{value.links.map((link) => <li key={link.id} className="space-y-2 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 flex-1 break-words">{link.bank.date} {link.bank.content}<span className="block text-xs text-muted-foreground">{link.bank.account} / {link.bank.side === "INCOME" ? "入金" : "出金"} <Money value={link.bank.amount} maximumFractionDigits={2} /></span></p>
            <Button variant="ghost" className="min-h-11" disabled={pending} onClick={() => setRemoving(link.id)}><Unlink className="size-4" />外す</Button>
          </div>
          {removing === link.id ? <div className="flex flex-wrap items-center gap-2 border-l-2 border-destructive p-2"><p className="text-xs">この明細との紐づけを外します（操作履歴には残ります）。</p><Button variant="destructive" className="min-h-11" disabled={pending} onClick={() => unlink(link.id)}>外す</Button><Button variant="ghost" className="min-h-11" disabled={pending} onClick={() => setRemoving("")}>キャンセル</Button></div> : null}
        </li>)}</ul> : null}
        <Button variant="outline" className="min-h-11" disabled={pending} onClick={open}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}口座明細に紐づけ</Button>
        {actionError ? <p role="alert" className="break-words text-sm text-destructive">{actionError}</p> : null}
      </div>
    </>}
    {dialog ? <MailBankLinkDialog company={company} initial={dialog} hint={hint} onClose={() => { setDialog(null); reload(); }} /> : null}
  </section>;
}
