"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { reaffirmBankReconciliationAction, reaffirmInvoiceReconciliationsAction } from "@/app/banking/reconcile/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import type { ReconciliationInvoice, ReconciliationOverview } from "@/lib/bank-reconciliation";
import type { CompanyScope } from "@/lib/company";

const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
type Target = { kind: "link"; link: ReconciliationOverview["links"][number]; title: string } | { kind: "invoice"; invoice: ReconciliationInvoice };

// "内容を確認して照合を維持": re-records the evidence of a flagged link without touching payments or document statuses.
export function BankReconciliationReaffirm({ company, target, disabled = false }: { company: CompanyScope; target: Target; disabled?: boolean }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const count = target.kind === "link" ? 1 : target.invoice.reaffirmable;
  function run() {
    startTransition(async () => {
      try {
        const result = target.kind === "link"
          ? await reaffirmBankReconciliationAction(company, target.link.id, target.link.updatedAt)
          : await reaffirmInvoiceReconciliationsAction(company, target.invoice.kind, target.invoice.id, target.invoice.updatedAt);
        if (!result.success) { setError(result.error); return; }
        setOpen(false); router.refresh(); toast({ title: `${count}件の照合を維持しました`, variant: "success" });
      } catch { setError("結果を確認できませんでした。画面を更新してください。"); }
    });
  }
  return <>
    <Button type="button" className="min-h-11" variant="outline" disabled={disabled || pending} onClick={() => { setError(""); setOpen(true); }}><ShieldCheck className="size-4" />内容を確認して照合を維持{target.kind === "invoice" && count > 1 ? `（${count}件）` : ""}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
      <DialogContent showCloseButton={!pending} onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>現在の内容で照合を維持しますか？</DialogTitle><DialogDescription>銀行明細・請求書・入金/支払い記録の現在の値を照合の根拠として記録し直します。入金・支払い記録と書類の状態は変更しません。金額が合わない場合は維持できません。</DialogDescription></DialogHeader>
        <div className="space-y-1 text-sm">
          {target.kind === "link"
            ? <><p className="break-words">{target.title} / 照合額 {money(target.link.amount)}</p><p className="break-words text-amber-800 dark:text-amber-300">{target.link.issue}</p></>
            : <><p className="break-words">{target.invoice.title} / {target.invoice.party} / 請求額 {money(target.invoice.total)}</p><p className="text-xs text-muted-foreground">要再確認の照合 {count}件をまとめて維持します。1件でも維持できない場合は何も変更しません。</p></>}
        </div>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
        <Button type="button" className="min-h-11" disabled={pending} onClick={run}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}照合を維持</Button>
      </DialogContent>
    </Dialog>
  </>;
}
