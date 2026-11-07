"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Files, FileCheck, FileText, Package, Plus, ReceiptText, Ship } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CompanyScope } from "@/lib/company";
import type { ImportBoardDocument } from "@/lib/import-shipment-views";
import { AttachForm } from "../attach-form";
import { ImportDropzone } from "../import-dropzone";

export const documentTabs = [
  { kind: "SUPPLIER_INVOICE", label: "商品の請求書", formal: "Invoice", icon: FileText },
  { kind: "PACKING_LIST", label: "梱包明細", formal: "Packing List", icon: Package },
  { kind: "WAYBILL", label: "輸送書類", formal: "B/L・AWB", icon: Ship },
  { kind: "IMPORT_PERMIT", label: "輸入許可書", formal: "輸入許可通知書", icon: FileCheck },
  { kind: "BROKER_INVOICE", label: "通関会社の請求書", formal: "通関業者の請求書", icon: ReceiptText },
  { kind: "OTHER", label: "その他", formal: "納付書など", icon: Files },
] as const;
export type DocumentTab = (typeof documentTabs)[number]["kind"];
export function tabDocuments(documents: ImportBoardDocument[], kind: DocumentTab) {
  return documents.filter((document) => kind === "OTHER" ? document.kind === "OTHER" || document.kind === "TAX_PAYMENT" : document.kind === kind);
}

export function DocumentTabs({ documents, selected, onChange, canEdit, pending, onAdd, className }: {
  documents: ImportBoardDocument[]; selected: DocumentTab; onChange: (kind: DocumentTab) => void;
  canEdit: boolean; pending: boolean; onAdd: () => void; className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reveal = () => refs.current[documentTabs.findIndex((tab) => tab.kind === selected)]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    reveal();
    const observer = new ResizeObserver(reveal);
    if (listRef.current) observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [selected, className]);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? documentTabs.length - 1
      : event.key === "ArrowRight" ? (index + 1) % documentTabs.length : event.key === "ArrowLeft" ? (index + documentTabs.length - 1) % documentTabs.length : undefined;
    if (next === undefined) return;
    event.preventDefault(); onChange(documentTabs[next].kind); refs.current[next]?.focus();
    refs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return <div className={`min-w-0 items-center gap-2 rounded-2xl bg-[var(--track)] p-1 ${className ?? "flex"}`}>
    <div ref={listRef} role="tablist" aria-label="書類の種類" className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {documentTabs.map(({ kind, label, formal, icon: Icon }, index) => {
        const count = tabDocuments(documents, kind).length;
        return <button key={kind} ref={(element) => { refs.current[index] = element; }} id={`document-tab-${kind}`} type="button" role="tab" aria-selected={selected === kind}
          aria-controls={`document-panel-${kind}`} tabIndex={selected === kind ? 0 : -1} onKeyDown={(event) => move(event, index)} onClick={() => onChange(kind)}
          className={`flex shrink-0 items-center gap-2 rounded-xl border-b-2 px-3 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring lg:flex-1 lg:flex-wrap xl:flex-nowrap ${selected === kind
            ? "border-primary bg-[var(--selected)] shadow-[var(--shadow-soft)]" : "border-transparent hover:bg-[var(--tile)]"}`}>
          <Icon aria-hidden className="size-4 shrink-0" />
          <span><span className="block whitespace-nowrap text-xs font-medium">{label}</span><span className="hidden text-[10px] text-muted-foreground lg:block">{formal}</span></span>
          {count ? <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">{count}件</span> : <Badge variant="outline" className="ml-auto border-transparent bg-[var(--tone-amber-bg)] text-[10px] font-normal text-[var(--tone-amber-fg)]">未添付</Badge>}
        </button>;
      })}
    </div>
    {canEdit ? <Button type="button" variant="outline" size="sm" className="hidden shrink-0 lg:inline-flex" disabled={pending} onClick={onAdd}><Plus />書類を追加</Button> : null}
  </div>;
}

export function AddDocumentsDialog({ open, onOpenChange, company, shipmentId, unassigned }: {
  open: boolean; onOpenChange: (open: boolean) => void; company: CompanyScope; shipmentId: string; unassigned: ImportBoardDocument[];
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>書類を追加</DialogTitle><DialogDescription>この便にファイルや未割当の書類を追加します。</DialogDescription></DialogHeader>
      <ImportDropzone company={company} shipmentId={shipmentId} compact />
      <section className="min-w-0 space-y-2" aria-label="未割当の書類から選ぶ"><h3 className="text-sm font-medium">未割当の書類から選ぶ</h3><AttachForm company={company} shipmentId={shipmentId} candidates={unassigned} /></section>
    </DialogContent>
  </Dialog>;
}
