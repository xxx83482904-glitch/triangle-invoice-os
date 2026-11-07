"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, LoaderCircle, Search } from "lucide-react";
import { linkMailToBankAction, loadMailBankLinksAction } from "@/app/banking/document-link-actions";
import { Money } from "@/components/app/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";

export type MailBankLinkData = Extract<Awaited<ReturnType<typeof loadMailBankLinksAction>>, { success: true }>;
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s,¥￥]/g, "");
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

// Link a mail document to the bank row it documents (a receipt, notice, contract). Evidence only: no amounts move.
// hint: what the mail says (amount, date), used to put the likeliest rows first.
export function MailBankLinkDialog({ company, initial, hint, onClose }: { company: CompanyScope; initial: MailBankLinkData; hint?: { amount?: number; date?: string }; onClose: () => void }) {
  const [data, setData] = useState(initial), [query, setQuery] = useState(""), [chosenId, setChosenId] = useState("");
  const [error, setError] = useState(""), [pending, startTransition] = useTransition();
  const router = useRouter();
  const { mail, banks } = data;
  const ranked = useMemo(() => {
    const term = normalized(query), anchor = hint?.date || mail.createdAt.slice(0, 10);
    const list = term ? banks.filter((row) => normalized(`${row.date} ${row.content} ${row.amount} ${row.account}`).includes(term)) : banks;
    const score = (row: (typeof banks)[number]) => (hint?.amount && Math.abs(row.amount - hint.amount) < 0.005 ? 1000 : 0) - Math.min(days(row.date, anchor) || 0, 999);
    return list.toSorted((a, b) => score(b) - score(a)).slice(0, term ? 50 : 30);
  }, [banks, query, hint, mail.createdAt]);
  const chosen = banks.find((row) => row.id === chosenId);

  function link() {
    if (!chosen) return;
    setError(""); startTransition(async () => {
      try {
        const result = await linkMailToBankAction(company, { transactionId: chosen.id, mailId: mail.id });
        if (!result.success) throw new Error(result.error);
        toast({ title: "口座明細に紐づけました", variant: "success" });
        const next = await loadMailBankLinksAction(company, mail.id, true);
        if (next.success) setData(next);
        setChosenId(""); router.refresh(); onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "結果を確認できません。画面を更新してください"); }
    });
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!pending}>
      <DialogHeader><DialogTitle>口座明細に紐づけ</DialogTitle><DialogDescription className="break-words">{mail.senderName ? `${mail.senderName} / ` : ""}{mail.title}</DialogDescription></DialogHeader>
      <p className="text-xs text-muted-foreground">この郵便物を、選んだ明細の「領収書・証憑」として表示します。金額や支払状態は変わりません。請求書の支払・入金は、受領請求書の照合から行ってください。</p>
      <label className="relative block"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" aria-label="口座明細を検索" placeholder="摘要・金額・日付・口座" value={query} disabled={pending} onChange={(event) => setQuery(event.target.value)} /></label>
      {hint?.amount ? <p className="text-xs text-muted-foreground">郵便物の金額 <Money value={hint.amount} maximumFractionDigits={2} /> と一致する明細を先頭に表示しています。</p> : null}
      {ranked.length ? <ul aria-label="口座明細" className="max-h-80 divide-y overflow-y-auto border-y">{ranked.map((row) => <li key={row.id}>
        <button className={`w-full min-w-0 space-y-1 p-3 text-left hover:bg-muted ${chosenId === row.id ? "bg-selected" : ""}`} aria-pressed={chosenId === row.id} disabled={pending} onClick={() => setChosenId(row.id)}>
          <span className="flex flex-wrap justify-between gap-2"><strong className="min-w-0 break-words font-medium">{row.date} {row.content}</strong><span className="tabular-nums">{row.side === "INCOME" ? "入金 " : "出金 "}<Money value={row.amount} maximumFractionDigits={2} /></span></span>
          <span className="block break-words text-xs text-muted-foreground">{row.account}{hint?.amount && Math.abs(row.amount - hint.amount) < 0.005 ? " / 金額一致" : ""}</span>
        </button>
      </li>)}</ul> : <p className="text-sm text-muted-foreground">{query ? "該当する明細がありません。" : "紐づけできる明細がありません。"}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="min-h-11" disabled={pending} onClick={onClose}>キャンセル</Button>
        <Button className="min-h-11" disabled={!chosen || pending} onClick={link}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}この明細に紐づける</Button>
      </div>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}
