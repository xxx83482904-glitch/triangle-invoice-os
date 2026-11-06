"use client";

import { useRef, useState, useTransition, type RefObject } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { DetailOption } from "@/lib/import-detail-draft";
import { defaultRereadKeys, formatRereadValue, importConflictMessage, rereadSourceLabels, rereadSuccessMessage } from "@/lib/import-reread";
import type { ImportRereadChange } from "@/lib/import-shipment-views";
import { operationFailureToast } from "@/lib/operation-feedback";
import { saveImportShipmentAction, type previewImportRereadAction } from "../actions";

export type RereadPreview = Extract<Awaited<ReturnType<typeof previewImportRereadAction>>, { success: true }>;

function SourceBadge({ source }: { source: ImportRereadChange["source"] }) {
  if (source === "EMPTY") return null;
  return <Badge variant="outline" className={`border-transparent text-[10px] font-normal ${source === "DOCUMENT" ? "bg-[var(--tone-blue-bg)] text-[var(--tone-blue-fg)]" : "bg-[var(--tile)] text-muted-foreground"}`}>{rereadSourceLabels[source]}</Badge>;
}

export function RereadDialog({ company, id, preview, vendors, triggerRef, onClose, onSaved, onReload, onRunningChange }: {
  company: CompanyScope; id: string; preview: RereadPreview; vendors: DetailOption[]; triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void; onSaved: (version: string) => void; onReload: () => void; onRunningChange: (running: boolean) => void;
}) {
  const inFlight = useRef(false);
  const [keys, setKeys] = useState(() => defaultRereadKeys(preview.changes));
  const [pending, start] = useTransition(), [error, setError] = useState("");
  const conflict = error.includes("輸入便が更新されています");
  const run = () => {
    if (inFlight.current || !keys.length) return;
    inFlight.current = true; onRunningChange(true); setError("");
    start(async () => {
      try {
        const result = await saveImportShipmentAction(company, { action: "reread", id, version: preview.version, keys });
        if (!result.success) throw new Error(result.error);
        if (result.action !== "reread") throw new Error("読み直しの結果を確認できませんでした。");
        toast({ title: rereadSuccessMessage(result.changed), variant: "success" });
        onClose(); onSaved(result.updatedAt);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "通信に失敗しました。もう一度お試しください。");
        toast(operationFailureToast(failure));
      } finally { inFlight.current = false; onRunningChange(false); }
    });
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
      <DialogHeader>
        <DialogTitle>書類から読み直す</DialogTitle>
        <DialogDescription className="pr-3 text-xs leading-relaxed">保存済みの読み取り結果（OCR）から、番号・日付・金額を読み直します。次の{preview.changes.length}項目が変わります。</DialogDescription>
      </DialogHeader>
      <div role="region" aria-label="書類から読み直す項目" tabIndex={0} className="min-w-0 overflow-x-auto rounded-xl border border-[var(--rule)] focus-visible:outline-2 focus-visible:outline-ring">
        <table className="w-full min-w-[440px] text-left text-xs">
          <thead className="bg-[var(--track)] text-muted-foreground"><tr><th scope="col" className="w-10 p-3 font-normal"><span className="sr-only">置き換える</span></th><th scope="col" className="p-3 font-normal">項目</th><th scope="col" className="p-3 font-normal">今の値</th><th scope="col" className="p-3 font-normal">書類の値</th></tr></thead>
          <tbody className="divide-y divide-[var(--rule)]">
            {preview.changes.map((change) => <tr key={change.key}>
              <td className="p-3 align-top"><input id={`reread-${change.key}`} type="checkbox" className="size-4 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-ring" disabled={pending} checked={keys.includes(change.key)}
                onChange={(event) => setKeys(event.target.checked ? [...keys, change.key] : keys.filter((key) => key !== change.key))} /></td>
              <th scope="row" className="max-w-40 p-3 align-top font-medium"><label htmlFor={`reread-${change.key}`} className="cursor-pointer">{change.label}<span className="sr-only">を書類の値に置き換える</span></label></th>
              <td className="max-w-44 p-3 align-top"><div className="flex flex-wrap items-center gap-1.5"><span className={`break-words [overflow-wrap:anywhere] ${typeof change.before === "number" ? "font-mono" : ""}`}>{formatRereadValue(change.key, change.before, vendors)}</span><SourceBadge source={change.source} /></div></td>
              <td className="max-w-52 p-3 align-top"><span className={`break-words [overflow-wrap:anywhere] ${typeof change.after === "number" ? "font-mono" : ""}`}>{formatRereadValue(change.key, change.after, vendors)}</span><p className="mt-1 break-words text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{change.document.displayName}から</p></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">手入力した値は、チェックを入れた項目だけ置き換えます。実行後は画面右上の「取り消し」で戻せます。</p>
      {error ? <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-xs"><p className="break-words text-destructive">{error}</p>
        {conflict ? <><p className="text-muted-foreground">{importConflictMessage}</p><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => { onClose(); onReload(); }}><RefreshCw />最新を読み込む</Button></> : null}</div> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>やめる</Button>
        <Button type="button" disabled={pending || !keys.length || conflict} onClick={run}>{pending ? "読み直し中…" : `${keys.length}項目を読み直す`}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
