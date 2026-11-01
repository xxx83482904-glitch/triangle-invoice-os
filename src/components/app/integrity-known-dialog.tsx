"use client";
import { useOperationError } from "@/hooks/use-operation-error";
import { OperationPending } from "@/components/app/operation-feedback";
import { toast } from "@/hooks/use-toast";
import { useState, useTransition } from "react";
import { acknowledgeIntegrityAction, revokeIntegrityAcknowledgementAction } from "@/app/banking/integrity/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CompanyScope } from "@/lib/company";
import type { IntegrityKind, IntegrityKnown, IntegrityReference } from "@/lib/integrity-types";

export type IntegrityKnownSelection = { title: string } & ({ mode: "ISSUE" | "KIND"; kind: IntegrityKind; targets: IntegrityReference[] } | { mode: "REVOKE"; known: IntegrityKnown });
export function IntegrityKnownDialog({ company, selection, onClose, onSaved }: { company: CompanyScope; selection: IntegrityKnownSelection; onClose: () => void; onSaved: (message: string) => void }) {
  const [reason, setReason] = useState(""), [error, setError] = useOperationError(company), [pending, startTransition] = useTransition();
  const revoke = selection.mode === "REVOKE";
  const save = () => startTransition(async () => {
    setError("");
    try {
      const result = selection.mode === "REVOKE" ? await revokeIntegrityAcknowledgementAction(company, { id: selection.known.id, updatedAt: selection.known.updatedAt, reason })
        : await acknowledgeIntegrityAction(company, { mode: selection.mode, kind: selection.kind, targets: selection.targets, reason });
      if (!result.success) { setError(result.error); return; }
      if (company === "JAPAN") toast({ title: revoke ? "既知を取り消しました" : "既知として保存しました（" + selection.targets.length + "件）", variant: "success" });
      onSaved(revoke ? "既知を取り消しました" : `既知として保存しました（${selection.targets.length}件）`);
    } catch { setError("保存できませんでした。理由を保持しています。通信状況を確認して再度お試しください"); }
  });
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}><DialogContent showCloseButton={!pending} className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>{revoke ? "既知を取り消す" : "既知にする"}</DialogTitle><DialogDescription className="break-words">{selection.title}</DialogDescription></DialogHeader>
    <form className="min-w-0 space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <p className="text-sm">{selection.mode === "REVOKE" ? "この指摘の既知を取り消します。現在も指摘があれば再表示されます。" : `対象は ${selection.targets.length}件です。${selection.mode === "KIND" ? "この種類の全ページ分（最大500件）を登録します。" : ""}後から増えた指摘や根拠の変わった指摘は対象になりません。`}</p>
      <label className="block space-y-1 text-sm"><span>{revoke ? "取り消す理由" : "既知とする理由"}（必須）</span><textarea autoFocus required maxLength={1000} disabled={pending} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 w-full rounded-md border bg-background p-2" /></label>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>閉じる</Button><Button type="submit" disabled={pending || !reason.trim()}><OperationPending pending={company === "JAPAN" && pending}>{pending ? "保存中…" : revoke ? "理由を記録して取り消す" : "理由を付けて既知にする"}</OperationPending></Button></div>
    </form>
  </DialogContent></Dialog>;
}
