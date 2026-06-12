"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, CheckSquare, Download, ExternalLink, FileText, Folder, Image as ImageIcon, ListFilter, Maximize2, Minimize2, Pencil, Plus, Save, Square, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import {
  createMailFolder,
  deleteMailFolder,
  deleteOcrDocument,
  deleteOcrDocumentsBulk,
  moveOcrDocumentToMonth,
  reflectMailDocumentToReceivedInvoice,
  updateMailDocumentCategory,
  updateMailDocumentProcessingStatus,
  updateMailDocumentsBulkCategory,
  updateOcrDocumentInline,
  updateOcrDocumentsBulkProcessingStatus,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

type ProcessingFilter = "all" | "unprocessed" | "processed";
type DocumentSortMode = "newest" | "oldest" | "sender" | "category" | "amount-desc" | "amount-asc";
type SelectionDragState = { shouldSelect: boolean };

const processingFilters: Array<{ icon: typeof ListFilter; label: string; value: ProcessingFilter }> = [
  { icon: ListFilter, label: "\u5168\u4ef6", value: "all" },
  { icon: Square, label: "\u672a\u51e6\u7406", value: "unprocessed" },
  { icon: CheckSquare, label: "\u51e6\u7406\u6e08", value: "processed" },
];

const documentSortOptions: Array<{ label: string; value: DocumentSortMode }> = [
  { label: "\u65b0\u3057\u3044\u9806", value: "newest" },
  { label: "\u53e4\u3044\u9806", value: "oldest" },
  { label: "\u767a\u9001\u5143\u9806", value: "sender" },
  { label: "\u5206\u985e\u9806", value: "category" },
  { label: "\u91d1\u984d \u9ad8\u3044\u9806", value: "amount-desc" },
  { label: "\u91d1\u984d \u4f4e\u3044\u9806", value: "amount-asc" },
];

const processingStatusOptions = [
  { label: "\u672a\u51e6\u7406", value: "unprocessed" },
  { label: "\u51e6\u7406\u6e08", value: "processed" },
];

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
  return "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-[16px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm";
}

function categorySelectClass(category: MailDocumentCategory) {
  const tone =
    category === "INVOICE"
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-secondary text-secondary-foreground";
  return `h-7 max-w-[124px] rounded-full border px-2 text-[16px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-6 sm:max-w-[104px] sm:text-[11px] ${tone}`;
}

function shippingSenderName(row: OcrDocumentListItem) {
  if (row.senderName?.trim()) return row.senderName.trim();
  if (row.extracted?.vendorName && row.extracted.vendorName !== "支払先未設定") return row.extracted.vendorName;
  const firstLine = row.ocrText?.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 2 && line.length <= 40);
  return firstLine || row.fileName.replace(/\.[^.]+$/, "");
}

function processingStatusSelectClass(processed: boolean) {
  const tone = processed
    ? "border-border bg-background text-foreground"
    : "border-secondary bg-secondary text-secondary-foreground";
  return `h-7 rounded-full border px-2 text-[16px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-6 sm:text-[11px] ${tone}`;
}

function documentAmount(row: OcrDocumentListItem) {
  return row.extracted?.total ?? 0;
}

function isProcessedRow(row: OcrDocumentListItem) {
  return row.mailProcessed ?? Boolean(row.receivedInvoiceId);
}

function compareDocuments(a: OcrDocumentListItem, b: OcrDocumentListItem, sortMode: DocumentSortMode) {
  switch (sortMode) {
    case "oldest":
      return a.createdAt.localeCompare(b.createdAt);
    case "sender":
      return shippingSenderName(a).localeCompare(shippingSenderName(b), "ja") || b.createdAt.localeCompare(a.createdAt);
    case "category":
      return categoryLabels[a.category].localeCompare(categoryLabels[b.category], "ja") || b.createdAt.localeCompare(a.createdAt);
    case "amount-desc":
      return documentAmount(b) - documentAmount(a) || b.createdAt.localeCompare(a.createdAt);
    case "amount-asc":
      return documentAmount(a) - documentAmount(b) || b.createdAt.localeCompare(a.createdAt);
    case "newest":
    default:
      return b.createdAt.localeCompare(a.createdAt);
  }
}

