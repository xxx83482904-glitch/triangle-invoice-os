"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEstimateStatusAction } from "@/app/estimates/actions";
import { estimateStatusLabels } from "@/lib/estimate-values";
import type { CompanyScope } from "@/lib/company";
import type { Estimate } from "@/lib/types";
import { toast } from "@/hooks/use-toast";

export function EstimateStatusSelect({ id, updatedAt, status, label, company, disabled, onSaved }: {
  id: string; updatedAt: string; status: Estimate["status"]; label: string; company: CompanyScope;
  disabled?: boolean; onSaved?: (estimate: Estimate) => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <select aria-label={`${label}のステータス`} aria-busy={pending} disabled={disabled || pending || status === "CONVERTED"} value={status}
    className={`h-11 w-full min-w-0 max-w-full rounded-md border px-2 text-xs ${status === "SENT" ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200" : ["ACCEPTED", "CONVERTED"].includes(status) ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "border-input bg-background"}`}
    onChange={(event) => {
      const next = event.target.value as Exclude<Estimate["status"], "CONVERTED">;
      startTransition(async () => {
        try {
          const result = await updateEstimateStatusAction(company, { id, updatedAt, status: next });
          if (!result.estimate) { toast({ title: result.error || "状態を変更できませんでした", variant: "destructive" }); return; }
          onSaved?.(result.estimate); router.refresh(); toast({ title: `${estimateStatusLabels[next]}に変更しました`, variant: "success" });
        } catch { toast({ title: "通信に失敗しました。再読み込みして状態を確認してください", variant: "destructive" }); }
      });
    }}>{Object.entries(estimateStatusLabels).filter(([key]) => key !== "CONVERTED" || status === "CONVERTED").map(([key, value]) => <option className="bg-background text-foreground" key={key} value={key}>{value}</option>)}</select>;
}
