"use client";
import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveImportShipmentAction } from "./actions";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { ImportShipmentMutation } from "@/lib/import-shipment-views";
import { importFillLabels } from "@/lib/import-shipments";
import { operationFailureToast } from "@/lib/operation-feedback";

export function useShipmentSave(company: CompanyScope) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const inFlight = useRef(false);
  type Result = Extract<Awaited<ReturnType<typeof saveImportShipmentAction>>, { success: true }>;
  const run = (input: ImportShipmentMutation, done: string | ((result: Result) => string), after?: (result: Result) => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    start(async () => {
      try {
        const result = await saveImportShipmentAction(company, input);
        if (!result.success) { toast(operationFailureToast(result.error)); return; }
        const read = (result.action === "assign" || result.action === "group") && result.filled.length ? `${result.filled.map((key) => importFillLabels[key]).join("・")}を読み取りました。` : "";
        const title = result.action === "reread" ? result.changed.length
          ? `${result.changed.map(({ key }) => importFillLabels[key]).join("・")}を書き直しました。元の値は画面右上の取り消しで戻せます。`
          : "書類から読み直せる項目はありませんでした。" : `${typeof done === "function" ? done(result) : done}${read}`;
        toast({ title, variant: "success" });
        after?.(result);
        router.refresh();
      } catch (error) { toast(operationFailureToast(error)); }
      finally { inFlight.current = false; }
    });
  };
  return { pending, run };
}
