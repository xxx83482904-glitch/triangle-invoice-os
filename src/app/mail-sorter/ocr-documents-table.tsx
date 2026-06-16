"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckSquare, ChevronDown, ChevronRight, Download, ExternalLink, FileText, Folder, GripVertical, HelpCircle, Image as ImageIcon, Maximize2, Minimize2, Pencil, Plus, Save, Square, Trash2, UploadCloud } from "lucide-react";
import { Fragment, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createMailFolder, deleteMailFolder, deleteOcrDocument, deleteOcrDocumentsBulk, moveOcrDocumentToMonth, reflectMailDocumentToReceivedInvoice, saveMailSorterBulkEdits, updateMailDocumentCategory, updateOcrDocumentInline } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { MailDocumentCategory, ReceivedInvoiceStatus } from "@/lib/types";

type Option = {
  label: string;
  value: string;
};

export type OcrDocumentListItem = {
  category: MailDocumentCategory;
  confidence?: number;
  createdAt: string;
  extracted?: {
    dueDate: string;
    issueDate: string;
    projectId?: string;
    projectName: string;
    status?: ReceivedInvoiceStatus;
    subtotal: number;
    taxTotal: number;
    total: number;
    vendorId?: string;
    vendorName: string;
  };
  fileName: string;
  fileUrl?: string;
  folderMonth?: string;
  id: string;
  mailProcessed?: boolean;
  mailDocumentId?: string;
  memo?: string;
  mimeType?: string;
  ocrPreview: string;
  ocrText?: string;
  receivedInvoiceId?: string;
  savedAs: string;
  senderName?: string;
};

type FolderOption = {
  label?: string;
  month: string;
};

type CategoryFilter = "all" | "INVOICE" | "RECEIPT";
type ProcessingFilter = "all" | "unprocessed" | "processed";
type ProcessingStatusValue = "unprocessed" | "processed";
type ViewMode = "folder" | "list";

const categoryLabels: Record<MailDocumentCategory, string> = {
  INVOICE: "請求書",
  CONTRACT: "契約書",
  ESTIMATE: "見積書",
  DELIVERY_NOTE: "納品書",
  RECEIPT: "領収書",
  NOTICE: "通知",
  OTHER: "その他",
};

const categoryOptions: Array<{ label: string; value: MailDocumentCategory }> = [
  { label: "請求書", value: "INVOICE" },
  { label: "契約書", value: "CONTRACT" },
  { label: "見積書", value: "ESTIMATE" },
  { label: "納品書", value: "DELIVERY_NOTE" },
  { label: "領収書", value: "RECEIPT" },
  { label: "通知", value: "NOTICE" },
  { label: "その他", value: "OTHER" },
];

const processingStatusOptions = [
  { label: "未処理", value: "unprocessed" },
  { label: "処理済", value: "processed" },
];

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  year: "numeric",
});

const moneyFormatter = new Intl.NumberFormat("ja-JP", {
  currency: "JPY",
  maximumFractionDigits: 0,
  style: "currency",
});

function formatDate(value?: string) {
  if (!value) return "-";
  return dateFormatter.format(new Date(value));
}

function monthKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthLabel(value: string) {
  return monthFormatter.format(new Date(`${value}-01T00:00:00`));
}

function shortMonthLabel(value: string) {
  const [year, month] = value.split("-");
  return `${year.slice(-2)}/${month}`;
}

function selectClass() {
  return "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
}

function categorySelectClass(category: MailDocumentCategory) {
  const tone =
    category === "INVOICE"
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-secondary text-secondary-foreground";
  return `h-6 max-w-[104px] rounded-full border px-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${tone}`;
}

function processingStatusSelectClass(processed: boolean) {
  const tone = processed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800";
  return `h-6 max-w-[92px] rounded-full border px-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${tone}`;
}

function shippingSenderName(row: OcrDocumentListItem) {
  if (row.senderName?.trim()) return row.senderName.trim();
  if (row.extracted?.vendorName && row.extracted.vendorName !== "支払先未設定") return row.extracted.vendorName;
  const firstLine = row.ocrText?.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 2 && line.length <= 40);
  return firstLine || row.fileName.replace(/\.[^.]+$/, "");
}

function memoField(row: OcrDocumentListItem, label: string) {
  const prefix = `${label}:`;
  return (
    row.memo
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() ?? ""
  );
}

function memoRemainder(row: OcrDocumentListItem) {
  const structuredLabels = new Set(["発送元", "内容", "金額", "振込先", "請求日", "支払期限", "判定"]);
  return (
    row.memo
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        const [label] = line.split(":");
        return !structuredLabels.has(label);
      })
      .slice(0, 2)
      .join(" / ") ?? ""
  );
}

function hasConsistentTaxBreakdown(row: OcrDocumentListItem) {
  const extracted = row.extracted;
  if (!extracted?.total) return false;
  const breakdownTotal = extracted.subtotal + extracted.taxTotal;
  return breakdownTotal > 0 && Math.abs(breakdownTotal - extracted.total) <= Math.max(10, Math.round(extracted.total * 0.05));
}

function summaryLines(row: OcrDocumentListItem) {
  const content = memoField(row, "内容") || row.ocrPreview || "内容確認待ち";
  const amount = memoField(row, "金額") || (row.extracted ? moneyFormatter.format(row.extracted.total) : "");
  const paymentDestination = memoField(row, "振込先") || "記載なし / 未検出";
  const lines = [
    `発送元: ${memoField(row, "発送元") || shippingSenderName(row)}`,
    `内容: ${content}`,
    `金額: ${amount || "未検出"}`,
    `振込先: ${paymentDestination}`,
    `種別: ${categoryLabels[row.category]}`,
    `保存先: ${row.savedAs}`,
  ];
  if (row.extracted) {
    lines.push(`案件: ${row.extracted.projectName}`);
    lines.push(`請求日: ${formatDate(row.extracted.issueDate)}`);
    lines.push(`支払期限: ${formatDate(row.extracted.dueDate)}`);
    if (hasConsistentTaxBreakdown(row)) {
      lines.push(`税抜: ${moneyFormatter.format(row.extracted.subtotal)}`);
      lines.push(`消費税: ${moneyFormatter.format(row.extracted.taxTotal)}`);
    }
    lines.push(`合計: ${moneyFormatter.format(row.extracted.total)}`);
  }
  if (row.confidence) lines.push(`信頼度: ${row.confidence}%`);
  const remainder = memoRemainder(row);
  if (remainder) lines.push(`メモ: ${remainder}`);
  return lines;
}

function isProcessed(row: OcrDocumentListItem) {
  if (typeof row.mailProcessed === "boolean") return row.mailProcessed;
  const s = row.extracted?.status;
  return s === "PAID" || s === "SCHEDULED" || s === "ARCHIVED";
}

