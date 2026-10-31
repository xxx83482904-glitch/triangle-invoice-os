"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Layers, Link2Off, LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { debtRoles, type DebtGroupView } from "@/lib/debt-groups";
import type { CompanyScope } from "@/lib/company";
import type { DebtRole } from "@/lib/types";
import { formatDate, yen } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { assignDebtGroupAction, removeFromDebtGroupAction, updateDebtRoleAction } from "./debt-group-actions";

const selectClass = "h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const roleOptions = Object.entries(debtRoles) as Array<[DebtRole, string]>;

// 請求書 → 再請求 → 督促 → 領収書 of one debt are bundled here. Only the latest payable document is paid or reconciled.
export function DebtGroupPanel({ company, invoice, canManage }: { company: CompanyScope; invoice: { id: string; updatedAt: string; issueDate: string; total: number; debt: DebtGroupView }; canManage: boolean }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [role, setRole] = useState<DebtRole>(invoice.debt.role);
  const [current, setCurrent] = useState(invoice.debt.statementCurrentAmount?.toString() ?? "");
  const [carried, setCarried] = useState(invoice.debt.statementCarriedOver?.toString() ?? "");
  const [picked, setPicked] = useState<Record<string, DebtRole | undefined>>({});
  const run = (work: () => Promise<{ success: boolean; error?: string }>, done: string) => startTransition(async () => {
    setError("");
    try { const result = await work(); if (!result.success) { setError(result.error || "保存できませんでした"); return; } toast({ title: done, variant: "success" }); router.refresh(); }
    catch { setError("保存結果を確認できません。画面を更新してください"); }
  });
  const { debt } = invoice;
  const selected = Object.entries(picked).filter(([, value]) => value).map(([id]) => id);
  return <section className="space-y-3 rounded-lg border p-4" aria-label="債務グループ">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><Layers className="size-4" />債務グループ{debt.groupId ? `（${debt.members.length}枚）` : ""}</h3>{debt.groupId ? <span className={`rounded-full border px-2 py-0.5 text-xs ${debt.payable ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"}`}>{debt.payable ? "この書類が支払対象" : "支払対象外（最新の請求書で支払う）"}</span> : null}</div>
    <p className="text-xs text-muted-foreground">請求書・再請求・督促・領収書を1つの債務として束ねます。支払対象は役割が領収書以外で発行日が最新の1枚だけで、ほかの書類は未払い・照合・支払記録の対象から外れます。合計請求書は今回御買上額と繰越を分けて記録し、差引支払額は今回御買上額に合わせてください。</p>
    {debt.groupId ? <ul className="divide-y rounded-md border text-sm">{debt.members.map((member) => <li key={member.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${member.id === invoice.id ? "bg-muted/40" : ""}`}>
      <span className="min-w-0 break-words">{formatDate(member.issueDate)} / {member.roleLabel} / {member.fileName}{member.id === invoice.id ? "（この書類）" : ""}</span>
      <span className="flex items-center gap-2 text-xs"><span className="font-mono">{yen.format(member.total)}</span>{member.payable ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">支払対象</span> : null}{member.role === "STATEMENT" && member.statementCurrentAmount !== undefined ? <span className="text-muted-foreground">今回 {yen.format(member.statementCurrentAmount)} / 繰越 {yen.format(member.statementCarriedOver || 0)}</span> : null}</span>
    </li>)}</ul> : null}
    {canManage && debt.groupId ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
      <label className="grid min-w-0 gap-1 text-xs">この書類の役割<select className={selectClass} value={role} disabled={pending} onChange={(e) => setRole(e.target.value as DebtRole)}>{roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button className="h-11" variant="outline" disabled={pending} onClick={() => run(() => updateDebtRoleAction(company, { invoiceId: invoice.id, expectedUpdatedAt: invoice.updatedAt, role, statementCurrentAmount: role === "STATEMENT" && current ? Number(current) : undefined, statementCarriedOver: role === "STATEMENT" && carried ? Number(carried) : undefined }), "役割を保存しました")}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}役割を保存</Button>
      <Button className="h-11" variant="ghost" disabled={pending} onClick={() => run(() => removeFromDebtGroupAction(company, { invoiceId: invoice.id, expectedUpdatedAt: invoice.updatedAt }), "グループから外しました")}><Link2Off className="size-4" />グループから外す</Button>
      {role === "STATEMENT" ? <div className="grid gap-2 sm:col-span-3 sm:grid-cols-2"><label className="grid gap-1 text-xs">今回御買上額<Input className="h-11" type="number" min="0" step="1" value={current} disabled={pending} onChange={(e) => setCurrent(e.target.value)} /></label><label className="grid gap-1 text-xs">繰越（前回請求残）<Input className="h-11" type="number" min="0" step="1" value={carried} disabled={pending} onChange={(e) => setCarried(e.target.value)} /></label>{current && Number(current) !== invoice.total ? <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">差引支払額 {yen.format(invoice.total)} が今回御買上額と違います。金額の編集で差引支払額を今回御買上額に合わせてください。</p> : null}</div> : null}
    </div> : null}
    {canManage && debt.candidates.length ? <div className="space-y-2">
      <p className="text-xs font-medium">{debt.groupId ? "グループに追加できる候補" : "同じ債務かもしれない書類（同じ支払先・半年以内）"}</p>
      <ul className="divide-y rounded-md border text-sm">{debt.candidates.map((candidate) => <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <label className="flex min-w-0 items-center gap-2"><input type="checkbox" className="size-4" checked={Boolean(picked[candidate.id])} disabled={pending} onChange={(e) => setPicked((state) => ({ ...state, [candidate.id]: e.target.checked ? state[candidate.id] || "REISSUE" : undefined }))} /><span className="min-w-0 break-words">{formatDate(candidate.issueDate)} / {candidate.fileName} / <span className="font-mono">{yen.format(candidate.total)}</span><span className="block text-xs text-muted-foreground">{candidate.reasons.join(" / ")}</span></span></label>
        {picked[candidate.id] ? <select className="h-9 rounded-md border border-input bg-background px-2 text-xs" aria-label="追加する書類の役割" value={picked[candidate.id]} disabled={pending} onChange={(e) => setPicked((state) => ({ ...state, [candidate.id]: e.target.value as DebtRole }))}>{roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : null}
      </li>)}</ul>
      <div className="flex flex-wrap items-end gap-2">{!debt.groupId ? <label className="grid min-w-0 flex-1 gap-1 text-xs">この書類の役割<select className={selectClass} value={role} disabled={pending} onChange={(e) => setRole(e.target.value as DebtRole)}>{roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
        <Button className="h-11" disabled={pending || !selected.length} onClick={() => run(() => assignDebtGroupAction(company, { invoiceIds: [invoice.id, ...selected], roles: { [invoice.id]: role, ...Object.fromEntries(selected.map((id) => [id, picked[id]!])) }, groupId: debt.groupId }), `${selected.length + (debt.groupId ? 0 : 1)}枚を束ねました`)}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Layers className="size-4" />}{debt.groupId ? "選んだ書類を追加" : "選んだ書類と束ねる"} ({selected.length})</Button></div>
    </div> : null}
    {!debt.groupId && !debt.candidates.length ? <p className="text-xs text-muted-foreground">束ねる候補はありません（同じ支払先で半年以内、同じ金額か再請求・督促・領収の語を含む書類を探しています）。</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
  </section>;
}
