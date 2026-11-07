"use client";

import { Money } from "@/components/app/money";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUpRight, Eye, EyeOff, LoaderCircle, Paperclip, RefreshCw, Trash2, Upload } from "lucide-react";
import { loadBankDetailDocumentsAction, removeBankReceiptAction } from "@/app/banking/receipt-actions";
import { OriginalDocumentPreview } from "@/app/received-invoices/original-document-preview";
import { BankInvoicePreview } from "@/components/app/bank-invoice-preview";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";

type Documents = Extract<Awaited<ReturnType<typeof loadBankDetailDocumentsAction>>, { success: true }>;
const accept = "application/pdf,image/jpeg,image/png";

// Linked invoices and attached receipts for one bank row, readable without opening the reconciliation dialog.
export function BankDetailDocuments({ company, transactionId, disabled, onChanged }: { company: CompanyScope; transactionId: string; disabled: boolean; onChanged: () => void }) {
  const [documents, setDocuments] = useState<Documents | null>(null), [loadError, setLoadError] = useState("");
  const [shown, setShown] = useState<string | null>(null), [removing, setRemoving] = useState("");
  const [error, setError] = useState(""), [uploading, setUploading] = useState(false), [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const busy = disabled || pending || uploading;

  async function load() {
    const result = await loadBankDetailDocumentsAction(company, transactionId);
    if (!result.success) throw new Error(result.error);
    setDocuments(result); setLoadError("");
    // Show the first linked original by default; receipts open on request.
    setShown((current) => current ?? (result.links.find((row) => row.invoice?.originalHref)?.id || null));
  }
  useEffect(() => {
    let active = true;
    loadBankDetailDocumentsAction(company, transactionId).then((result) => {
      if (!active) return;
      if (!result.success) { setLoadError(result.error); return; }
      setDocuments(result); setShown(result.links.find((row) => row.invoice?.originalHref)?.id || null);
    }).catch(() => { if (active) setLoadError("書類を取得できませんでした"); });
    return () => { active = false; };
  }, [company, transactionId]);

  function reload() {
    setLoadError(""); startTransition(async () => { try { await load(); } catch (cause) { setLoadError(cause instanceof Error ? cause.message : "書類を取得できませんでした"); } });
  }
  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file || busy) return;
    setError(""); setUploading(true);
    try {
      const body = new FormData();
      body.set("company", company); body.set("transactionId", transactionId); body.set("file", file);
      const response = await fetch("/api/uploads/bank-receipts", { method: "POST", body });
      const result = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "添付できませんでした");
      toast({ title: "領収書を添付しました", variant: "success" });
      setShown(result.id); await load(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "添付結果を確認できません。画面を更新してください"); }
    finally { setUploading(false); if (input.current) input.current.value = ""; }
  }
  function remove(id: string) {
    setError(""); startTransition(async () => {
      try {
        const result = await removeBankReceiptAction(company, id);
        if (!result.success) throw new Error(result.error);
        toast({ title: "添付を外しました", variant: "success" });
        setRemoving(""); if (shown === id) setShown(null); await load(); onChanged();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "結果を確認できません。画面を更新してください"); }
    });
  }

  if (loadError) return <section className="space-y-2 rounded-lg border p-3 text-sm"><p role="alert" className="break-words text-destructive">{loadError}</p><Button variant="outline" className="min-h-11" disabled={busy} onClick={reload}><RefreshCw className="size-4" />再読み込み</Button></section>;
  if (!documents) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />照合先・添付書類を読み込み中…</p>;
  const { links, receipts } = documents;
  return <div className="space-y-5">
    {links.length ? <section aria-label="照合先の請求書" className="space-y-3">
      <h3 className="text-xs text-muted-foreground">照合先の請求書</h3>
      <ul className="divide-y rounded-lg border">{links.map((link) => <li key={link.id} className="min-w-0 space-y-3 p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="break-words font-medium">{link.invoice ? `${link.invoice.party} / ${link.invoice.title}` : "削除・移動された請求書"}</p>
            <p className="break-words text-xs text-muted-foreground">{link.invoice?.project ? `${link.invoice.project} / ` : ""}照合額 <Money value={link.amount} maximumFractionDigits={2} />{link.fee ? <>（手数料 <Money value={link.fee.amount} maximumFractionDigits={2} />）</> : null}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {link.invoice?.originalHref ? <Button variant="ghost" className="min-h-11" aria-pressed={shown === link.id} onClick={() => setShown(shown === link.id ? null : link.id)}>{shown === link.id ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{shown === link.id ? "原本を閉じる" : "原本"}</Button> : null}
            {link.invoice ? <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={link.invoice.href} target="_blank" rel="noreferrer">書類<ArrowUpRight className="size-4" /></Link></Button> : null}
          </div>
        </div>
        {link.issue ? <p className="break-words text-xs text-destructive">{link.issue}</p> : null}
        {link.invoice && !link.invoice.originalHref ? <p className="text-xs text-muted-foreground">原本未添付</p> : null}
        {link.invoice && shown === link.id ? <BankInvoicePreview company={company} invoice={link.invoice} size="pane" /> : null}
      </li>)}</ul>
    </section> : null}
    <section aria-label="領収書・証憑" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs text-muted-foreground">領収書・証憑{receipts.length ? `（${receipts.length}件）` : ""}</h3>
        <input ref={input} type="file" accept={accept} className="sr-only" aria-label="領収書ファイルを選択" tabIndex={-1} disabled={busy} onChange={(event) => void upload(event.target.files)} />
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => input.current?.click()}>{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}{uploading ? "添付中…" : "領収書を添付"}</Button>
      </div>
      {!receipts.length ? <p className="text-xs text-muted-foreground">{links.length ? "請求書以外の証憑（振込控え・レシートなど）を添付できます。" : "請求書のない出金は、レシートや領収書のPDF・写真を添付しておくと確認と保管が楽になります。"}PDF・JPEG・PNG、10MBまで。</p> : <ul className="divide-y rounded-lg border">{receipts.map((receipt) => <li key={receipt.id} className="min-w-0 space-y-3 p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1"><p className="flex min-w-0 items-center gap-1 break-all font-medium"><Paperclip className="size-3.5 shrink-0" />{receipt.fileName}</p><p className="text-xs text-muted-foreground">{receipt.createdAt.slice(0, 10)}{receipt.uploadedBy ? ` / ${receipt.uploadedBy}` : ""}</p></div>
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" className="min-h-11" aria-pressed={shown === receipt.id} onClick={() => setShown(shown === receipt.id ? null : receipt.id)}>{shown === receipt.id ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{shown === receipt.id ? "閉じる" : "表示"}</Button>
            <Button variant="ghost" className="min-h-11" aria-label={`${receipt.fileName}の添付を外す`} disabled={busy} onClick={() => setRemoving(receipt.id)}><Trash2 className="size-4" />外す</Button>
          </div>
        </div>
        {removing === receipt.id ? <div className="flex flex-wrap items-center gap-2 border-l-2 border-destructive p-2"><p className="text-xs">この明細から添付を外します（操作履歴には残ります）。</p><Button variant="destructive" className="min-h-11" disabled={busy} onClick={() => remove(receipt.id)}>外す</Button><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setRemoving("")}>キャンセル</Button></div> : null}
        {shown === receipt.id ? <OriginalDocumentPreview key={receipt.fileUrl} company={company} fileUrl={receipt.fileUrl} fileName={receipt.fileName} mimeType={receipt.mimeType} frameClassName="h-96" imageClassName="max-h-96" /> : null}
      </li>)}</ul>}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </section>
  </div>;
}
