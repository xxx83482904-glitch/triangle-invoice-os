"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Link2Off, LoaderCircle } from "lucide-react";
import { linkMailDocumentAction, unlinkMailDocumentAction } from "./link-actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";

type Option = { label: string; value: string };
const selectClass = "h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

// Re-links a mail document to an existing received invoice. Candidates come first; every live invoice stays selectable.
export function MailRelinkForm({ company, mailDocumentId, mailUpdatedAt, candidates, targets, broken, brokenTargetId, disabled = false }: {
  company: CompanyScope; mailDocumentId: string; mailUpdatedAt?: string; candidates: Option[]; targets: Option[]; broken?: boolean; brokenTargetId?: string; disabled?: boolean;
}) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [value, setValue] = useState(candidates[0]?.value || ""), [error, setError] = useState("");
  const candidateIds = new Set(candidates.map((row) => row.value));
  function link() {
    if (!value) { setError("再連携する受領請求書を選択してください"); return; }
    setError("");
    startTransition(async () => {
      try {
        const result = await linkMailDocumentAction(company, { mailDocumentId, receivedInvoiceId: value, mailUpdatedAt });
        if (!result.success) { setError(result.error); return; }
        toast({ title: "既存の受領請求書へ再連携しました", variant: "success" }); router.refresh();
      } catch { setError("結果を確認できませんでした。画面を更新してください。"); }
    });
  }
  return <div className="space-y-2 rounded-lg border bg-muted/20 p-3" onClick={(event) => event.stopPropagation()}>
    <div className="text-sm font-medium">既存の受領請求書へ再連携</div>
    <p className="text-xs text-muted-foreground">{broken ? `以前に反映した受領請求書（${brokenTargetId || "不明"}）は削除されています。上で作り直すか、ここで既存の書類へ再連携してください。` : "すでに登録済みの受領請求書がある場合は、作り直さずにその書類へ連携します。"}</p>
    <select aria-label="再連携する受領請求書" className={selectClass} value={value} disabled={disabled || pending || !targets.length} onChange={(event) => setValue(event.target.value)}>
      <option value="">受領請求書を選択</option>
      {candidates.length ? <optgroup label="候補">{candidates.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</optgroup> : null}
      <optgroup label="すべての受領請求書">{targets.filter((row) => !candidateIds.has(row.value)).map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</optgroup>
    </select>
    {error ? <p role="alert" className="break-words text-xs text-destructive">{error}</p> : null}
    <Button type="button" size="sm" variant="outline" disabled={disabled || pending || !value} onClick={link}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Link2 className="size-4" />}この受領請求書へ連携</Button>
  </div>;
}

export function MailUnlinkButton({ company, mailDocumentId, mailUpdatedAt, disabled = false }: { company: CompanyScope; mailDocumentId: string; mailUpdatedAt?: string; disabled?: boolean }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false), [error, setError] = useState("");
  function unlink() {
    setError("");
    startTransition(async () => {
      try {
        const result = await unlinkMailDocumentAction(company, { mailDocumentId, mailUpdatedAt });
        if (!result.success) { setError(result.error); return; }
        setConfirm(false); toast({ title: "受領請求書との連携を解除しました", variant: "success" }); router.refresh();
      } catch { setError("結果を確認できませんでした。画面を更新してください。"); }
    });
  }
  return <div className="space-y-1" onClick={(event) => event.stopPropagation()}>
    {confirm
      ? <div className="flex flex-wrap items-center gap-2 text-xs"><span>受領請求書との連携を解除して未連携に戻します。受領請求書自体は削除しません。</span><Button type="button" size="sm" variant="destructive" disabled={pending} onClick={unlink}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Link2Off className="size-4" />}解除する</Button><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(false)}>キャンセル</Button></div>
      : <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" disabled={disabled || pending} onClick={() => setConfirm(true)}><Link2Off className="size-4" />連携を解除（未連携に戻す）</Button>}
    {error ? <p role="alert" className="break-words text-xs text-destructive">{error}</p> : null}
  </div>;
}
