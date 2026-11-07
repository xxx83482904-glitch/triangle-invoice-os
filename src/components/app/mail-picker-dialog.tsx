"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Link2, LoaderCircle, Search } from "lucide-react";
import { linkMailToBankAction, loadLinkableMailAction } from "@/app/banking/document-link-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { LinkableMail } from "@/lib/bank-document-links";

const categoryLabels: Record<string, string> = { INVOICE: "請求書", CONTRACT: "契約書", ESTIMATE: "見積書", DELIVERY_NOTE: "納品書", RECEIPT: "領収書", NOTICE: "通知", CUSTOMS: "通関", OTHER: "その他" };
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s/g, "");

// Pick an already-registered mail document (a receipt, notice, contract…) as evidence for a bank row.
export function MailPickerDialog({ company, transactionId, onClose, onLinked }: { company: CompanyScope; transactionId: string; onClose: () => void; onLinked: (attachmentId: string) => void }) {
  const [mail, setMail] = useState<LinkableMail[] | null>(null), [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState(""), [category, setCategory] = useState(""), [chosenId, setChosenId] = useState("");
  const [error, setError] = useState(""), [pending, startTransition] = useTransition();
  useEffect(() => {
    let active = true;
    loadLinkableMailAction(company, transactionId).then((result) => { if (!active) return; if (result.success) setMail(result.mail); else setLoadError(result.error); })
      .catch(() => { if (active) setLoadError("郵便物を取得できませんでした"); });
    return () => { active = false; };
  }, [company, transactionId]);
  const visible = useMemo(() => {
    const term = normalized(query);
    return (mail || []).filter((row) => (!category || row.category === category) && (!term || normalized(`${row.title} ${row.senderName} ${row.fileName} ${row.createdAt.slice(0, 10)}`).includes(term))).slice(0, 60);
  }, [mail, query, category]);

  function link() {
    if (!chosenId) return;
    setError(""); startTransition(async () => {
      const result = await linkMailToBankAction(company, { transactionId, mailId: chosenId });
      if (!result.success) { setError(result.error); return; }
      toast({ title: "郵便物を紐づけました", variant: "success" }); onLinked(result.id);
    });
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!pending}>
      <DialogHeader><DialogTitle>郵便物から選ぶ</DialogTitle><DialogDescription>領収書・通知・契約書などの郵便物を、この明細の証憑として紐づけます。金額や支払状態は変わりません。</DialogDescription></DialogHeader>
      {loadError ? <p role="alert" className="break-words text-sm text-destructive">{loadError}</p> : !mail ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />郵便物を読み込み中…</p> : <>
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-0 flex-1 basis-56"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" aria-label="郵便物を検索" placeholder="件名・発送元・ファイル名・日付" value={query} disabled={pending} onChange={(event) => setQuery(event.target.value)} /></label>
          <select aria-label="分類で絞り込む" className="min-h-11 rounded-md border bg-background px-3 text-sm" value={category} disabled={pending} onChange={(event) => setCategory(event.target.value)}>
            <option value="">すべての分類</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {visible.length ? <ul aria-label="郵便物" className="max-h-80 divide-y overflow-y-auto border-y">{visible.map((row) => <li key={row.id}>
          <button className={`w-full min-w-0 space-y-1 p-3 text-left hover:bg-muted ${chosenId === row.id ? "bg-selected" : ""}`} aria-pressed={chosenId === row.id} disabled={pending} onClick={() => setChosenId(row.id)}>
            <span className="flex flex-wrap justify-between gap-2"><strong className="min-w-0 break-words font-medium">{row.title}</strong><span className="text-xs text-muted-foreground">{categoryLabels[row.category] || row.category}</span></span>
            <span className="block break-words text-xs text-muted-foreground">{row.senderName ? `${row.senderName} / ` : ""}{row.createdAt.slice(0, 10)}{row.relatedReceivedInvoiceId ? " / 受領請求書あり（金額の照合は請求書から）" : ""}</span>
          </button>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">{query || category ? "該当する郵便物がありません。" : "紐づけできる郵便物がありません。"}</p>}
      </>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="min-h-11" disabled={pending} onClick={onClose}>キャンセル</Button>
        <Button className="min-h-11" disabled={!chosenId || pending} onClick={link}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}紐づける</Button>
      </div>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}