function DocumentPreview({ compact = false, row }: { compact?: boolean; row: OcrDocumentListItem }) {
  const frameClass = compact ? "h-[56vh] min-h-[360px]" : "h-[68vh] min-h-96";
  const boxClass = compact ? "min-h-[360px]" : "min-h-80";

  if (!row.fileUrl) {
    return <div className={`flex h-full ${boxClass} items-center justify-center rounded-md bg-muted text-sm text-muted-foreground`}>ファイルがありません。</div>;
  }

  if (row.mimeType?.startsWith("image/")) {
    return (
      <div className={`flex h-full ${boxClass} items-center justify-center overflow-hidden rounded-md bg-muted`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.fileUrl} alt={row.fileName} className="max-h-full w-full object-contain" />
      </div>
    );
  }

  if (row.mimeType === "application/pdf") {
    return (
      <div className="space-y-2">
        {/* スマホ向けフォールバック: iframe は md 以上のみ */}
        <div className="hidden md:block">
          <iframe title={row.fileName} src={row.fileUrl} className={`${frameClass} w-full rounded-md border bg-muted`} />
        </div>
        <div className="flex items-center justify-center rounded-md bg-muted py-10 md:hidden">
          <Button asChild variant="outline">
            <a href={row.fileUrl} target="_blank">PDFを別画面で開く</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full ${boxClass} items-center justify-center rounded-md bg-muted`}>
      <Button asChild variant="outline">
        <a href={row.fileUrl} target="_blank">ファイルを開く</a>
      </Button>
    </div>
  );
}

function stopEditClick(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

type ColumnMode = "compact" | "normal";

type ResizeTarget = "folderMonth" | "folderSender" | "listPreview";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function OcrDocumentsTable({
  canEdit,
  canExport = false,
  company,
  projects,
  rows,
  statusOptions,
  vendors,
  folders,
}: {
  canEdit: boolean;
  canExport?: boolean;
  company: CompanyScope;
  folders: FolderOption[];
  projects: Option[];
  rows: OcrDocumentListItem[];
  statusOptions: Option[];
  vendors: Option[];
}) {
  const router = useRouter();
  const [isMoving, startMoveTransition] = useTransition();
  const folderUploadInputRef = useRef<HTMLInputElement>(null);
  const [draggedIds, setDraggedIds] = useState<Set<string>>(new Set());
  const [dragOverMonth, setDragOverMonth] = useState<string | null>(null);
  const [fileDragMonth, setFileDragMonth] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [processingFilter, setProcessingFilter] = useState<ProcessingFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [uploadTargetMonth, setUploadTargetMonth] = useState<string | null>(null);
  const [uploadingMonth, setUploadingMonth] = useState<string | null>(null);
  const [folderMonthWidth, setFolderMonthWidth] = useState(180);
  const [folderSenderWidth, setFolderSenderWidth] = useState(220);
  const [listPreviewWidth, setListPreviewWidth] = useState(420);
  const [pendingCategories, setPendingCategories] = useState<Partial<Record<string, MailDocumentCategory>>>({});
  const [pendingProcessing, setPendingProcessing] = useState<Partial<Record<string, ProcessingStatusValue>>>({});
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const processing = pendingProcessing[row.id] ?? (isProcessed(row) ? "processed" : "unprocessed");
      const category = pendingCategories[row.id] ?? row.category;
      if (processingFilter !== "all" && processing !== processingFilter) return false;
      if (categoryFilter !== "all" && category !== categoryFilter) return false;
      return true;
    });
  }, [categoryFilter, pendingCategories, pendingProcessing, processingFilter, rows]);
  const groups = useMemo(() => {
    const grouped = new Map<string, OcrDocumentListItem[]>();
    for (const row of filteredRows) {
      const key = row.folderMonth || monthKey(row.createdAt);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    for (const folder of folders) {
      if (!grouped.has(folder.month)) grouped.set(folder.month, []);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredRows, folders]);
  const listGroups = useMemo(() => groups.filter(([, monthRows]) => monthRows.length > 0), [groups]);
  const customFolderMonths = useMemo(() => new Set(folders.map((folder) => folder.month)), [folders]);
  const [activeMonth, setActiveMonth] = useState<string | null>(groups[0]?.[0] ?? null);
  const activeGroup = groups.find(([month]) => month === activeMonth) ?? groups[0];
  const selectedMonth = activeGroup?.[0] ?? null;
  const activeRows = activeGroup?.[1] ?? [];
  const [activeRowId, setActiveRowId] = useState<string | null>(activeRows[0]?.id ?? null);
  const activeRow = activeRows.find((row) => row.id === activeRowId) ?? activeRows[0] ?? null;
  const listPreviewRow = filteredRows.find((row) => row.id === activeRowId) ?? filteredRows[0] ?? null;
  const listPreviewMonth = listPreviewRow ? listPreviewRow.folderMonth || monthKey(listPreviewRow.createdAt) : null;
  const [dialogRow, setDialogRow] = useState<OcrDocumentListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OcrDocumentListItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [monthColumn, setMonthColumn] = useState<ColumnMode>("normal");
  const [senderColumn, setSenderColumn] = useState<ColumnMode>("normal");
  const [showEditor, setShowEditor] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set());
  const [pendingCategoryChange, setPendingCategoryChange] = useState<{ row: OcrDocumentListItem; category: MailDocumentCategory } | null>(null);
  const lastClickedIndexRef = useRef<number | null>(null);
  const bulkDeleteFormRef = useRef<HTMLFormElement>(null);

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.id)), [rows, selectedIds]);
  const selectedActiveCount = activeRows.filter((row) => selectedIds.has(row.id)).length;
  const allActiveSelected = activeRows.length > 0 && selectedActiveCount === activeRows.length;
  const pendingEdits = useMemo(() => {
    return rows
      .map((row) => ({
        category: pendingCategories[row.id],
        mailDocumentId: row.mailDocumentId,
        processingStatus: pendingProcessing[row.id],
        receivedInvoiceId: row.receivedInvoiceId,
      }))
      .filter((edit) => edit.category || edit.processingStatus);
  }, [pendingCategories, pendingProcessing, rows]);
  const pendingEditsJson = JSON.stringify(pendingEdits);
  const exportHref = canExport ? `/api/export/ocr-documents?company=${company}${
    selectedRows.length ? `&ids=${encodeURIComponent(selectedRows.map((row) => row.id).join(","))}` : ""
  }` : "#";

  const chooseMonth = (month: string, monthRows: OcrDocumentListItem[]) => {
    setActiveMonth(month);
    setActiveRowId(monthRows[0]?.id ?? null);
  };

  // #1: Shift+click range selection
  // Keep a stable ref updated via effect so toggleRowSelection doesn't need activeRows as dep
  const activeRowsRef = useRef(activeRows);
  useEffect(() => { activeRowsRef.current = viewMode === "list" ? filteredRows : activeRows; });

  const processingValueForRow = (row: OcrDocumentListItem): ProcessingStatusValue =>
    pendingProcessing[row.id] ?? (isProcessed(row) ? "processed" : "unprocessed");

  const categoryValueForRow = (row: OcrDocumentListItem) => pendingCategories[row.id] ?? row.category;

  const setProcessingDraft = (row: OcrDocumentListItem, processingStatus: ProcessingStatusValue) => {
    const original = isProcessed(row) ? "processed" : "unprocessed";
    setPendingProcessing((current) => {
      const next = { ...current };
      if (processingStatus === original) delete next[row.id];
      else next[row.id] = processingStatus;
      return next;
    });
  };

  const setCategoryDraft = (row: OcrDocumentListItem, category: MailDocumentCategory) => {
    setPendingCategories((current) => {
      const next = { ...current };
      if (category === row.category) delete next[row.id];
      else next[row.id] = category;
      return next;
    });
  };

  const toggleRowSelection = useCallback((row: OcrDocumentListItem, index: number, shiftKey: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (shiftKey && lastClickedIndexRef.current !== null) {
        const from = Math.min(lastClickedIndexRef.current, index);
        const to = Math.max(lastClickedIndexRef.current, index);
        const shouldSelect = !current.has(row.id);
        for (let i = from; i <= to; i++) {
          const r = activeRowsRef.current[i];
          if (r) {
            if (shouldSelect) next.add(r.id);
            else next.delete(r.id);
          }
        }
      } else {
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
      }
      return next;
    });
    lastClickedIndexRef.current = index;
  }, []);

  const toggleActiveMonthSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allActiveSelected) {
        activeRows.forEach((row) => next.delete(row.id));
      } else {
        activeRows.forEach((row) => next.add(row.id));
      }
      return next;
    });
  };

  const openDropzone = () => {
    document.getElementById("mail-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const uploadFilesToMonth = useCallback(async (files: FileList | File[], targetMonth: string) => {
    const selected = Array.from(files);
    if (!canEdit || !selected.length) return;
    setUploadingMonth(targetMonth);
    try {
      const formData = new FormData();
      formData.set("company", company);
      formData.set("targetMonth", targetMonth);
      for (const file of selected) formData.append("files", file);

      const response = await fetch("/api/uploads/mail-sorter", {
        method: "POST",
        body: formData,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "郵便物の収納に失敗しました");
      }

      const results = Array.isArray(body.results) ? body.results : [];
      const errorCount = results.filter((result: { error?: string }) => result.error).length;
      const okCount = Math.max(0, results.length - errorCount);
      setActiveMonth(targetMonth);
      setActiveRowId(null);
      setViewMode("list");
      router.refresh();
      toast({
        title: errorCount ? `${okCount}件収納、${errorCount}件エラー` : `${okCount || selected.length}件を${monthLabel(targetMonth)}へ収納しました`,
        variant: errorCount ? "default" : "success",
      });
    } catch (error) {
      toast({
        title: "収納に失敗しました",
        description: error instanceof Error ? error.message : "郵便物の収納に失敗しました",
        variant: "destructive",
      });
    } finally {
      setUploadingMonth(null);
      setUploadTargetMonth(null);
    }
  }, [canEdit, company, router]);

  const openFolderUpload = (month: string) => {
    if (!canEdit) return;
    setUploadTargetMonth(month);
    folderUploadInputRef.current?.click();
  };

  const isFileDrag = (event: React.DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");

  const startColumnResize = useCallback((event: React.PointerEvent<HTMLElement>, target: ResizeTarget) => {
    event.preventDefault();
    const startX = event.clientX;
    const startMonthWidth = folderMonthWidth;
    const startSenderWidth = folderSenderWidth;
    const startPreviewWidth = listPreviewWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (target === "folderMonth") setFolderMonthWidth(clamp(startMonthWidth + delta, 72, 300));
      if (target === "folderSender") setFolderSenderWidth(clamp(startSenderWidth + delta, 130, 460));
      if (target === "listPreview") setListPreviewWidth(clamp(startPreviewWidth - delta, 320, 720));
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, [folderMonthWidth, folderSenderWidth, listPreviewWidth]);

  // #2: multi-row drag support
  const moveRowsToMonth = (ids: Set<string>, targetMonth: string) => {
    if (!ids.size || !canEdit) return;
    const rowsToMove = rows.filter((r) => ids.has(r.id) && (r.folderMonth || monthKey(r.createdAt)) !== targetMonth);
    if (!rowsToMove.length) return;
    startMoveTransition(async () => {
      const formData = new FormData();
      formData.set("company", company);
      formData.set("targetMonth", targetMonth);
      for (const row of rowsToMove) {
        if (row.mailDocumentId) formData.append("mailDocumentId", row.mailDocumentId);
        if (row.receivedInvoiceId) formData.append("receivedInvoiceId", row.receivedInvoiceId);
      }
      await moveOcrDocumentToMonth(formData);
      setDraggedIds(new Set());
      setDragOverMonth(null);
      router.refresh();
    });
  };

  const handleDragStart = (row: OcrDocumentListItem) => {
    if (!canEdit) return;
    const idsToMove = selectedIds.has(row.id) && selectedIds.size > 1 ? new Set(selectedIds) : new Set([row.id]);
    setDraggedIds(idsToMove);
  };

  const handleDrop = (targetMonth: string) => {
    if (!draggedIds.size) return;
    moveRowsToMonth(draggedIds, targetMonth);
  };

  const toggleCollapsedMonth = (month: string) => {
    setCollapsedMonths((current) => {
      const next = new Set(current);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  };

  const renderProcessingControl = (row: OcrDocumentListItem) => {
    const value = processingValueForRow(row);
    if (!canEdit || (!row.mailDocumentId && !row.receivedInvoiceId)) {
      return <Badge variant="outline" className={processingStatusSelectClass(value === "processed")}>{value === "processed" ? "処理済" : "未処理"}</Badge>;
    }
    return (
      <select
        value={value}
        className={processingStatusSelectClass(value === "processed")}
        aria-label="処理状態"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setProcessingDraft(row, event.currentTarget.value as ProcessingStatusValue)}
      >
        {processingStatusOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  };

  const renderCategoryControl = (row: OcrDocumentListItem) => {
    const value = categoryValueForRow(row);
    if (!canEdit || !row.mailDocumentId) {
      return <Badge variant={value === "INVOICE" ? "default" : "secondary"}>{categoryLabels[value]}</Badge>;
    }
    return (
      <select
        value={value}
        className={categorySelectClass(value)}
        aria-label="分類"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setCategoryDraft(row, event.currentTarget.value as MailDocumentCategory)}
      >
        {categoryOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  };

  const listGridStyle = { "--mail-list-preview-width": `${listPreviewWidth}px` } as CSSProperties;
  const folderGridStyle = {
    "--mail-folder-month-width": `${folderMonthWidth}px`,
    "--mail-folder-sender-width": `${folderSenderWidth}px`,
  } as CSSProperties;

  return (
    <>
      <input
        ref={folderUploadInputRef}
        className="sr-only"
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        multiple
        onChange={(event) => {
          if (event.target.files && uploadTargetMonth) void uploadFilesToMonth(event.target.files, uploadTargetMonth);
          event.target.value = "";
        }}
      />
      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>郵便物フォルダー</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              一覧を中心に月分類・プレビューを確認できます。月見出しへファイルを収納し、境界線ドラッグで幅を調整できます。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={toggleActiveMonthSelection} disabled={!activeRows.length}>
              {allActiveSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allActiveSelected ? "解除" : "表示中を選択"}
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1">
              <a href={exportHref}>
                <Download className="h-3.5 w-3.5" />
                {selectedRows.length ? `${selectedRows.length}件CSV` : "全件CSV"}
              </a>
            </Button>
            {/* #13: Bulk delete modal */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1 text-destructive"
              disabled={!canEdit || !selectedRows.length}
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              選択削除
            </Button>
            <form action={createMailFolder} className="flex items-center gap-2">
              <input type="hidden" name="company" value={company} />
              <Input name="month" type="month" className="h-8 w-32 text-xs" disabled={!canEdit} />
              <Button type="submit" size="sm" variant="outline" className="gap-1" disabled={!canEdit}>
                <Folder className="h-3.5 w-3.5" />
                フォルダー
              </Button>
            </form>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={openDropzone}>
              <Plus className="h-3.5 w-3.5" />
              追加
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => {
                const next = monthColumn === "normal" ? "compact" : "normal";
                setMonthColumn(next);
                setFolderMonthWidth(next === "normal" ? 180 : 84);
              }}
            >
              {monthColumn === "normal" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              月{monthColumn === "normal" ? "小" : "広"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => {
                const next = senderColumn === "normal" ? "compact" : "normal";
                setSenderColumn(next);
                setFolderSenderWidth(next === "normal" ? 220 : 150);
              }}
            >
              {senderColumn === "normal" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              発送元{senderColumn === "normal" ? "小" : "広"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2">
            {(["all", "unprocessed", "processed"] as ProcessingFilter[]).map((filter) => (
              <Button
                key={filter}
                type="button"
                size="sm"
                variant={processingFilter === filter ? "default" : "outline"}
                onClick={() => setProcessingFilter(filter)}
              >
                {filter === "all" ? "全件" : filter === "processed" ? "処理済み" : "未処理"}
              </Button>
            ))}
            {(["all", "INVOICE", "RECEIPT"] as CategoryFilter[]).map((filter) => (
              <Button
                key={filter}
                type="button"
                size="sm"
                variant={categoryFilter === filter ? "default" : "outline"}
                onClick={() => setCategoryFilter(filter)}
              >
                {filter === "all" ? "全分類" : categoryLabels[filter]}
              </Button>
            ))}
            <Button type="button" size="sm" variant={viewMode === "folder" ? "default" : "outline"} onClick={() => setViewMode("folder")}>
              フォルダー
            </Button>
            <Button type="button" size="sm" variant={viewMode === "list" ? "default" : "outline"} onClick={() => setViewMode("list")}>
              一覧
            </Button>
            <form
              action={saveMailSorterBulkEdits}
              className="ml-auto flex items-center gap-2"
              onSubmit={() => {
                setPendingCategories({});
                setPendingProcessing({});
              }}
            >
              <input type="hidden" name="changes" value={pendingEditsJson} readOnly />
              {pendingEdits.length ? <span className="text-xs text-muted-foreground">{pendingEdits.length}件の変更</span> : null}
              <Button type="submit" size="sm" disabled={!pendingEdits.length}>
                すべて保存
              </Button>
            </form>
          </div>
          {groups.length ? (
            viewMode === "list" ? (
              <div
                className="grid min-h-[640px] overflow-hidden rounded-lg border xl:grid-cols-[minmax(0,1fr)_8px_var(--mail-list-preview-width)]"
                style={listGridStyle}
              >
                <div className="min-w-0 overflow-x-auto">
                  {filteredRows.length ? (
                    <table className="w-full min-w-[960px] text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="w-10 px-3 py-2 text-left"></th>
                          <th className="px-3 py-2 text-left">月分類</th>
                          <th className="px-3 py-2 text-left">発送元</th>
                          <th className="px-3 py-2 text-left">処理</th>
                          <th className="px-3 py-2 text-left">分類</th>
                          <th className="px-3 py-2 text-left">請求日</th>
                          <th className="px-3 py-2 text-right">金額</th>
                          <th className="px-3 py-2 text-left">保存先</th>
                          <th className="px-3 py-2 text-left">ファイル</th>
                        </tr>
                      </thead>
                      <tbody>
                        {listGroups.map(([month, monthRows]) => {
                          const isCollapsed = collapsedMonths.has(month);
                          const isDocumentDragOver = dragOverMonth === month;
                          const isFileDragOver = fileDragMonth === month;
                          return (
                          <Fragment key={month}>
                            <tr
                              className={`border-t bg-muted/30 ${isFileDragOver || isDocumentDragOver ? "bg-primary/10" : ""}`}
                              onDragOver={(event) => {
                                if (!canEdit) return;
                                if (isFileDrag(event)) {
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = "copy";
                                  setFileDragMonth(month);
                                  return;
                                }
                                if (!draggedIds.size) return;
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                                setDragOverMonth(month);
                              }}
                              onDragLeave={() => {
                                setFileDragMonth(null);
                                setDragOverMonth(null);
                              }}
                              onDrop={(event) => {
                                if (!canEdit) return;
                                event.preventDefault();
                                setFileDragMonth(null);
                                setDragOverMonth(null);
                                if (event.dataTransfer.files.length) {
                                  void uploadFilesToMonth(event.dataTransfer.files, month);
                                  return;
                                }
                                handleDrop(month);
                              }}
                            >
                              <td colSpan={9} className="px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    className="flex items-center gap-2 text-left text-sm font-medium"
                                    aria-expanded={!isCollapsed}
                                    onClick={() => toggleCollapsedMonth(month)}
                                  >
                                    {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                    <Folder className="h-4 w-4 text-primary" />
                                    <span>{monthLabel(month)}</span>
                                  </button>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">{monthRows.length}件</span>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 gap-1 px-2 text-xs"
                                      disabled={!canEdit || uploadingMonth === month}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openFolderUpload(month);
                                      }}
                                    >
                                      <UploadCloud className="h-3.5 w-3.5" />
                                      {uploadingMonth === month ? "収納中" : "収納"}
                                    </Button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                            {isCollapsed ? null : monthRows.length ? (
                              monthRows.map((row) => {
                                const isSelected = selectedIds.has(row.id);
                                const isActive = row.id === listPreviewRow?.id;
                                const isDragging = draggedIds.has(row.id);
                                const rowIndex = filteredRows.findIndex((candidate) => candidate.id === row.id);
                                return (
                                  <tr
                                    key={row.id}
                                    draggable={canEdit}
                                    className={`cursor-pointer border-t transition hover:bg-muted/50 ${
                                      isActive ? "bg-primary/5" : ""
                                    } ${processingValueForRow(row) === "processed" ? "border-l-2 border-l-green-500" : "border-l-2 border-l-amber-400"} ${
                                      isDragging ? "opacity-50" : ""
                                    }`}
                                    onClick={() => {
                                      setActiveMonth(month);
                                      setActiveRowId(row.id);
                                    }}
                                    onDragStart={(event) => {
                                      handleDragStart(row);
                                      event.dataTransfer.effectAllowed = "move";
                                      event.dataTransfer.setData("text/plain", row.id);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedIds(new Set());
                                      setDragOverMonth(null);
                                    }}
                                  >
                                    <td className="px-3 py-2">
                                      {canEdit ? (
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          className="h-4 w-4 rounded border-muted-foreground/40"
                                          aria-label={`${shippingSenderName(row)}を選択`}
                                          onChange={(event) => event.stopPropagation()}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            toggleRowSelection(row, rowIndex, event.shiftKey);
                                          }}
                                        />
                                      ) : null}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2">{monthLabel(month)}</td>
                                    <td className="max-w-[240px] truncate px-3 py-2 font-medium">{shippingSenderName(row)}</td>
                                    <td className="px-3 py-2">{renderProcessingControl(row)}</td>
                                    <td className="px-3 py-2">{renderCategoryControl(row)}</td>
                                    <td className="whitespace-nowrap px-3 py-2">{row.extracted?.issueDate ? formatDate(row.extracted.issueDate) : formatDate(row.createdAt.slice(0, 10))}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{row.extracted?.total ? moneyFormatter.format(row.extracted.total) : "-"}</td>
                                    <td className="max-w-[160px] truncate px-3 py-2">{row.savedAs}</td>
                                    <td className="px-3 py-2">
                                      {row.fileUrl ? (
                                        <a className="text-sm underline" href={row.fileUrl} target="_blank" onClick={(event) => event.stopPropagation()}>
                                          表示
                                        </a>
                                      ) : (
                                        "-"
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr className="border-t">
                                <td colSpan={9} className="px-3 py-6 text-center text-xs text-muted-foreground">
                                  この月の郵便物はありません。
                                </td>
                              </tr>
                            )}
                          </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-12 text-center text-sm text-muted-foreground">条件に合う郵便物がありません。</div>
                  )}
                </div>

                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="一覧とプレビューの幅を調整"
                  className="hidden cursor-col-resize items-center justify-center border-x bg-muted/40 text-muted-foreground hover:bg-muted xl:flex"
                  onPointerDown={(event) => startColumnResize(event, "listPreview")}
                >
                  <GripVertical className="h-4 w-4" />
                </div>

                <aside className="border-t bg-background p-4 xl:border-t-0 xl:border-l">
                  {listPreviewRow && listPreviewMonth ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-base font-medium">{shippingSenderName(listPreviewRow)}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Folder className="h-3.5 w-3.5" />
                              {monthLabel(listPreviewMonth)}
                            </span>
                            <span>{formatDate(listPreviewRow.createdAt.slice(0, 10))} 作成</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          {renderProcessingControl(listPreviewRow)}
                          {renderCategoryControl(listPreviewRow)}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        <div className="rounded-lg border p-3">
                          <div className="text-xs font-medium text-muted-foreground">月分類</div>
                          <div className="mt-1 text-sm font-medium">{monthLabel(listPreviewMonth)}</div>
                          <div className="mt-2 truncate text-xs text-muted-foreground">{listPreviewRow.savedAs}</div>
                        </div>
                        <div className="rounded-lg border p-3">
                          <div className="text-xs font-medium text-muted-foreground">概要</div>
                          <div className="mt-1 space-y-1 text-sm">
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">請求日</span>
                              <span>{listPreviewRow.extracted?.issueDate ? formatDate(listPreviewRow.extracted.issueDate) : "-"}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">金額</span>
                              <span className="font-mono">{listPreviewRow.extracted?.total ? moneyFormatter.format(listPreviewRow.extracted.total) : "-"}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0 space-y-3 rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ImageIcon className="h-4 w-4" />
                            プレビュー
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={() => setDialogRow(listPreviewRow)}>
                            拡大表示
                          </Button>
                        </div>
                        <DocumentPreview compact row={listPreviewRow} />
                      </div>

                      <div className="space-y-2 rounded-lg border p-3">
                        <div className="text-sm font-medium">OCR本文</div>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                          {listPreviewRow.ocrText || "OCR本文はありません。"}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-80 flex-col items-center justify-center text-sm text-muted-foreground">
                      郵便物を選択するとプレビューを表示します。
                    </div>
                  )}
                </aside>
              </div>
            ) : (
            <div
              className="grid min-h-[640px] overflow-hidden rounded-lg border md:grid-cols-[var(--mail-folder-month-width)_8px_var(--mail-folder-sender-width)_8px_minmax(0,1fr)]"
              style={folderGridStyle}
            >
              {/* #11: Column 1 – Month folders */}
              <aside className="border-b bg-muted/20 p-3 md:border-b-0">
                <div className="mb-3 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-1">
                    {monthColumn === "compact" ? "月" : "月フォルダー"}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3 w-3 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>月フォルダーをクリックして切り替え。ドラッグで書類を移動できます。</TooltipContent>
                    </Tooltip>
                  </span>
                  {isMoving ? <span className="text-primary">移動中…</span> : null}
                </div>
                <div className="space-y-1">
                  {groups.map(([month, monthRows]) => {
                    const isActive = month === selectedMonth;
                    const isDragOver = dragOverMonth === month;
                    const isFileDragOver = fileDragMonth === month;
                    const canDeleteFolder = canEdit && customFolderMonths.has(month) && monthRows.length === 0;
                    return (
                      <div key={month} className="group relative">
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-2.5 pr-16 text-left transition ${
                            isActive ? "bg-background shadow-sm ring-1 ring-primary/30" : "hover:bg-background"
                          } ${isDragOver || isFileDragOver ? "ring-2 ring-primary ring-dashed" : ""}`}
                          onClick={() => chooseMonth(month, monthRows)}
                          onDragOver={(event) => {
                            if (!canEdit) return;
                            if (isFileDrag(event)) {
                              event.preventDefault();
                              setFileDragMonth(month);
                              return;
                            }
                            if (!draggedIds.size) return;
                            event.preventDefault();
                            setDragOverMonth(month);
                          }}
                          onDragLeave={() => {
                            setDragOverMonth(null);
                            setFileDragMonth(null);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (event.dataTransfer.files.length) {
                              setFileDragMonth(null);
                              void uploadFilesToMonth(event.dataTransfer.files, month);
                              return;
                            }
                            handleDrop(month);
                          }}
                        >
                          <Folder className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{monthColumn === "compact" ? shortMonthLabel(month) : monthLabel(month)}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{monthRows.length}件</div>
                          </div>
                        </button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="absolute top-1.5 right-8 h-7 w-7 text-muted-foreground opacity-100 md:opacity-0 md:transition md:group-hover:opacity-100"
                          title={`${monthLabel(month)}へファイルを収納`}
                          disabled={!canEdit || uploadingMonth === month}
                          onClick={() => openFolderUpload(month)}
                        >
                          <UploadCloud className="h-3.5 w-3.5" />
                        </Button>
                        {/* #14: folder delete always visible on group hover, not opacity-0 */}
                        {canDeleteFolder ? (
                          <form action={deleteMailFolder} className="absolute top-1.5 right-1 hidden group-hover:block">
                            <input type="hidden" name="company" value={company} />
                            <input type="hidden" name="month" value={month} />
                            <Button type="submit" size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="このフォルダーを削除">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </aside>

              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="月フォルダー欄の幅を調整"
                className="hidden cursor-col-resize items-center justify-center border-x bg-muted/40 text-muted-foreground hover:bg-muted md:flex"
                onPointerDown={(event) => startColumnResize(event, "folderMonth")}
              >
                <GripVertical className="h-4 w-4" />
              </div>

              {/* #11: Column 2 – Sender list */}
              <aside className="border-b p-3 md:border-b-0">
                <div className="mb-3 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-1">
                    発送元
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3 w-3 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>クリックして詳細表示。チェックで選択、ドラッグで月移動。Shiftクリックで範囲選択。<br />左端の色: オレンジ=未処理、緑=処理済み。</TooltipContent>
                    </Tooltip>
                  </span>
                  {selectedRows.length ? <span className="text-primary">{selectedRows.length}件選択</span> : null}
                </div>
                <div className="space-y-1">
                  {activeRows.map((row, index) => {
                    const isActive = row.id === activeRow?.id;
                    const isSelected = selectedIds.has(row.id);
                    const isDragging = draggedIds.has(row.id);
                    return (
                      <div
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        draggable={canEdit}
                        className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${processingValueForRow(row) === "processed" ? "border-l-2 border-l-green-500" : "border-l-2 border-l-amber-400"} ${
                          isActive ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"
                        } ${isDragging ? "cursor-grabbing opacity-50" : "cursor-grab"}`}
                        onClick={() => setActiveRowId(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveRowId(row.id);
                          }
                        }}
                        onDragStart={(event) => {
                          handleDragStart(row);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", row.id);
                        }}
                        onDragEnd={() => { setDraggedIds(new Set()); setDragOverMonth(null); }}
                      >
                        <div className="flex items-start gap-2">
                          {canEdit ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-muted-foreground/40"
                              aria-label={`${shippingSenderName(row)}を選択`}
                              onChange={(e) => { e.stopPropagation(); }}
                              onClick={(e) => { e.stopPropagation(); toggleRowSelection(row, index, e.shiftKey); }}
                            />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-sm font-medium">{shippingSenderName(row)}</div>
                              {senderColumn === "normal" ? (
                                <div className="flex shrink-0 items-center gap-1">
                                  {renderProcessingControl(row)}
                                  {renderCategoryControl(row)}
                                </div>
                              ) : null}
                            </div>
                            {senderColumn === "normal" ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{formatDate(row.createdAt.slice(0, 10))}</div> : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {activeRows.length === 0 ? (
                    <div className="py-6 text-center text-xs text-muted-foreground">
                      このフォルダーに書類はありません。
                    </div>
                  ) : null}
                </div>
              </aside>

              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="発送元欄の幅を調整"
                className="hidden cursor-col-resize items-center justify-center border-x bg-muted/40 text-muted-foreground hover:bg-muted md:flex"
                onPointerDown={(event) => startColumnResize(event, "folderSender")}
              >
                <GripVertical className="h-4 w-4" />
              </div>

              {/* Column 3 – Detail */}
              <section className="min-w-0 p-4">
                {activeRow ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                      <div className="min-w-0">
                        <div className="text-lg font-medium">{shippingSenderName(activeRow)}</div>
                        <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{activeRow.ocrPreview}</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setDialogRow(activeRow)}>
                          拡大表示
                        </Button>
                        {/* #25: Removed duplicate "変更" button from detail header — only shown in card below */}
                        {activeRow.fileUrl ? (
                          <Button asChild variant="outline" size="sm">
                            <a href={activeRow.fileUrl} target="_blank">
                              <ExternalLink className="h-4 w-4" />
                              別画面
                            </a>
                          </Button>
                        ) : null}
                        <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget(activeRow)} disabled={!canEdit}>
                          <Trash2 className="h-4 w-4" />
                          削除
                        </Button>
                      </div>
                    </div>

                    <form id={`ocr-edit-${activeRow.id}`} action={updateOcrDocumentInline} />
                    <input type="hidden" form={`ocr-edit-${activeRow.id}`} name="company" value={company} />
                    {activeRow.mailDocumentId ? <input type="hidden" form={`ocr-edit-${activeRow.id}`} name="mailDocumentId" value={activeRow.mailDocumentId} /> : null}
                    {activeRow.receivedInvoiceId ? (
                      <input type="hidden" form={`ocr-edit-${activeRow.id}`} name="receivedInvoiceId" value={activeRow.receivedInvoiceId} />
                    ) : null}
                    {activeRow.mailDocumentId && !activeRow.receivedInvoiceId ? (
                      <>
                        <form id={`ocr-reflect-${activeRow.id}`} action={reflectMailDocumentToReceivedInvoice} />
                        <input type="hidden" form={`ocr-reflect-${activeRow.id}`} name="company" value={company} />
                        <input type="hidden" form={`ocr-reflect-${activeRow.id}`} name="mailDocumentId" value={activeRow.mailDocumentId} />
                      </>
                    ) : null}

                    <div className="space-y-4">
                      <div className="space-y-4 rounded-lg border p-4">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <FileText className="h-4 w-4" />
                          要約
                        </div>
                        <dl className="space-y-2 text-sm">
                          {summaryLines(activeRow).map((line) => {
                            const [label, ...rest] = line.split(": ");
                            return (
                              <div key={line} className="grid grid-cols-[72px_1fr] gap-3">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd className="whitespace-pre-wrap break-words">{rest.join(": ")}</dd>
                              </div>
                            );
                          })}
                        </dl>
                        {activeRow.extracted?.projectId ? (
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/projects/${activeRow.extracted.projectId}?company=${company}`}>案件を開く</Link>
                          </Button>
                        ) : null}
                        <div className="space-y-2">
                          <div className="text-sm font-medium">OCR本文</div>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                            {activeRow.ocrText || "OCR本文はありません。"}
                          </pre>
                        </div>
                      </div>

                      <div className="min-w-0 space-y-3 rounded-lg border p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ImageIcon className="h-4 w-4" />
                            PDF / 画像
                          </div>
                          {activeRow.fileUrl ? (
                            <Button asChild variant="outline" size="sm">
                              <a href={activeRow.fileUrl} target="_blank">
                                <ExternalLink className="h-4 w-4" />
                                別画面
                              </a>
                            </Button>
                          ) : null}
                        </div>
                        <DocumentPreview compact row={activeRow} />
                      </div>
                    </div>

                    {/* #25: Single "変更" toggle only here */}
                    <div className="rounded-lg border">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
                        onClick={() => setShowEditor((v) => !v)}
                        disabled={!canEdit}
                      >
                        <span className="flex items-center gap-2">
                          <Pencil className="h-4 w-4" />
                          編集
                        </span>
                        {showEditor ? <Minimize2 className="h-4 w-4 text-muted-foreground" /> : <Maximize2 className="h-4 w-4 text-muted-foreground" />}
                      </button>

                      {showEditor ? <div className="border-t p-4" onClick={stopEditClick}>
                        <div className="mb-3 flex items-center justify-end gap-3">
                          <Button type="submit" form={`ocr-edit-${activeRow.id}`} disabled={!canEdit} size="sm" className="gap-1">
                            <Save className="h-4 w-4" />
                            保存
                          </Button>
                        </div>
                        <div className="grid gap-4 xl:grid-cols-2">
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">発送元</label>
                            <Input
                              form={`ocr-edit-${activeRow.id}`}
                              name="senderName"
                              defaultValue={shippingSenderName(activeRow)}
                              disabled={!canEdit || !activeRow.mailDocumentId}
                            />
                            <input form={`ocr-edit-${activeRow.id}`} type="hidden" name="fileName" value={activeRow.fileName} />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">分類</label>
                            {activeRow.mailDocumentId ? (
                              <select form={`ocr-edit-${activeRow.id}`} name="category" defaultValue={activeRow.category} className={selectClass()} disabled={!canEdit}>
                                {categoryOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <>
                                <input form={`ocr-edit-${activeRow.id}`} type="hidden" name="category" value={activeRow.category} />
                                <Badge>{categoryLabels[activeRow.category]}</Badge>
                              </>
                            )}
                          </div>
                          {activeRow.extracted ? (
                            <>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">支払先</label>
                                <select form={`ocr-edit-${activeRow.id}`} name="vendorId" defaultValue={activeRow.extracted.vendorId} className={selectClass()} disabled={!canEdit}>
                                  {vendors.map((vendor) => (
                                    <option key={vendor.value} value={vendor.value}>{vendor.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">案件</label>
                                <select form={`ocr-edit-${activeRow.id}`} name="projectId" defaultValue={activeRow.extracted.projectId} className={selectClass()} disabled={!canEdit}>
                                  {projects.map((project) => (
                                    <option key={project.value} value={project.value}>{project.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">状態</label>
                                <select form={`ocr-edit-${activeRow.id}`} name="status" defaultValue={activeRow.extracted.status ?? "REVIEWING"} className={selectClass()} disabled={!canEdit}>
                                  {statusOptions.map((status) => (
                                    <option key={status.value} value={status.value}>{status.label}</option>
                                  ))}
                                </select>
                              </div>
                            </>
                          ) : null}
                        </div>

                        <div className="space-y-3">
                          {activeRow.extracted ? (
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">請求日</label>
                                <Input form={`ocr-edit-${activeRow.id}`} name="issueDate" type="date" defaultValue={activeRow.extracted.issueDate} disabled={!canEdit} />
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">支払期限</label>
                                <Input form={`ocr-edit-${activeRow.id}`} name="dueDate" type="date" defaultValue={activeRow.extracted.dueDate} disabled={!canEdit} />
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">税抜</label>
                                <Input form={`ocr-edit-${activeRow.id}`} name="subtotal" type="number" defaultValue={activeRow.extracted.subtotal} disabled={!canEdit} />
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">消費税</label>
                                <Input form={`ocr-edit-${activeRow.id}`} name="taxTotal" type="number" defaultValue={activeRow.extracted.taxTotal} disabled={!canEdit} />
                              </div>
                              <div className="col-span-2 space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">合計</label>
                                <Input form={`ocr-edit-${activeRow.id}`} name="total" type="number" defaultValue={activeRow.extracted.total} disabled={!canEdit} className="font-mono" />
                              </div>
                            </div>
                          ) : (
                            /* #26: Default values from OCR extraction when available */
                            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium">受領請求書へ反映</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    この郵便物を受領請求書として登録します。
                                  </div>
                                </div>
                                <Button
                                  type="submit"
                                  form={`ocr-reflect-${activeRow.id}`}
                                  disabled={!canEdit || !activeRow.mailDocumentId || !vendors.length || !projects.length}
                                  size="sm"
                                  className="gap-1"
                                >
                                  <Plus className="h-4 w-4" />
                                  反映
                                </Button>
                              </div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">支払先</label>
                                  <select
                                    form={`ocr-reflect-${activeRow.id}`}
                                    name="vendorId"
                                    defaultValue={vendors[0]?.value}
                                    className={selectClass()}
                                    disabled={!canEdit || !vendors.length}
                                    required
                                  >
                                    {vendors.map((vendor) => (
                                      <option key={vendor.value} value={vendor.value}>{vendor.label}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">案件</label>
                                  <select
                                    form={`ocr-reflect-${activeRow.id}`}
                                    name="projectId"
                                    defaultValue={projects[0]?.value}
                                    className={selectClass()}
                                    disabled={!canEdit || !projects.length}
                                    required
                                  >
                                    {projects.map((project) => (
                                      <option key={project.value} value={project.value}>{project.label}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">状態</label>
                                  <select
                                    form={`ocr-reflect-${activeRow.id}`}
                                    name="status"
                                    defaultValue="REVIEWING"
                                    className={selectClass()}
                                    disabled={!canEdit}
                                  >
                                    {statusOptions.map((status) => (
                                      <option key={status.value} value={status.value}>{status.label}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">請求日</label>
                                  <Input
                                    form={`ocr-reflect-${activeRow.id}`}
                                    name="issueDate"
                                    type="date"
                                    defaultValue={activeRow.createdAt.slice(0, 10)}
                                    disabled={!canEdit}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">支払期限</label>
                                  <Input
                                    form={`ocr-reflect-${activeRow.id}`}
                                    name="dueDate"
                                    type="date"
                                    defaultValue={addDaysIso(activeRow.createdAt.slice(0, 10), 30)}
                                    disabled={!canEdit}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">小計</label>
                                  <Input form={`ocr-reflect-${activeRow.id}`} name="subtotal" type="number" defaultValue={0} disabled={!canEdit} />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs font-medium text-muted-foreground">消費税</label>
                                  <Input form={`ocr-reflect-${activeRow.id}`} name="taxTotal" type="number" defaultValue={0} disabled={!canEdit} />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <label className="text-xs font-medium text-muted-foreground">合計</label>
                                  <Input form={`ocr-reflect-${activeRow.id}`} name="total" type="number" defaultValue={0} disabled={!canEdit} className="font-mono" />
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">メモ</label>
                            <Textarea form={`ocr-edit-${activeRow.id}`} name="memo" defaultValue={activeRow.memo ?? ""} disabled={!canEdit} className="min-h-28" />
                          </div>
                        </div>
                        </div>
                      </div> : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                    <p>発送元を選択してください。</p>
                    {/* #30: Empty state CTA */}
                    {canEdit ? (
                      <Button type="button" variant="outline" size="sm" onClick={openDropzone} className="gap-1">
                        <Plus className="h-3.5 w-3.5" />
                        郵便物を追加する
                      </Button>
                    ) : null}
                  </div>
                )}
              </section>
            </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-center text-sm text-muted-foreground">
              <p>まだOCRした書類はありません。</p>
              {/* #30: Empty state CTA */}
              {canEdit ? (
                <Button type="button" variant="outline" onClick={openDropzone} className="gap-1">
                  <Plus className="h-4 w-4" />
                  最初の郵便物を追加する
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expand dialog */}
      <Dialog open={Boolean(dialogRow)} onOpenChange={(open) => !open && setDialogRow(null)}>
        <DialogContent className="max-h-[92vh] max-w-[min(1200px,calc(100vw-2rem))] overflow-y-auto">
          {dialogRow ? (
            <>
              <DialogHeader>
                <DialogTitle>{shippingSenderName(dialogRow)}</DialogTitle>
                <DialogDescription>
                  {categoryLabels[dialogRow.category]} / {formatDate(dialogRow.createdAt.slice(0, 10))}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 space-y-4">
                <div className="min-h-0 space-y-4 overflow-auto rounded-md border p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="h-4 w-4" />
                    内容一覧
                  </div>
                  <dl className="space-y-2 text-sm">
                    {summaryLines(dialogRow).map((line) => {
                      const [label, ...rest] = line.split(": ");
                      return (
                        <div key={line} className="grid grid-cols-[80px_1fr] gap-3">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="whitespace-pre-wrap">{rest.join(": ")}</dd>
                        </div>
                      );
                    })}
                  </dl>
                  {dialogRow.extracted?.projectId ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/projects/${dialogRow.extracted.projectId}?company=${company}`}>案件を開く</Link>
                    </Button>
                  ) : null}
                  <div className="space-y-2">
                    <div className="text-sm font-medium">OCR本文</div>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                      {dialogRow.ocrText || "OCR本文はありません。"}
                    </pre>
                  </div>
                </div>
                <div className="min-h-0 space-y-3 overflow-hidden rounded-md border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ImageIcon className="h-4 w-4" />
                      プレビュー
                    </div>
                    {dialogRow.fileUrl ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={dialogRow.fileUrl} target="_blank">
                          <ExternalLink className="h-4 w-4" />
                          別画面
                        </a>
                      </Button>
                    ) : null}
                  </div>
                  <DocumentPreview row={dialogRow} />
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Single item delete dialog */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          {deleteTarget ? (
            <>
              <DialogHeader>
                <DialogTitle>書類を削除しますか？</DialogTitle>
                <DialogDescription>
                  「{shippingSenderName(deleteTarget)}」を削除します。受領請求書に反映済みの場合は、受領請求書側からも削除されます。この操作は元に戻せません。
                </DialogDescription>
              </DialogHeader>
              <form action={deleteOcrDocument} className="flex justify-end gap-2">
                <input type="hidden" name="company" value={company} />
                {deleteTarget.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={deleteTarget.mailDocumentId} /> : null}
                {deleteTarget.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={deleteTarget.receivedInvoiceId} /> : null}
                <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                  キャンセル
                </Button>
                <Button type="submit" variant="destructive">
                  削除する
                </Button>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* #13: Bulk delete modal (replaces window.confirm) */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedRows.length}件の書類を削除しますか？</DialogTitle>
            <DialogDescription>
              選択した{selectedRows.length}件の書類とアップロードファイルを削除します。受領請求書に反映済みのものも削除されます。この操作は元に戻せません。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>キャンセル</Button>
            <Button
              variant="destructive"
              onClick={() => {
                setBulkDeleteOpen(false);
                bulkDeleteFormRef.current?.requestSubmit();
              }}
            >
              {selectedRows.length}件を削除する
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Hidden bulk delete form */}
      <form ref={bulkDeleteFormRef} action={deleteOcrDocumentsBulk} className="hidden">
        <input type="hidden" name="company" value={company} />
        {selectedRows.map((row) => (
          <span key={row.id}>
            {row.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null}
            {row.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
          </span>
        ))}
      </form>

      {/* #12: Category change confirmation dialog */}
      <Dialog open={Boolean(pendingCategoryChange)} onOpenChange={(open) => !open && setPendingCategoryChange(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>分類を変更しますか？</DialogTitle>
            <DialogDescription>
              「{pendingCategoryChange ? shippingSenderName(pendingCategoryChange.row) : ""}」の分類を変更します。
            </DialogDescription>
          </DialogHeader>
          {pendingCategoryChange ? (
            <form
              action={updateMailDocumentCategory}
              className="space-y-4"
              onSubmit={() => setPendingCategoryChange(null)}
            >
              <input type="hidden" name="company" value={company} />
              <input type="hidden" name="mailDocumentId" value={pendingCategoryChange.row.mailDocumentId ?? ""} />
              <select name="category" defaultValue={pendingCategoryChange.category} className={selectClass()}>
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPendingCategoryChange(null)}>キャンセル</Button>
                <Button type="submit">変更する</Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
