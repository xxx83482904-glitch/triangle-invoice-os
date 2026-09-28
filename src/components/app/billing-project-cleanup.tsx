"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, LoaderCircle } from "lucide-react";
import { consolidateBillingProjectAction } from "@/app/partners/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import type { BillingProjectGroup } from "@/lib/billing-project-cleanup";
import type { CompanyScope } from "@/lib/company";

export function BillingProjectCleanup({ company, groups }: { company: CompanyScope; groups: BillingProjectGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const remaining = groups.filter((g) => !done.includes(g.signature));
  if (!remaining.length && !open) return null;
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) { setOpen(value); setError(""); } }}>
    <Button variant="outline" className="min-h-11" onClick={() => setOpen(true)}><GitMerge className="size-4" />案件の重複を整理</Button>
    <DialogContent showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>請求回数で分かれた案件</DialogTitle><DialogDescription>同じ請求先の案件をまとめます。請求回数は書類に残り、金額・入金記録・原本は変わりません。</DialogDescription></DialogHeader>
      {remaining.map((group) => <section key={group.signature} className="min-w-0 space-y-2 border-b py-3 last:border-0">
        <h3 className="break-words text-sm font-semibold">{group.name}</h3><p className="break-words text-xs text-muted-foreground">{group.clientName} · 書類{group.documentCount}件</p>
        <ul className="list-inside list-disc space-y-1 break-words text-sm">{group.names.map((name, index) => <li key={index}>{name}</li>)}</ul>
        <Button className="min-h-11" disabled={pending} onClick={() => { setError(""); startTransition(async () => {
          try {
            const result = await consolidateBillingProjectAction(company, { id: group.id, signature: group.signature });
            if (!result.project) { setError(result.error || "整理に失敗しました"); return; }
            setDone((old) => [...old, group.signature]); router.refresh(); toast({ title: "案件をまとめました", variant: "success" });
          } catch { setError("通信に失敗しました。再度確認してください"); }
        }); }}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <GitMerge className="size-4" />}この案件にまとめる</Button>
      </section>)}
      {!remaining.length ? <p role="status" className="text-sm">案件の整理が完了しました</p> : null}
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </DialogContent>
  </Dialog>;
}
