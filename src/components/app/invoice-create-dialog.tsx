"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function InvoiceCreateDialog({ children }: { children: ReactNode }) {
  return <Dialog>
    <DialogTrigger asChild><Button><Plus className="size-4" />新規作成</Button></DialogTrigger>
    <DialogContent aria-describedby={undefined} className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>請求書を作成</DialogTitle></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}

export function InvoiceCreateSubmit() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} className="w-full">{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}{pending ? "作成中..." : "作成してプレビュー"}</Button>;
}
