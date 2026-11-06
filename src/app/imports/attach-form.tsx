"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CompanyScope } from "@/lib/company";
import type { ImportBoardDocument } from "@/lib/import-shipment-views";
import { importDocumentKinds, importDocumentKindLabels } from "@/lib/import-shipments";
import type { ImportDocumentKind } from "@/lib/types";
import { useShipmentSave } from "./use-shipment-save";

const selectClass = "h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";

export function AttachForm({ company, shipmentId, candidates }: { company: CompanyScope; shipmentId: string; candidates: ImportBoardDocument[] }) {
  const { pending, run } = useShipmentSave(company);
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<ImportDocumentKind | "">("");
  const chosen = candidates.find((document) => document.key === key) ?? candidates[0];
  if (!chosen) return <p className="text-xs text-muted-foreground">追加できる未割当の書類はありません。郵便仕分けで分類を「輸入・通関」にするか、受領請求書を登録すると候補に出ます。</p>;
  const effectiveKind = kind || chosen.suggestedKind || chosen.kind;
  return <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
    <label className="min-w-0 flex-1 basis-48 space-y-1">
      <span className="text-xs font-medium text-muted-foreground">書類を追加</span>
      <select value={chosen.key} className={`${selectClass} w-full`} onChange={(event) => { setKey(event.target.value); setKind(""); }}>
        {candidates.map((document) => <option key={document.key} value={document.key}>{document.displayName} / {document.party}</option>)}
      </select>
    </label>
    <label className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">種類</span>
      <select value={effectiveKind} className={`${selectClass} w-full`} onChange={(event) => setKind(event.target.value as ImportDocumentKind)}>
        {importDocumentKinds.map((value) => <option key={value} value={value}>{importDocumentKindLabels[value]}</option>)}
      </select>
    </label>
    <Button type="button" size="sm" disabled={pending} onClick={() => run({ action: "assign", shipmentId, source: chosen.source, documentId: chosen.id, kind: effectiveKind }, "輸入便に追加しました。")}>追加</Button>
  </div>;
}
