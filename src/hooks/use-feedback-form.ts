"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import { operationErrorMessage, operationFailureToast } from "@/lib/operation-feedback";

type Result = { ok: true } | { ok: false; error: string };
export function useFeedbackForm(company: CompanyScope, action: (form: FormData) => Promise<Result>, success: string, onBusy?: (value: boolean) => void) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ formId: string; message: string; error: boolean }>();
  const inFlight = useRef(false);
  const [activeFormId, setActiveFormId] = useState("");
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (company !== "JAPAN") return;
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget), formId = event.currentTarget.id;
    setActiveFormId(formId);
    inFlight.current = true; setFeedback(undefined); onBusy?.(true);
    startTransition(async () => {
      try {
        const result = await action(form);
        const message = result.ok ? success : operationErrorMessage(result.error);
        setFeedback({ formId, message, error: !result.ok });
        toast(result.ok ? { title: message, variant: "success" } : operationFailureToast(message));
      } catch (error) {
        // Redirects (including authentication) still belong to Next.js.
        unstable_rethrow(error);
        const message = operationErrorMessage(undefined);
        setFeedback({ formId, message, error: true }); toast(operationFailureToast(message));
      } finally { inFlight.current = false; onBusy?.(false); }
    });
  }
  // Manual onSubmit avoids React's successful-action reset of uncontrolled fields after a validation error.
  return { pending, pendingFormId: pending ? activeFormId : undefined, feedback, onSubmit };
}
