"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil, Plus, Save } from "lucide-react";
import { saveClientAction } from "@/app/partners/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ClientSaveInput } from "@/lib/partner-project-edits";

const fields = [
  ["companyName", "会社名・氏名", 500], ["contactName", "担当者名", 200], ["email", "メールアドレス", 320],
  ["phone", "電話番号", 100], ["address", "住所", 1000], ["invoiceRegistrationNumber", "登録番号", 100],
] as const;

export function ClientForm({ company, client, onSaved, onPending }: {
  company: CompanyScope; client?: ClientSaveInput; onSaved?: () => void; onPending?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const prefix = useId();
  const [values, setValues] = useState<ClientSaveInput>(client || { companyName: "" });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <form className="min-w-0 space-y-3" onSubmit={(e) => {
    e.preventDefault(); setError(""); onPending?.(true);
    startTransition(async () => {
      try {
        const result = await saveClientAction(company, values);
        if (!result.client) { setError(result.error || "保存に失敗しました"); return; }
        setValues(client ? result.client : { companyName: "" });
        router.refresh(); onSaved?.(); toast({ title: client ? "クライアントを更新しました" : "クライアントを追加しました", variant: "success" });
      } catch { setError("通信に失敗しました。入力内容は保持されています"); }
      finally { onPending?.(false); }
    });
  }}>
    {fields.map(([key, label, max]) => <div key={key} className="space-y-1 text-sm">
      <label htmlFor={`${prefix}-${key}`}>{label}</label>
      <Input id={`${prefix}-${key}`} name={key} className="min-h-11" maxLength={max} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} required={key === "companyName"} disabled={pending} value={values[key] || ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
    </div>)}
    <div className="space-y-1 text-sm"><label htmlFor={`${prefix}-memo`}>備考</label><Textarea id={`${prefix}-memo`} name="memo" maxLength={6000} disabled={pending} value={values.memo || ""} onChange={(e) => setValues({ ...values, memo: e.target.value })} /></div>
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <Button type="submit" className="min-h-11 w-full" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : client ? <Save className="size-4" /> : <Plus className="size-4" />}{client ? "変更を保存" : "クライアントを追加"}</Button>
  </form>;
}

export function ClientEditButton({ company, client }: { company: CompanyScope; client: ClientSaveInput }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
    <Button type="button" size="icon" variant="ghost" className="size-11" title="クライアントを編集" aria-label={`${client.companyName}を編集`} onClick={() => setOpen(true)}><Pencil className="size-4" /></Button>
    <DialogContent aria-describedby={undefined} showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>クライアントを編集</DialogTitle></DialogHeader>
      <ClientForm company={company} client={client} onPending={setPending} onSaved={() => setOpen(false)} />
    </DialogContent>
  </Dialog>;
}
