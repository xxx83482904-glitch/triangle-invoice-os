"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { ChevronDown, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CompanyScope } from "@/lib/company";
import { formatDate, yen } from "@/lib/format";
import type { ImportBoardDocument, ImportDocumentGroup, ImportShipmentView } from "@/lib/import-shipment-views";
import { importDocumentKindLabels, importDocumentKinds } from "@/lib/import-shipments";
import type { ImportDocumentKind } from "@/lib/types";
import { detailSelectClass as selectClass } from "./[id]/detail-fields";
import { useShipmentSave } from "./use-shipment-save";

const monthLabel = (month: string) => /^\d{4}-\d{2}$/.test(month) ? `${month.slice(0, 4)}年${Number(month.slice(5))}月` : "日付なし";

export function ShipmentCandidates({ company, canEdit, groups, shipments, onCreated }: {
  company: CompanyScope; canEdit: boolean; groups: ImportDocumentGroup[]; shipments: ImportShipmentView[]; onCreated: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  return <Card variant="section" className="min-w-0 gap-3 py-4">
    <CardHeader className="flex flex-wrap items-center gap-3 px-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]"><Inbox aria-hidden className="size-5" /></span>
      <div className="min-w-0 flex-1 basis-48 space-y-1">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">便の候補 <Badge variant="outline" className="border-transparent bg-[var(--tone-amber-bg)] text-[11px] font-normal text-[var(--tone-amber-fg)]">{groups.length}組・{groups.reduce((sum, group) => sum + group.documents.length, 0)}件</Badge></CardTitle>
        <p className="text-xs text-muted-foreground">番号が一致する未割当の書類です。便を作るか、既存の便に追加します。</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="shrink-0" aria-controls={listId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown aria-hidden className={`size-4 transition-transform ${expanded ? "rotate-180" : "-rotate-90"}`} />{expanded ? "候補を閉じる" : "候補を整理する"}</Button>
    </CardHeader>
    <CardContent id={listId} hidden={!expanded} className="space-y-3 px-4">
      <p className="text-xs text-muted-foreground">申告番号・B/L/AWB番号・インボイス番号・荷主名が同じものどうしでまとめています。</p>
      {groups.map((group) => <ShipmentCandidate key={group.key} company={company} canEdit={canEdit} group={group} shipments={shipments} onCreated={onCreated} />)}
    </CardContent>
  </Card>;
}

function ShipmentCandidate({ company, canEdit, group, shipments, onCreated }: {
  company: CompanyScope; canEdit: boolean; group: ImportDocumentGroup; shipments: ImportShipmentView[]; onCreated: (id: string) => void;
}) {
  const { pending, run } = useShipmentSave(company);
  const [title, setTitle] = useState(group.suggestedTitle);
  const [shipmentId, setShipmentId] = useState("");
  const [kinds, setKinds] = useState<Record<string, ImportDocumentKind>>({});
  const kind = (document: ImportBoardDocument) => kinds[document.key] ?? document.suggestedKind ?? document.kind;
  const submit = (targetId: string | null) => {
    const shipmentTitle = targetId ? shipments.find((row) => row.id === targetId)?.title ?? group.shipment?.title ?? "輸入便" : title.trim();
    run({ action: "group", shipmentId: targetId, ...(targetId ? {} : { title }), documents: group.documents.map((document) => ({ source: document.source, documentId: document.id, kind: kind(document) })) },
      (result) => result.action === "group" ? `${result.count}件を『${shipmentTitle}』にまとめました。` : "",
      (result) => { if (result.action === "group" && result.created) onCreated(result.id); });
  };
  return <section aria-label={group.suggestedTitle} className="min-w-0 space-y-3 rounded-lg border bg-background/60 p-3">
    <div className="min-w-0 space-y-1">
      <h3 className="break-words text-sm font-medium">{group.suggestedTitle}</h3>
      <div className="flex flex-wrap gap-x-3 gap-y-1 break-all font-mono text-xs text-muted-foreground">
        {group.declarationNumber ? <span>申告 {group.declarationNumber}</span> : null}
        {group.blNumber ? <span>B/L {group.blNumber}</span> : null}
        {group.invoiceNumber ? <span>INV {group.invoiceNumber}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {group.shipment ? <Badge variant="outline" className="max-w-full whitespace-normal break-all">{group.shipment.title} の書類と一致</Badge> : null}
        {group.weak ? <span>荷主名だけの手掛かりです</span> : null}
        {!group.hasPermit ? <span>許可通知書待ち</span> : null}
      </div>
    </div>
    <ul className="divide-y">
      {group.documents.map((document) => <li key={document.key} className="flex min-w-0 flex-col gap-2 py-2 sm:flex-row sm:items-start sm:gap-3">
        <select aria-label={`${document.displayName}の種類`} value={kind(document)} disabled={pending || !canEdit} className={`${selectClass} w-full sm:w-44 sm:shrink-0`}
          onChange={(event) => setKinds({ ...kinds, [document.key]: event.target.value as ImportDocumentKind })}>
          {importDocumentKinds.map((value) => <option key={value} value={value}>{importDocumentKindLabels[value]}</option>)}
        </select>
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          <Link href={document.href} prefetch={false} title={document.title} className="block break-all text-sm font-medium text-foreground hover:underline underline-offset-4">{document.displayName}</Link>
          {document.title !== document.displayName ? <p className="break-all">保存名: {document.title}</p> : null}
          <p className="break-words">{document.party} / {formatDate(document.date)}{document.amount !== undefined ? ` / ${yen.format(document.amount)}` : ""}</p>
        </div>
      </li>)}
    </ul>
    {canEdit ? <div className="flex min-w-0 flex-col gap-3 border-t pt-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        {group.shipment ? <Button type="button" size="sm" className="h-auto max-w-full whitespace-normal break-all py-2" disabled={pending} onClick={() => submit(group.shipment!.id)}>{group.shipment.title} に追加</Button>
          : <><Input aria-label="便名" value={title} maxLength={200} disabled={pending} className="min-w-0 sm:max-w-lg" onChange={(event) => setTitle(event.target.value)} />
            <Button type="button" size="sm" className="shrink-0" disabled={pending || !title.trim()} onClick={() => submit(null)}>この組で便を作る</Button></>}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <select aria-label="別の便に追加" value={shipmentId} disabled={pending || !shipments.length} className={`${selectClass} min-w-0 flex-1 sm:max-w-lg`} onChange={(event) => setShipmentId(event.target.value)}>
          <option value="">別の便に追加</option>
          {shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.title}（{monthLabel(shipment.month)}）</option>)}
        </select>
        <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={pending || !shipmentId} onClick={() => submit(shipmentId)}>追加</Button>
      </div>
    </div> : null}
  </section>;
}
