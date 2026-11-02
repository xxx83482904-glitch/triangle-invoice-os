"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// The opened item stays in view: beside the list on a wide screen, and over it everywhere else.
export function RecordDetail({ wide, open, title, label, resetKey, className = "", onClose, onPrevious, onNext, children }: {
  wide: boolean; open: boolean; title: ReactNode; label: string; resetKey?: string | null; className?: string;
  onClose: () => void; onPrevious?: () => void; onNext?: () => void; children: ReactNode;
}) {
  const pane = useRef<HTMLElement>(null);
  useEffect(() => { if (pane.current) pane.current.scrollTop = 0; }, [resetKey]);
  if (wide) return <aside ref={pane} aria-label={label} className={`record-detail-pane ${className}`}>{children}</aside>;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} className="record-detail-dialog" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (document.activeElement?.matches("input, textarea, select")) event.preventDefault(); }}>
      <div className="record-detail-bar">
        <Button type="button" variant="ghost" size="icon" aria-label="一覧に戻る" title="一覧に戻る" onClick={onClose}><ArrowLeft className="size-5" /></Button>
        <DialogTitle className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</DialogTitle>
        <Button type="button" variant="outline" size="icon" aria-label="前の項目" title="前の項目" disabled={!onPrevious} onClick={onPrevious}><ChevronUp className="size-4" /></Button>
        <Button type="button" variant="outline" size="icon" aria-label="次の項目" title="次の項目" disabled={!onNext} onClick={onNext}><ChevronDown className="size-4" /></Button>
      </div>
      <div key={resetKey} className="record-detail-body">{children}</div>
    </DialogContent>
  </Dialog>;
}
