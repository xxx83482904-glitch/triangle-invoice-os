"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";
import { deleteClientAction } from "@/app/partners/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CompanyScope } from "@/lib/company";
import { toast } from "@/hooks/use-toast";

export function ClientDeleteButton({ company, client }: { company: CompanyScope; client: { id: string; companyName: string; updatedAt: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) { setOpen(value); setError(""); } }}>
    <Button type="button" variant="ghost" size="icon" className="size-11" title="クライアントを削除" aria-label={`${client.companyName}を削除`} onClick={() => setOpen(true)}><Trash2 className="size-4" /></Button>
    <DialogContent showCloseButton={!pending}>
      <DialogHeader><DialogTitle>クライアントを削除しますか？</DialogTitle><DialogDescription className="break-words">{client.companyName}</DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">案件・請求書・見積書で使用中のクライアントは削除できません。過去の履歴は保持されます。</p>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>キャンセル</Button><Button variant="destructive" disabled={pending} onClick={() => startTransition(async () => {
        try {
          const result = await deleteClientAction(company, { id: client.id, updatedAt: client.updatedAt });
          if (result.error) { setError(result.error); return; }
          setOpen(false); router.refresh(); toast({ title: "クライアントを削除しました", variant: "success" });
        } catch { setError("削除に失敗しました。再度お試しください"); }
      })}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}削除する</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
