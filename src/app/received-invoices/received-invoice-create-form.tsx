"use client";

import { createContext, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OperationError, OperationPending } from "@/components/app/operation-feedback";
import { toast } from "@/hooks/use-toast";
import { operationErrorMessage, operationFailureToast, receivedUploadRedirect } from "@/lib/operation-feedback";
import type { CompanyScope } from "@/lib/company";

const UploadPending = createContext(false);

export function ReceivedInvoiceCreateForm({ company, children }: { company: CompanyScope; children: ReactNode }) {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false), router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    if (company !== "JAPAN") return;
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget, payload = new FormData(form);
    inFlight.current = true; setPending(true); setError("");
    try {
      // Keep the existing multipart endpoint, field names, validation, and success URL.
      const response = await fetch(form.action, { method: "POST", body: payload });
      const target = receivedUploadRedirect(response, window.location.origin);
      if (!target) {
        const body: unknown = await response.json().catch(() => undefined);
        const message = operationErrorMessage(body, "登録結果を確認できませんでした。入力内容とファイルの選択を保持しています。ログイン・通信状況と登録済みの内容を確認してください。");
        setError(message); toast(operationFailureToast(message)); return;
      }
      toast({ title: "受領請求書を登録しました", variant: "success" });
      form.reset(); router.push(target); router.refresh();
    } catch {
      const message = "通信に失敗し、登録結果を確認できませんでした。入力内容とファイルの選択を保持しています。登録済みの内容を確認してから再試行してください。";
      setError(message); toast(operationFailureToast(message));
    } finally { inFlight.current = false; setPending(false); }
  }
  return <UploadPending.Provider value={pending}><form action="/api/uploads/received-invoices" method="post" encType="multipart/form-data" className="space-y-4" onSubmit={submit}>
    {company === "JAPAN" ? <fieldset disabled={pending} className="min-w-0 space-y-4">{children}</fieldset> : children}
    {company === "JAPAN" ? <OperationError message={error} /> : null}
  </form></UploadPending.Provider>;
}

export function ReceivedInvoiceCreateSubmit() {
  const pending = useContext(UploadPending);
  return <Button className="w-full" type="submit" disabled={pending}><OperationPending pending={pending}>登録</OperationPending></Button>;
}
