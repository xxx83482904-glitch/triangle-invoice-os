"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { CompanyScope } from "@/lib/company";
import { createIssuedInvoiceFeedback } from "@/app/issued-invoices/create-feedback-action";
import { useFeedbackForm } from "@/hooks/use-feedback-form";
import { toast } from "@/hooks/use-toast";
import { OperationError, OperationPending } from "@/components/app/operation-feedback";

const CreatePending = createContext<boolean | null>(null);
const CreateBusy = createContext<((value: boolean) => void) | undefined>(undefined);

export function InvoiceCreateDialog({ children, company }: { children: ReactNode; company?: CompanyScope }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  return <CreateBusy.Provider value={company === "JAPAN" ? setBusy : undefined}><Dialog open={company === "JAPAN" ? open : undefined} onOpenChange={company === "JAPAN" ? (value) => { if (!busy) setOpen(value); } : undefined}>
    <DialogTrigger asChild><Button><Plus className="size-4" />新規作成</Button></DialogTrigger>
    <DialogContent showCloseButton={company !== "JAPAN" || !busy} aria-describedby={undefined} className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>請求書を作成</DialogTitle></DialogHeader>
      {children}
    </DialogContent>
  </Dialog></CreateBusy.Provider>;
}

export function InvoiceCreateForm({ company, action, children }: { company: CompanyScope; action: (form: FormData) => Promise<void>; children: ReactNode }) {
  const onBusy = useContext(CreateBusy);
  const form = useFeedbackForm(company, createIssuedInvoiceFeedback, "請求書を作成しました", onBusy);
  return <CreatePending.Provider value={company === "JAPAN" ? form.pending : null}><form action={action} onSubmit={form.onSubmit} className="space-y-4">
    {company === "JAPAN" ? <fieldset disabled={form.pending} className="min-w-0 space-y-4">{children}</fieldset> : children}
    {company === "JAPAN" ? <OperationError message={form.feedback?.error ? form.feedback.message : undefined} /> : null}
  </form></CreatePending.Provider>;
}

export function InvoiceCreatedNotice({ id }: { id: string }) {
  const announced = useRef<string | undefined>(undefined);
  useEffect(() => { if (announced.current !== id) { announced.current = id; toast({ title: "請求書を作成しました", variant: "success" }); } }, [id]);
  return <p role="status" className="text-sm text-primary">請求書を作成しました</p>;
}

export function InvoiceCreateSubmit() {
  const status = useFormStatus(), feedbackPending = useContext(CreatePending);
  const pending = feedbackPending ?? status.pending;
  return <Button type="submit" disabled={pending} className="w-full"><OperationPending pending={feedbackPending === true}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{pending ? "作成中..." : "作成してプレビュー"}</OperationPending></Button>;
}