function normalizeDuplicateText(value?: string) {
  return (value ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

function fileBaseName(value: string) {
  return normalizeDuplicateText(value.replace(/\.[^.]+$/, "").replace(/\(\d+\)|copy|コピー/gi, ""));
}

function duplicateKeys(row: OcrDocumentListItem) {
  const keys: string[] = [];
  const ocr = normalizeDuplicateText(row.ocrText);
  const fileName = fileBaseName(row.fileName);
  const sender = normalizeDuplicateText(shippingSenderName(row));
  const total = row.extracted?.total || normalizeDuplicateText(memoField(row, "金額"));
  const issueDate = row.extracted?.issueDate || memoField(row, "請求日") || row.createdAt.slice(0, 10);

  if (ocr.length >= 80) keys.push(`ocr:${ocr.slice(0, 1200)}`);
  if (fileName.length >= 8) keys.push(`file:${fileName}`);
  if (sender && total && issueDate) keys.push(`business:${sender}:${row.category}:${total}:${issueDate}`);

  return keys;
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

function DocumentPreview({ compact = false, row }: { compact?: boolean; row: OcrDocumentListItem }) {
  const frameClass = compact ? "h-[42vh] min-h-[280px] sm:h-[56vh] sm:min-h-[360px]" : "h-[68vh] min-h-96";
  const boxClass = compact ? "min-h-[280px] sm:min-h-[360px]" : "min-h-80";

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
    return <iframe title={row.fileName} src={row.fileUrl} className={`${frameClass} w-full rounded-md border bg-muted`} />;
  }

  return (
    <div className={`flex h-full ${boxClass} items-center justify-center rounded-md bg-muted`}>
      <Button asChild variant="outline">
        <a href={row.fileUrl} target="_blank">
          ファイルを開く
        </a>
      </Button>
    </div>
  );
}

function stopEditClick(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

type ColumnMode = "compact" | "normal";

const folderGridColumns: Record<ColumnMode, Record<ColumnMode, string>> = {
  compact: {
    compact: "lg:grid-cols-[92px_150px_minmax(0,1fr)]",
    normal: "lg:grid-cols-[92px_240px_minmax(0,1fr)]",
  },
  normal: {
    compact: "lg:grid-cols-[200px_150px_minmax(0,1fr)]",
    normal: "lg:grid-cols-[200px_240px_minmax(0,1fr)]",
  },
};

export function OcrDocumentsTable({
  canEdit,
  canExport,
  company,
  projects,
  rows,
  statusOptions,
  vendors,
  folders,
}: {
  canEdit: boolean;
  canExport: boolean;
  company: CompanyScope;
  folders: FolderOption[];
  projects: Option[];
  rows: OcrDocumentListItem[];
  statusOptions: Option[];
  vendors: Option[];
}) {
  const router = useRouter();
  const [isMoving, startMoveTransition] = useTransition();
  const [draggedRow, setDraggedRow] = useState<OcrDocumentListItem | null>(null);
  const [processingFilter, setProcessingFilter] = useState<ProcessingFilter>("all");
  const [documentSortMode, setDocumentSortMode] = useState<DocumentSortMode>("newest");
  const filteredRows = useMemo(() => {
    if (processingFilter === "all") return rows;
    return rows.filter((row) => (processingFilter === "processed" ? isProcessedRow(row) : !isProcessedRow(row)));
  }, [processingFilter, rows]);
  const groups = useMemo(() => {
    const grouped = new Map<string, OcrDocumentListItem[]>();
    for (const row of filteredRows) {
      const key = row.folderMonth || monthKey(row.createdAt);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    for (const folder of folders) {
      if (!grouped.has(folder.month)) grouped.set(folder.month, []);
    }
    return Array.from(grouped.entries())
      .map(([month, monthRows]) => [month, [...monthRows].sort((a, b) => compareDocuments(a, b, documentSortMode))] as const)
      .sort(([a], [b]) => b.localeCompare(a));
  }, [documentSortMode, filteredRows, folders]);
  const customFolderMonths = useMemo(() => new Set(folders.map((folder) => folder.month)), [folders]);
  const [activeMonth, setActiveMonth] = useState<string | null>(groups[0]?.[0] ?? null);
  const resolvedActiveMonth = activeMonth && groups.some(([month]) => month === activeMonth) ? activeMonth : groups[0]?.[0] ?? null;
  const activeRows = groups.find(([month]) => month === resolvedActiveMonth)?.[1] ?? [];
  const [activeRowId, setActiveRowId] = useState<string | null>(activeRows[0]?.id ?? null);
  const activeRow = activeRows.find((row) => row.id === activeRowId) ?? activeRows[0] ?? null;
  const [dialogRow, setDialogRow] = useState<OcrDocumentListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OcrDocumentListItem | null>(null);
  const [monthColumn, setMonthColumn] = useState<ColumnMode>("normal");
  const [senderColumn, setSenderColumn] = useState<ColumnMode>("normal");
  const [showEditor, setShowEditor] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionDrag, setSelectionDrag] = useState<SelectionDragState | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.id)), [rows, selectedIds]);
  const selectedMailRows = useMemo(() => selectedRows.filter((row) => row.mailDocumentId), [selectedRows]);
  const duplicateData = useMemo(() => {
    const keyedRows = new Map<string, OcrDocumentListItem[]>();
    for (const row of rows) {
      for (const key of duplicateKeys(row)) {
        keyedRows.set(key, [...(keyedRows.get(key) ?? []), row]);
      }
    }

    const badgeIds = new Set<string>();
    const selectableIds = new Set<string>();
    for (const groupRows of keyedRows.values()) {
      if (groupRows.length <= 1) continue;
      const sortedRows = [...groupRows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      sortedRows.forEach((row) => badgeIds.add(row.id));
      sortedRows.slice(1).forEach((row) => selectableIds.add(row.id));
    }

    return { badgeIds, selectableIds };
  }, [rows]);
  const duplicateIds = duplicateData.badgeIds;
  const duplicateSelectableIds = duplicateData.selectableIds;
  const duplicateFilteredRows = useMemo(() => filteredRows.filter((row) => duplicateSelectableIds.has(row.id)), [duplicateSelectableIds, filteredRows]);
  const processedCount = rows.filter(isProcessedRow).length;
  const unprocessedCount = rows.length - processedCount;
  const selectedFilteredCount = filteredRows.filter((row) => selectedIds.has(row.id)).length;
  const selectedActiveCount = activeRows.filter((row) => selectedIds.has(row.id)).length;
  const selectedDuplicateCount = duplicateFilteredRows.filter((row) => selectedIds.has(row.id)).length;
  const allFilteredSelected = filteredRows.length > 0 && selectedFilteredCount === filteredRows.length;
  const allActiveSelected = activeRows.length > 0 && selectedActiveCount === activeRows.length;
  const allDuplicatesSelected = duplicateFilteredRows.length > 0 && selectedDuplicateCount === duplicateFilteredRows.length;
  const exportHref = `/api/export/ocr-documents?company=${company}${
    selectedRows.length ? `&ids=${encodeURIComponent(selectedRows.map((row) => row.id).join(","))}` : ""
  }`;
  const draggedMoveCount = draggedRow && selectedIds.has(draggedRow.id) ? selectedRows.length : draggedRow ? 1 : 0;

  const chooseMonth = (month: string, monthRows: OcrDocumentListItem[]) => {
    setActiveMonth(month);
    setActiveRowId(monthRows[0]?.id ?? null);
  };

  const toggleRowSelection = (row: OcrDocumentListItem) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.add(row.id);
      }
      return next;
    });
  };

  const setRowSelected = (row: OcrDocumentListItem, shouldSelect: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (shouldSelect) {
        next.add(row.id);
      } else {
        next.delete(row.id);
      }
      return next;
    });
  };

  const toggleFilteredSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filteredRows.forEach((row) => next.delete(row.id));
      } else {
        filteredRows.forEach((row) => next.add(row.id));
      }
      return next;
    });
  };

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

  const toggleDuplicateSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allDuplicatesSelected) {
        duplicateFilteredRows.forEach((row) => next.delete(row.id));
      } else {
        duplicateFilteredRows.forEach((row) => next.add(row.id));
      }
      return next;
    });
  };

  const startSelectionDrag = (row: OcrDocumentListItem, event: React.PointerEvent<HTMLElement>) => {
    if (!canEdit || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const shouldSelect = !selectedIds.has(row.id);
    const dragState = { shouldSelect };
    selectionDragRef.current = dragState;
    setSelectionDrag(dragState);
    setActiveRowId(row.id);
    setRowSelected(row, shouldSelect);
  };

  const continueSelectionDrag = (row: OcrDocumentListItem) => {
    const dragState = selectionDragRef.current;
    if (!dragState) return;
    setActiveRowId(row.id);
    setRowSelected(row, dragState.shouldSelect);
  };

  const stopSelectionDrag = () => {
    selectionDragRef.current = null;
    setSelectionDrag(null);
  };

  const openDropzone = () => {
    document.getElementById("mail-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const moveRowToMonth = (row: OcrDocumentListItem | null, targetMonth: string) => {
    if (!row || !canEdit) return;
    const rowsToMove = selectedIds.has(row.id) ? selectedRows : [row];
    const movableRows = rowsToMove.filter((item) => item.mailDocumentId || item.receivedInvoiceId);
    if (!movableRows.length) return;
    const hasDifferentMonth = movableRows.some((item) => (item.folderMonth || monthKey(item.createdAt)) !== targetMonth);
    if (!hasDifferentMonth) return;
    const formData = new FormData();
    formData.set("company", company);
    formData.set("targetMonth", targetMonth);
    for (const item of movableRows) {
      if (item.mailDocumentId) formData.append("mailDocumentId", item.mailDocumentId);
      if (item.receivedInvoiceId) formData.append("receivedInvoiceId", item.receivedInvoiceId);
    }
    startMoveTransition(async () => {
      await moveOcrDocumentToMonth(formData);
      setActiveMonth(targetMonth);
      setActiveRowId(row.id);
      setSelectedIds((current) => {
        const next = new Set(current);
        movableRows.forEach((item) => next.delete(item.id));
        return next;
      });
      setDraggedRow(null);
      router.refresh();
    });
  };

  return (
    <>
      <Card className="lg:hidden">
        <CardHeader className="gap-3 px-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">郵便物</CardTitle>
              <div className="mt-1 text-xs text-muted-foreground">
                {activeRows.length}件表示 / {selectedRows.length ? `${selectedRows.length}件選択中` : `${rows.length}件`}
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={openDropzone}>
              <Plus className="h-3.5 w-3.5" />
              追加
            </Button>
          </div>

          <div className="grid gap-2">
            <div className="flex overflow-x-auto rounded-lg border bg-background p-1">
              {processingFilters.map((filter) => {
                const Icon = filter.icon;
                const count = filter.value === "all" ? rows.length : filter.value === "processed" ? processedCount : unprocessedCount;
                return (
                  <Button
                    key={filter.value}
                    type="button"
                    size="sm"
                    variant={processingFilter === filter.value ? "default" : "ghost"}
                    className="h-9 min-w-[88px] gap-1 rounded-md px-2 text-xs"
                    onClick={() => {
                      setProcessingFilter(filter.value);
                      setActiveMonth(null);
                      setActiveRowId(null);
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {filter.label}
                    <span className="tabular-nums">{count}</span>
                  </Button>
                );
              })}
            </div>

            <label className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
              <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              <select
                value={documentSortMode}
                className="h-8 min-w-0 flex-1 bg-background text-[16px] outline-none"
                onChange={(event) => {
                  setDocumentSortMode(event.target.value as DocumentSortMode);
                  setActiveRowId(null);
                }}
              >
                {documentSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 px-3">
          {groups.length ? (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {groups.map(([month, monthRows]) => {
                  const isActive = month === resolvedActiveMonth;
                  return (
                    <button
                      key={month}
                      type="button"
                      className={`min-w-[112px] rounded-xl border px-3 py-2 text-left ${
                        isActive ? "border-primary bg-primary text-primary-foreground" : "bg-background"
                      }`}
                      onClick={() => chooseMonth(month, monthRows)}
                    >
                      <div className="text-xs font-medium">{shortMonthLabel(month)}</div>
                      <div className={`mt-1 text-[11px] ${isActive ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{monthRows.length}件</div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button type="button" size="sm" variant="outline" className="gap-1" onClick={toggleFilteredSelection} disabled={!filteredRows.length}>
                  {allFilteredSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                  全件
                </Button>
                <Button type="button" size="sm" variant="outline" className="gap-1" onClick={toggleActiveMonthSelection} disabled={!activeRows.length}>
                  {allActiveSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                  表示中
                </Button>
                <Button type="button" size="sm" variant="outline" className="gap-1" onClick={toggleDuplicateSelection} disabled={!duplicateFilteredRows.length}>
                  {allDuplicatesSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                  重複
                </Button>
              </div>

              {selectedRows.length ? (
                <div className="sticky top-[64px] z-10 space-y-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium">
                    <span>{selectedRows.length}件選択中</span>
                    <Button type="button" size="xs" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                      解除
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <form action={updateOcrDocumentsBulkProcessingStatus} className="min-w-0">
                      <input type="hidden" name="company" value={company} />
                      {selectedRows.map((row) => (
                        <span key={row.id}>
                          {row.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null}
                          {row.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
                        </span>
                      ))}
                      <select
                        name="processingStatus"
                        defaultValue=""
                        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-[16px] outline-none"
                        disabled={!canEdit}
                        onChange={(event) => {
                          if (event.currentTarget.value) event.currentTarget.form?.requestSubmit();
                        }}
                      >
                        <option value="" disabled>
                          状態
                        </option>
                        {processingStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </form>
                    <form action={updateMailDocumentsBulkCategory} className="min-w-0">
                      <input type="hidden" name="company" value={company} />
                      {selectedMailRows.map((row) => (
                        row.mailDocumentId ? <input key={row.id} type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null
                      ))}
                      <select
                        name="category"
                        defaultValue=""
                        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-[16px] outline-none"
                        disabled={!canEdit || !selectedMailRows.length}
                        onChange={(event) => {
                          if (event.currentTarget.value) event.currentTarget.form?.requestSubmit();
                        }}
                      >
                        <option value="" disabled>
                          分類
                        </option>
                        {categoryOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </form>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                    <form action={moveOcrDocumentToMonth} className="min-w-0">
                      <input type="hidden" name="company" value={company} />
                      {selectedRows.map((row) => (
                        <span key={row.id}>
                          {row.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null}
                          {row.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
                        </span>
                      ))}
                      <select
                        name="targetMonth"
                        defaultValue=""
                        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-[16px] outline-none"
                        disabled={!canEdit}
                        onChange={(event) => {
                          if (event.currentTarget.value) event.currentTarget.form?.requestSubmit();
                        }}
                      >
                        <option value="" disabled>
                          移動先
                        </option>
                        {groups.map(([month]) => (
                          <option key={month} value={month}>
                            {monthLabel(month)}
                          </option>
                        ))}
                      </select>
                    </form>
                    {canExport ? (
                      <Button asChild size="icon-sm" variant="outline" aria-label="CSV">
                        <a href={exportHref}>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    ) : null}
                    <form
                      action={deleteOcrDocumentsBulk}
                      onSubmit={(event) => {
                        if (!selectedRows.length || !confirm(`${selectedRows.length}件の書類を削除します。よろしいですか？`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="company" value={company} />
                      {selectedRows.map((row) => (
                        <span key={row.id}>
                          {row.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null}
                          {row.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
                        </span>
                      ))}
                      <Button type="submit" size="icon-sm" variant="outline" className="text-destructive" disabled={!canEdit}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </form>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                {activeRows.map((row) => {
                  const isSelected = selectedIds.has(row.id);
                  const isDuplicate = duplicateIds.has(row.id);
                  return (
                    <div
                      key={row.id}
                      className={`rounded-xl border bg-background p-3 shadow-sm ${
                        isSelected ? "border-primary ring-1 ring-primary/30" : isDuplicate ? "border-amber-300" : "border-border"
                      }`}
                    >
                      <div className="flex gap-3">
                        {canEdit ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            className="mt-1 h-5 w-5 rounded border-muted-foreground/40"
                            aria-label={`${shippingSenderName(row)}を選択`}
                            onChange={() => toggleRowSelection(row)}
                          />
                        ) : null}
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setActiveRowId(row.id);
                            setDialogRow(row);
                          }}
                        >
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="line-clamp-2 break-words text-sm font-semibold leading-snug">{shippingSenderName(row)}</div>
                              <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{row.ocrPreview}</div>
                            </div>
                            {row.extracted?.total ? <div className="shrink-0 font-mono text-xs">{moneyFormatter.format(row.extracted.total)}</div> : null}
                          </div>
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {canEdit && (row.mailDocumentId || row.receivedInvoiceId) ? (
                          <form action={updateMailDocumentProcessingStatus} onClick={stopEditClick}>
                            <input type="hidden" name="company" value={company} />
                            {row.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null}
                            {row.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
                            <select
                              name="processingStatus"
                              defaultValue={isProcessedRow(row) ? "processed" : "unprocessed"}
                              className={processingStatusSelectClass(isProcessedRow(row))}
                              aria-label="処理状態"
                              onChange={(event) => event.currentTarget.form?.requestSubmit()}
                            >
                              {processingStatusOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </form>
                        ) : (
                          <Badge variant={isProcessedRow(row) ? "outline" : "secondary"}>{isProcessedRow(row) ? "処理済" : "未処理"}</Badge>
                        )}
                        {canEdit && row.mailDocumentId ? (
                          <form action={updateMailDocumentCategory} onClick={stopEditClick}>
                            <input type="hidden" name="company" value={company} />
                            <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} />
                            <select
                              name="category"
                              defaultValue={row.category}
                              className={categorySelectClass(row.category)}
                              aria-label="分類"
                              onChange={(event) => event.currentTarget.form?.requestSubmit()}
                            >
                              {categoryOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </form>
                        ) : (
                          <Badge variant={row.category === "INVOICE" ? "default" : "secondary"}>{categoryLabels[row.category]}</Badge>
                        )}
                        {isDuplicate ? <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-700">重複</Badge> : null}
                        <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={() => setDialogRow(row)}>
                          詳細
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">まだOCRした書類がありません。</div>
          )}
        </CardContent>
      </Card>

      <Card className="hidden overflow-hidden border-muted-foreground/10 shadow-sm lg:flex">
        <CardHeader className="gap-3 border-b bg-muted/20 px-3 sm:px-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <CardTitle>郵便物フォルダー</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">追加・変更・削除と、カラム幅の切り替えができます。</div>
            <div className="mt-3 grid max-w-md grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border bg-background px-3 py-2">
                <div className="text-muted-foreground">未処理</div>
                <div className="mt-1 text-base font-semibold tabular-nums">{unprocessedCount}</div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-2">
                <div className="text-muted-foreground">処理済</div>
                <div className="mt-1 text-base font-semibold tabular-nums">{processedCount}</div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-2">
                <div className="text-muted-foreground">選択中</div>
                <div className="mt-1 text-base font-semibold tabular-nums">{selectedRows.length}</div>
              </div>
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-2 md:w-auto md:justify-end">
            <div className="flex max-w-full items-center overflow-x-auto rounded-md border bg-background p-0.5">
              {processingFilters.map((filter) => {
                const Icon = filter.icon;
                const count = filter.value === "all" ? rows.length : filter.value === "processed" ? processedCount : unprocessedCount;
                return (
                  <Button
                    key={filter.value}
                    type="button"
                    size="sm"
                    variant={processingFilter === filter.value ? "default" : "ghost"}
                    className="h-7 gap-1 rounded-sm px-2 text-xs"
                    onClick={() => {
                      setProcessingFilter(filter.value);
                      setActiveMonth(null);
                      setActiveRowId(null);
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {filter.label}
                    <span className="tabular-nums">{count}</span>
                  </Button>
                );
              })}
            </div>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={toggleFilteredSelection} disabled={!filteredRows.length}>
              {allFilteredSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allFilteredSelected ? "全解除" : "全書類を選択"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={toggleActiveMonthSelection} disabled={!activeRows.length}>
              {allActiveSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allActiveSelected ? "解除" : "表示中を選択"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={toggleDuplicateSelection} disabled={!duplicateFilteredRows.length}>
              {allDuplicatesSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allDuplicatesSelected ? "重複解除" : `重複片方を選択 ${duplicateFilteredRows.length}`}
            </Button>
            <form action={updateOcrDocumentsBulkProcessingStatus} className="flex min-w-[132px] flex-1 sm:flex-none">
              <input type="hidden" name="company" value={company} />
              {selectedRows.map((row) => (
                <span key={row.id}>
                  {row.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null}
                  {row.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
                </span>
              ))}
              <select
                name="processingStatus"
                defaultValue=""
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-[16px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 sm:w-32 sm:text-xs"
                disabled={!canEdit || !selectedRows.length}
                onChange={(event) => {
                  if (event.currentTarget.value) event.currentTarget.form?.requestSubmit();
                }}
              >
                <option value="" disabled>
                  一括状態
                </option>
                {processingStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </form>
            <form action={updateMailDocumentsBulkCategory} className="flex min-w-[132px] flex-1 sm:flex-none">
              <input type="hidden" name="company" value={company} />
              {selectedMailRows.map((row) => (
                row.mailDocumentId ? <input key={row.id} type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null
              ))}
              <select
                name="category"
                defaultValue=""
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-[16px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 sm:w-32 sm:text-xs"
                disabled={!canEdit || !selectedMailRows.length}
                onChange={(event) => {
                  if (event.currentTarget.value) event.currentTarget.form?.requestSubmit();
                }}
              >
                <option value="" disabled>
                  一括分類
                </option>
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </form>
            {canExport ? (
              <Button asChild size="sm" variant="outline" className="gap-1">
                <a href={exportHref}>
                  <Download className="h-3.5 w-3.5" />
                  {selectedRows.length ? `${selectedRows.length}件CSV` : "全件CSV"}
                </a>
              </Button>
            ) : null}
            <form
              action={deleteOcrDocumentsBulk}
              className="flex"
              onSubmit={(event) => {
                if (!selectedRows.length || !confirm(`${selectedRows.length}件の書類と未参照のアップロードファイルを削除します。よろしいですか？`)) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="company" value={company} />
              {selectedRows.map((row) => (
                <span key={row.id}>
                  {row.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null}
                  {row.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
                </span>
              ))}
              <Button type="submit" size="sm" variant="outline" className="gap-1 text-destructive" disabled={!canEdit || !selectedRows.length}>
                <Trash2 className="h-3.5 w-3.5" />
                選択削除
              </Button>
            </form>
            <form action={createMailFolder} className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-none">
              <input type="hidden" name="company" value={company} />
              <Input name="month" type="month" className="h-8 min-w-0 flex-1 sm:w-32" disabled={!canEdit} />
              <Button type="submit" size="sm" variant="outline" className="gap-1" disabled={!canEdit}>
                <Folder className="h-3.5 w-3.5" />
                フォルダー
              </Button>
            </form>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={openDropzone}>
              <Plus className="h-3.5 w-3.5" />
              追加
            </Button>
            <Button type="button" size="sm" variant={showEditor ? "default" : "outline"} className="gap-1" onClick={() => setShowEditor((value) => !value)} disabled={!canEdit || !activeRow}>
              <Pencil className="h-3.5 w-3.5" />
              変更
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setMonthColumn((value) => (value === "normal" ? "compact" : "normal"))}>
              {monthColumn === "normal" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              月{monthColumn === "normal" ? "小" : "広"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setSenderColumn((value) => (value === "normal" ? "compact" : "normal"))}>
              {senderColumn === "normal" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              発送元{senderColumn === "normal" ? "小" : "広"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-3 py-4 sm:px-4">
          {groups.length ? (
            <div className={`grid min-h-0 overflow-hidden rounded-xl border bg-background shadow-sm lg:min-h-[640px] ${folderGridColumns[monthColumn][senderColumn]}`}>
              <aside className="min-w-0 border-b bg-slate-50/80 p-3 lg:border-r lg:border-b-0">
                <div className="mb-3 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                  <span>{monthColumn === "compact" ? "月" : "月フォルダー"}</span>
                  {isMoving ? <span className="text-primary">移動中</span> : null}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
                  {groups.map(([month, monthRows]) => {
                    const isActive = month === resolvedActiveMonth;
                    const canDeleteFolder = canEdit && customFolderMonths.has(month) && monthRows.length === 0;
                    return (
                      <div key={month} className="group relative min-w-[156px] lg:min-w-0">
                        <button
                          type="button"
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                            isActive ? "bg-background shadow-sm ring-1 ring-primary/30" : "hover:bg-background"
                          } ${draggedRow ? "ring-1 ring-dashed ring-primary/30" : ""}`}
                          onClick={() => chooseMonth(month, monthRows)}
                          onDragOver={(event) => {
                            if (!canEdit || !draggedRow) return;
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            moveRowToMonth(draggedRow, month);
                          }}
                        >
                          <Folder className={`h-5 w-5 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{monthColumn === "compact" ? shortMonthLabel(month) : monthLabel(month)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {draggedMoveCount && !isActive ? `${draggedMoveCount}件を移動` : monthColumn === "compact" ? monthRows.length : `${monthRows.length}件`}
                            </div>
                          </div>
                        </button>
                        {canDeleteFolder ? (
                          <form action={deleteMailFolder} className="absolute top-2 right-2 opacity-0 transition group-hover:opacity-100">
                            <input type="hidden" name="company" value={company} />
                            <input type="hidden" name="month" value={month} />
                            <Button type="submit" size="icon" variant="ghost" className="h-7 w-7 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </aside>

              <aside className="min-w-0 border-b bg-background p-3 lg:border-r lg:border-b-0">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <label className="flex min-w-0 flex-1 items-center gap-1">
                    <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
                    <select
                      value={documentSortMode}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-[16px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-7 sm:text-xs"
                      onChange={(event) => {
                        setDocumentSortMode(event.target.value as DocumentSortMode);
                        setActiveRowId(null);
                      }}
                    >
                      {documentSortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mb-3 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                  <span>発送元</span>
                  {selectedRows.length ? <span>{selectedRows.length}件選択</span> : null}
                </div>
                <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:overflow-visible lg:pr-0" onPointerUp={stopSelectionDrag} onPointerLeave={stopSelectionDrag}>
                  {activeRows.map((row) => {
                    const isActive = row.id === activeRow?.id;
                    const isSelected = selectedIds.has(row.id);
                    const isDuplicate = duplicateIds.has(row.id);
                    return (
                      <div
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        draggable={canEdit && !selectionDrag}
                        className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                          isActive
                            ? "border-primary bg-primary/5"
                            : isSelected
                              ? "border-primary/40 bg-primary/5"
                              : isDuplicate
                                ? "border-amber-400/60 bg-amber-50/60 hover:bg-amber-50"
                                : "border-transparent hover:bg-muted"
                        } ${draggedRow?.id === row.id ? "cursor-grabbing opacity-60" : selectionDrag ? "cursor-cell" : "cursor-grab"}`}
                        onClick={() => setActiveRowId(row.id)}
                        onPointerEnter={() => continueSelectionDrag(row)}
                        onPointerMove={() => continueSelectionDrag(row)}
                        onPointerUp={stopSelectionDrag}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveRowId(row.id);
                          }
                        }}
                        onDragStart={(event) => {
                          setDraggedRow(row);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", row.id);
                        }}
                        onDragEnd={() => setDraggedRow(null)}
                      >
                        <div className="flex items-start gap-2">
                          {canEdit ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              className="mt-0.5 h-4 w-4 rounded border-muted-foreground/40"
                              aria-label={`${shippingSenderName(row)}を選択`}
                              title="ドラッグで複数選択"
                              onChange={() => toggleRowSelection(row)}
                              onPointerDown={(event) => startSelectionDrag(row, event)}
                              onPointerMove={() => continueSelectionDrag(row)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          ) : null}
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="line-clamp-2 break-words text-sm font-medium leading-snug">{shippingSenderName(row)}</div>
                              {senderColumn === "normal" ? (
                                <div className="flex flex-wrap items-center gap-1">
                                  {canEdit && (row.mailDocumentId || row.receivedInvoiceId) ? (
                                    <form action={updateMailDocumentProcessingStatus} className="shrink-0" onClick={stopEditClick}>
                                      <input type="hidden" name="company" value={company} />
                                      {row.mailDocumentId ? <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} /> : null}
                                      {row.receivedInvoiceId ? <input type="hidden" name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
                                      <select
                                        name="processingStatus"
                                        defaultValue={isProcessedRow(row) ? "processed" : "unprocessed"}
                                        className={processingStatusSelectClass(isProcessedRow(row))}
                                        aria-label={"\u51e6\u7406\u72b6\u614b"}
                                        onChange={(event) => event.currentTarget.form?.requestSubmit()}
                                      >
                                        {processingStatusOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </form>
                                  ) : (
                                    <Badge variant={isProcessedRow(row) ? "outline" : "secondary"}>{isProcessedRow(row) ? "\u51e6\u7406\u6e08" : "\u672a\u51e6\u7406"}</Badge>
                                  )}
                                  {canEdit && row.mailDocumentId ? (
                                  <form action={updateMailDocumentCategory} className="shrink-0" onClick={stopEditClick}>
                                    <input type="hidden" name="company" value={company} />
                                    <input type="hidden" name="mailDocumentId" value={row.mailDocumentId} />
                                    <select
                                      name="category"
                                      defaultValue={row.category}
                                      className={categorySelectClass(row.category)}
                                      aria-label="分類"
                                      onChange={(event) => event.currentTarget.form?.requestSubmit()}
                                    >
                                      {categoryOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </form>
                                ) : (
                                  <Badge variant={row.category === "INVOICE" ? "default" : "secondary"}>{categoryLabels[row.category]}</Badge>
                                  )}
                                  {isDuplicate ? <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-700">重複</Badge> : null}
                                </div>
                              ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </aside>

              <section className="min-w-0 bg-muted/10 p-3 sm:p-4">
                {activeRow ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="break-words text-base font-medium sm:text-lg">{shippingSenderName(activeRow)}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{activeRow.ocrPreview}</div>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Button type="button" variant="outline" size="sm" onClick={() => setDialogRow(activeRow)}>
                          拡大表示
                        </Button>
                        <Button type="button" variant={showEditor ? "default" : "outline"} size="sm" onClick={() => setShowEditor((value) => !value)} disabled={!canEdit}>
                          <Pencil className="h-4 w-4" />
                          変更
                        </Button>
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
                              <div key={line} className="grid gap-1 sm:grid-cols-[72px_1fr] sm:gap-3">
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
                      </div>

                      <div className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4">
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

                      <div className="space-y-2 rounded-lg border p-4">
                        <div className="text-sm font-medium">OCR本文</div>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                          {activeRow.ocrText || "OCR本文はありません。"}
                        </pre>
                      </div>
                    </div>

                    {showEditor ? <div className="rounded-lg border bg-muted/10 p-4" onClick={stopEditClick}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">編集</div>
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
                                  <option key={vendor.value} value={vendor.value}>
                                    {vendor.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">案件</label>
                              <select form={`ocr-edit-${activeRow.id}`} name="projectId" defaultValue={activeRow.extracted.projectId} className={selectClass()} disabled={!canEdit}>
                                {projects.map((project) => (
                                  <option key={project.value} value={project.value}>
                                    {project.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">状態</label>
                              <select form={`ocr-edit-${activeRow.id}`} name="status" defaultValue={activeRow.extracted.status ?? "REVIEWING"} className={selectClass()} disabled={!canEdit}>
                                {statusOptions.map((status) => (
                                  <option key={status.value} value={status.value}>
                                    {status.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </>
                        ) : null}
                      </div>

                      <div className="space-y-3">
                        {activeRow.extracted ? (
                          <div className="grid gap-3 sm:grid-cols-2">
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
                            <div className="space-y-2 sm:col-span-2">
                              <label className="text-xs font-medium text-muted-foreground">合計</label>
                              <Input form={`ocr-edit-${activeRow.id}`} name="total" type="number" defaultValue={activeRow.extracted.total} disabled={!canEdit} className="font-mono" />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium">受領請求書へ反映</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  この郵便物を、現在のフォルダーのまま受領請求書として登録します。
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
                                    <option key={vendor.value} value={vendor.value}>
                                      {vendor.label}
                                    </option>
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
                                    <option key={project.value} value={project.value}>
                                      {project.label}
                                    </option>
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
                                    <option key={status.value} value={status.value}>
                                      {status.label}
                                    </option>
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
                ) : (
                  <div className="flex h-full min-h-80 items-center justify-center text-sm text-muted-foreground">発送元を選択してください。</div>
                )}
              </section>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">まだOCRした書類はありません。</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(dialogRow)} onOpenChange={(open) => !open && setDialogRow(null)}>
        <DialogContent className="max-h-[92vh] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-[min(1200px,calc(100vw-2rem))]">
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
                        <div key={line} className="grid gap-1 sm:grid-cols-[80px_1fr] sm:gap-3">
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
                </div>
                <div className="min-h-0 space-y-3 overflow-hidden rounded-md border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ImageIcon className="h-4 w-4" />
                      スクリーンショット / プレビュー
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
                <div className="space-y-2 rounded-md border p-4">
                  <div className="text-sm font-medium">OCR本文</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                    {dialogRow.ocrText || "OCR本文はありません。"}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          {deleteTarget ? (
            <>
              <DialogHeader>
                <DialogTitle>書類を削除しますか？</DialogTitle>
                <DialogDescription>
                  {shippingSenderName(deleteTarget)} を削除します。受領請求書に反映済みの場合は、受領請求書側からも削除されます。
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
    </>
  );
}
