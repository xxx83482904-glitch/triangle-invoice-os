"use client";

import Link from "next/link";
import { useFeedbackForm } from "@/hooks/use-feedback-form";
import { useOperationError } from "@/hooks/use-operation-error";
import { unconfirmedUploadFiles, uploadFeedback } from "@/lib/operation-feedback";
import { OperationPending, OperationError } from "@/components/app/operation-feedback";
import { saveOcrDocumentDetails } from "./edit-actions";
import { OnScreenPdfFrame } from "@/components/app/on-screen-pdf-frame";
import { OriginalDocumentPreview } from "@/app/received-invoices/original-document-preview";
import { useRouter } from "next/navigation";
import { ArrowUpRight, AlertTriangle, CheckSquare, Download, ExternalLink, FileText, Folder, FolderPlus, GripVertical, HelpCircle, Image as ImageIcon, List, LoaderCircle, Maximize2, Minimize2, Pencil, Plus, Save, Search, Trash2, UploadCloud, X } from "lucide-react";
import { useListSelection } from "@/hooks/use-list-selection";
import { RowSelectionCheckbox, SelectionActionBar, SelectionToolbar } from "@/components/app/list-selection";
import { OptionTabs } from "@/components/app/option-tabs";
import { isCardPress, isSelectionControl } from "@/lib/list-selection";
import { FilterPanel } from "@/components/app/filter-panel";
import { RecordDetail } from "@/components/app/record-detail";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Fragment, type CSSProperties, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MonthTabs } from "@/components/app/month-tabs";
import { createMailFolder, deleteMailFolder, deleteOcrDocument, deleteOcrDocumentsBulk, moveOcrDocumentToMonth, saveMailSorterBulkEdits, updateMailDocumentCategory, updateOcrDocumentInline } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import type { CompanyScope } from "@/lib/company";
import type { MailDocumentCategory, ReceivedInvoiceStatus } from "@/lib/types";
import { isMailProcessed, type MailSorterEdit } from "@/lib/mail-processing";
import { matchesMailSearch } from "@/lib/mail-search";
import { MailInvoiceReflectionForm } from "./mail-invoice-reflection-form";
import type { MailInvoiceDefaults } from "@/lib/mail-invoice-defaults";
import { MailRelinkForm, MailUnlinkButton } from "./mail-link-controls";

type Option = {
  label: string;
  value: string;
};

export type OcrDocumentListItem = {
  category: MailDocumentCategory;
  confidence?: number;
  createdAt: string;
  duplicateOfMailDocumentId?: string;
  duplicateOfReceivedInvoiceId?: string;
  duplicateReason?: string;
  duplicateScore?: number;
  duplicateTitle?: string;
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
  // Link integrity: a mail document whose received invoice was deleted, or whose original file is gone.
  linkBroken?: boolean;
  brokenTargetId?: string;
  fileMissing?: boolean;
  linkCandidates?: Array<{ label: string; value: string }>;
  mailUpdatedAt?: string;
  invoiceUpdatedAt?: string;
  reflectDefaults?: MailInvoiceDefaults;
};

type FolderOption = {
  label?: string;
  month: string;
};

type CategoryFilter = "all" | MailDocumentCategory;
type DuplicateFilter = "all" | "duplicates";
type ProcessingFilter = "all" | "unprocessed" | "processed";
type ProcessingStatusValue = "unprocessed" | "processed";
type ViewMode = "folder" | "list";

const EMPTY_ROWS: OcrDocumentListItem[] = [];
const LIST_BATCH_SIZE = 40;

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

function monthLabel(value: string) {
  return monthFormatter.format(new Date(`${value}-01T00:00:00`));
}

function selectClass() {
  return "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
}

function categorySelectClass(category: MailDocumentCategory) {
  const tone = {
    INVOICE: "border-blue-300 bg-blue-100 text-blue-800",
    RECEIPT: "border-emerald-300 bg-emerald-100 text-emerald-800",
    CONTRACT: "border-violet-300 bg-violet-100 text-violet-800",
    ESTIMATE: "border-orange-300 bg-orange-100 text-orange-800",
    DELIVERY_NOTE: "border-orange-300 bg-orange-100 text-orange-800",
    NOTICE: "border-amber-300 bg-amber-100 text-amber-800",
    OTHER: "border-border bg-secondary text-secondary-foreground",
  }[category];
  return `h-6 max-w-[104px] rounded-full border px-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${tone}`;
}

function processingStatusSelectClass(processed: boolean) {
  const tone = processed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800";
  return `h-6 max-w-[92px] rounded-full border px-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${tone}`;
}

function shippingSenderName(row: OcrDocumentListItem) {
  if (row.senderName?.trim()) return row.senderName.trim();
  if (row.extracted?.vendorName && row.extracted.vendorName !== "支払先未設定") return row.extracted.vendorName;
  const firstLine = (row.ocrText || row.ocrPreview)?.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 2 && line.length <= 40);
  return firstLine || row.fileName.replace(/\.[^.]+$/, "");
}

const ocrTextCache = new Map<string, string>();

function OcrTextPanel({ row, className }: { row: OcrDocumentListItem; className: string }) {
  const query = row.mailDocumentId
    ? `mailDocumentId=${encodeURIComponent(row.mailDocumentId)}`
    : row.receivedInvoiceId
      ? `receivedInvoiceId=${encodeURIComponent(row.receivedInvoiceId)}`
      : "";
  const cacheKey = query || row.id;
  const cachedText = ocrTextCache.get(cacheKey);
  const [text, setText] = useState(row.ocrText ?? cachedText ?? row.ocrPreview ?? "");
  const [loading, setLoading] = useState(Boolean(query && row.ocrText === undefined && cachedText === undefined));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (row.ocrText !== undefined || cachedText !== undefined || !query) return;

    const controller = new AbortController();
    void fetch(`/api/mail-sorter/ocr-text?${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("OCR text request failed");
        return response.json() as Promise<{ ocrText?: string }>;
      })
      .then((body) => {
        const nextText = body.ocrText ?? "";
        ocrTextCache.set(cacheKey, nextText);
        setText(nextText);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cacheKey, cachedText, query, row.ocrText]);

  return (
    <pre className={className}>
      {failed ? "OCR本文を読み込めませんでした。" : text || (loading ? "OCR本文を読み込み中..." : "OCR本文はありません。")}
    </pre>
  );
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
  const structuredLabels = new Set(["発送元", "内容", "金額", "振込先", "請求日", "支払期限", "重複", "判定"]);
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

function summaryLines(row: OcrDocumentListItem) {
  const content = memoField(row, "内容") || row.ocrPreview || "内容確認待ち";
  const amount = row.extracted ? moneyFormatter.format(row.extracted.total) : memoField(row, "金額");
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
    lines.push(`合計: ${moneyFormatter.format(row.extracted.total)}`);
  }
  if (row.confidence) lines.push(`信頼度: ${row.confidence}%`);
  if (row.linkBroken) lines.push("参照切れ: 反映先の受領請求書が削除されています");
  if (row.fileMissing) lines.push("原本: ファイルが見つかりません");
  if (isDuplicate(row)) lines.push(`重複: ${duplicateDescription(row)}`);
  const remainder = memoRemainder(row);
  if (remainder) lines.push(`メモ: ${remainder}`);
  return lines;
}

function isDuplicate(row: OcrDocumentListItem) {
  return Boolean(row.duplicateOfMailDocumentId || row.duplicateOfReceivedInvoiceId || row.duplicateReason);
}

function duplicateDescription(row: OcrDocumentListItem) {
  const title = row.duplicateTitle ? ` / 既存: ${row.duplicateTitle}` : "";
  const score = row.duplicateScore ? ` / 類似度 ${row.duplicateScore}%` : "";
  return `${row.duplicateReason ?? "重複候補"}${title}${score}`;
}

const isProcessed = isMailProcessed;

function DocumentPreview({ compact = false, row, company }: { compact?: boolean; row: OcrDocumentListItem; company: CompanyScope }) {
  if (company === "JAPAN") return <OriginalDocumentPreview company={company} fileUrl={row.fileUrl} fileName={row.fileName} mimeType={row.mimeType} sourceMissing={row.fileMissing} />;
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
          <OnScreenPdfFrame title={row.fileName} src={row.fileUrl} className={`${frameClass} w-full rounded-md border bg-muted`} />
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

function DocumentEditor({
  canEdit: allowedEdit,
  company,
  compact = false,
  linkTargets = [],
  projects,
  row,
  statusOptions,
  surface,
  vendors,
}: {
  canEdit: boolean;
  company: CompanyScope;
  compact?: boolean;
  linkTargets?: Option[];
  projects: Option[];
  row: OcrDocumentListItem;
  statusOptions: Option[];
  surface: "folder" | "list";
  vendors: Option[];
}) {
  const detailSave = useFeedbackForm(company, saveOcrDocumentDetails, "郵便物の詳細を保存しました");
  const canEdit = allowedEdit && !(company === "JAPAN" && detailSave.pending);
  const editFormId = `ocr-edit-${surface}-${row.id}`;

  return (
    <div className="space-y-4" onClick={stopEditClick}>
      <form id={editFormId} action={updateOcrDocumentInline} onSubmit={detailSave.onSubmit} />
      <OperationError message={detailSave.feedback?.formId === editFormId && detailSave.feedback.error ? detailSave.feedback.message : undefined} />
      <input type="hidden" form={editFormId} name="company" value={company} />
      {row.mailDocumentId ? <input type="hidden" form={editFormId} name="mailDocumentId" value={row.mailDocumentId} /> : null}
      {row.receivedInvoiceId ? <input type="hidden" form={editFormId} name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}
      <input form={editFormId} type="hidden" name="fileName" value={row.fileName} />



      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Pencil className="h-4 w-4" />
          この郵便物を編集
        </div>
        <Button type="submit" form={editFormId} disabled={!canEdit} size="sm" className="gap-1">
          <OperationPending pending={company === "JAPAN" && detailSave.pending}><Save className="h-4 w-4" />保存</OperationPending>
        </Button>
      </div>

      <div className={`grid gap-4 ${compact ? "" : "xl:grid-cols-2"}`}>
        <div className="workspace-detail-group space-y-3"><h3 className="text-sm font-semibold">基本情報・連携</h3>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">発送元</label>
            <Input
              form={editFormId}
              name="senderName"
              defaultValue={shippingSenderName(row)}
              disabled={!canEdit || !row.mailDocumentId}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">分類</label>
            {row.mailDocumentId ? (
              <select form={editFormId} name="category" defaultValue={row.category} className={selectClass()} disabled={!canEdit}>
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <>
                <input form={editFormId} type="hidden" name="category" value={row.category} />
                <Badge>{categoryLabels[row.category]}</Badge>
              </>
            )}
          </div>
          {row.extracted ? (
            <>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">支払先</label>
                <select form={editFormId} name="vendorId" defaultValue={row.extracted.vendorId} className={selectClass()} disabled={!canEdit}>
                  {vendors.map((vendor) => (
                    <option key={vendor.value} value={vendor.value}>{vendor.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">案件</label>
                <select form={editFormId} name="projectId" defaultValue={row.extracted.projectId} className={selectClass()} disabled={!canEdit}>
                  {projects.map((project) => (
                    <option key={project.value} value={project.value}>{project.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">状態</label>
                <select form={editFormId} name="status" defaultValue={row.extracted.status ?? "REVIEWING"} className={selectClass()} disabled={!canEdit}>
                  {statusOptions.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </div>
              {row.mailDocumentId && row.receivedInvoiceId ? <MailUnlinkButton company={company} mailDocumentId={row.mailDocumentId} mailUpdatedAt={row.mailUpdatedAt} disabled={!canEdit} /> : null}
            </>
          ) : null}
        </div>

        <div className="workspace-detail-group space-y-3"><h3 className="text-sm font-semibold">金額・支払</h3>
          {row.extracted ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">請求日</label>
                <Input form={editFormId} name="issueDate" type="date" defaultValue={row.extracted.issueDate} disabled={!canEdit} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">支払期限</label>
                <Input form={editFormId} name="dueDate" type="date" defaultValue={row.extracted.dueDate} disabled={!canEdit} />
              </div>
              <div className="col-span-2 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">合計</label>
                <Input form={editFormId} name="total" type="number" defaultValue={row.extracted.total} disabled={!canEdit} className="font-mono" />
              </div>
            </div>
          ) : (
            <>
            {row.mailDocumentId ? <MailInvoiceReflectionForm company={company} key={row.id} mailDocumentId={row.mailDocumentId} mailUpdatedAt={row.mailUpdatedAt} defaults={row.reflectDefaults} vendors={vendors} projects={projects} statusOptions={statusOptions} broken={row.linkBroken} disabled={!canEdit} /> : null}
            {row.mailDocumentId ? <MailRelinkForm company={company} mailDocumentId={row.mailDocumentId} mailUpdatedAt={row.mailUpdatedAt} candidates={row.linkCandidates ?? []} targets={linkTargets} broken={row.linkBroken} brokenTargetId={row.brokenTargetId} disabled={!canEdit} /> : null}
            </>
          )}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">メモ</label>
            <Textarea form={editFormId} name="memo" defaultValue={row.memo ?? ""} disabled={!canEdit} className="min-h-28" />
          </div>
        </div>
      </div>
    </div>
  );
}

type ColumnMode = "compact" | "normal";

type ResizeTarget = "folderSender" | "listPreview";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function OcrDocumentsTable({
  canEdit,
  canExport = false,
  linkRequiredOnly = false,
  company,
  linkTargets = [],
  projects,
  rows,
  statusOptions,
  vendors,
  folders,
}: {
  canEdit: boolean;
  canExport?: boolean;
  linkRequiredOnly?: boolean;
  company: CompanyScope;
  folders: FolderOption[];
  linkTargets?: Option[];
  projects: Option[];
  rows: OcrDocumentListItem[];
  statusOptions: Option[];
  vendors: Option[];
}) {
  const router = useRouter();
  const [isMoving, startMoveTransition] = useTransition();
  const [isFiltering, startFilterTransition] = useTransition();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [folderCreateOpen, setFolderCreateOpen] = useState(false);
  const [newFolderMonth, setNewFolderMonth] = useState("");
  const [creatingFolder, startCreateFolder] = useTransition();
  const [folderError, setFolderError] = useOperationError(company);
  const detailSave = useFeedbackForm(company, saveOcrDocumentDetails, "郵便物の詳細を保存しました");
  const folderUploadInputRef = useRef<HTMLInputElement>(null);
  const [draggedIds, setDraggedIds] = useState<Set<string>>(new Set());
  const [dragOverMonth, setDragOverMonth] = useState<string | null>(null);
  const [fileDragMonth, setFileDragMonth] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [duplicateFilter, setDuplicateFilter] = useState<DuplicateFilter>("all");
  const [processingFilter, setProcessingFilter] = useState<ProcessingFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [pickMode, setPickMode] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const wideList = useMediaQuery("(min-width: 1280px)");
  const wideFolder = useMediaQuery("(min-width: 768px)");
  const [listMonth, setListMonth] = useState("");
  const [visibleListCount, setVisibleListCount] = useState(LIST_BATCH_SIZE);
  const [uploadTargetMonth, setUploadTargetMonth] = useState<string | null>(null);
  const folderUploadBusy = useRef(false);
  const [folderRetry, setFolderRetry] = useState<{ files: File[]; month: string }>();
  const [folderOperationError, setFolderOperationError] = useState("");
  const [uploadingMonth, setUploadingMonth] = useState<string | null>(null);
  const [folderSenderWidth, setFolderSenderWidth] = useState(220);
  const [listPreviewWidth, setListPreviewWidth] = useState(420);
  const [pendingCategories, setPendingCategories] = useState<Partial<Record<string, MailDocumentCategory>>>({});
  const [isSaving, startSaveTransition] = useTransition();
  const saveInFlight = useRef(false);
  const [saveFeedback, setSaveFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const processing = (isProcessed(row) ? "processed" : "unprocessed");
      const category = pendingCategories[row.id] ?? row.category;
      if (processingFilter !== "all" && processing !== processingFilter) return false;
      if (categoryFilter !== "all" && category !== categoryFilter) return false;
      if (duplicateFilter === "duplicates" && !isDuplicate(row)) return false;
      return matchesMailSearch(row, deferredQuery);
    });
  }, [categoryFilter, duplicateFilter, pendingCategories, processingFilter, rows, deferredQuery]);
  const processingCounts = useMemo(() => rows.reduce((counts, row) => {
    counts[(isProcessed(row) ? "processed" : "unprocessed")]++;
    return counts;
  }, { all: rows.length, processed: 0, unprocessed: 0 }), [rows]);
  const hasFilters = Boolean(query || processingFilter !== "all" || categoryFilter !== "all" || duplicateFilter !== "all");
  function resetFilters() {
    setQuery(""); setProcessingFilter("all"); setCategoryFilter("all"); setDuplicateFilter("all"); setVisibleListCount(LIST_BATCH_SIZE);
  }
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
  const monthCounts = useMemo(() => new Map(groups.map(([month, monthRows]) => [month, monthRows.length])), [groups]);
  const listGroups = useMemo(() => listMonth ? groups.filter(([month]) => month === listMonth) : groups, [groups, listMonth]);
  const listRows = useMemo(() => listGroups.flatMap(([, monthRows]) => monthRows), [listGroups]);
  const renderedListGroups = useMemo(() => {
    return listGroups.reduce<{
      groups: Array<[string, OcrDocumentListItem[]]>;
      remaining: number;
    }>((state, [month, monthRows]) => {
      if (!monthRows.length) {
        return { ...state, groups: [...state.groups, [month, monthRows]] };
      }
      if (state.remaining <= 0) return state;
      const visibleRows = monthRows.slice(0, state.remaining);
      return {
        groups: [...state.groups, [month, visibleRows]],
        remaining: state.remaining - visibleRows.length,
      };
    }, { groups: [], remaining: visibleListCount }).groups;
  }, [listGroups, visibleListCount]);
  const listMonthCounts = useMemo(
    () => new Map(listGroups.map(([month, monthRows]) => [month, monthRows.length])),
    [listGroups],
  );
  const renderedListRowCount = renderedListGroups.reduce((count, [, monthRows]) => count + monthRows.length, 0);
  const hasMoreListRows = renderedListRowCount < listRows.length;
  const customFolderMonths = useMemo(() => new Set(folders.map((folder) => folder.month)), [folders]);
  const [activeMonth, setActiveMonth] = useState<string | null>(groups[0]?.[0] ?? null);
  const activeGroup = groups.find(([month]) => month === activeMonth) ?? groups[0];
  const selectedMonth = activeGroup?.[0] ?? null;
  const activeRows = activeGroup?.[1] ?? EMPTY_ROWS;
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const activeRow = activeRows.find((row) => row.id === activeRowId) ?? activeRows[0] ?? null;
  const listPreviewRow = listRows.find((row) => row.id === activeRowId) ?? listRows[0] ?? null;
  const listPreviewMonth = listPreviewRow ? listPreviewRow.folderMonth || monthKey(listPreviewRow.createdAt) : null;
  const [dialogRow, setDialogRow] = useState<OcrDocumentListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OcrDocumentListItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [senderColumn, setSenderColumn] = useState<ColumnMode>("normal");
  const [showEditor, setShowEditor] = useState(false);
  const [pendingCategoryChange, setPendingCategoryChange] = useState<{ row: OcrDocumentListItem; category: MailDocumentCategory } | null>(null);
  const bulkDeleteFormRef = useRef<HTMLFormElement>(null);

  const duplicateRows = useMemo(() => rows.filter(isDuplicate), [rows]);
  const selectionScopeRows = viewMode === "list" ? listRows : activeRows;
  const selection = useListSelection(selectionScopeRows.map((row) => row.id), { availableIds: rows.map((row) => row.id), disabled: isMoving, pickMode });
  const { selected: selectedIds, setSelected: setSelectedIds } = selection;
  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const hiddenSelectedCount = selection.hiddenCount;
  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    folders.forEach((folder) => months.add(folder.month));
    rows.forEach((row) => months.add(row.folderMonth || monthKey(row.createdAt)));
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [folders, rows]);
  const pendingEdits = useMemo(() => {
    return rows
      .map((row) => ({
        category: pendingCategories[row.id],
        mailDocumentId: row.mailDocumentId,
        mailUpdatedAt: row.mailUpdatedAt,
        invoiceUpdatedAt: row.invoiceUpdatedAt,
        receivedInvoiceId: row.receivedInvoiceId,
      }))
      .filter((edit) => edit.category);
  }, [pendingCategories, rows]);
  const exportRows = selectedRows.length ? selectedRows : linkRequiredOnly ? rows : [];
  const exportHref = canExport ? `/api/export/ocr-documents?company=${company}${
    exportRows.length ? `&ids=${encodeURIComponent(exportRows.map((row) => row.id).join(","))}` : ""
  }` : "#";

  const chooseTabMonth = (month: string) => {
    setListMonth(month);
    setVisibleListCount(LIST_BATCH_SIZE);
    if (groups.some(([key]) => key === month)) {
      setActiveMonth(month);
      setActiveRowId(null);
    }
  };

  const openRow = (row: OcrDocumentListItem) => {
    setActiveRowId(row.id);
    setDetailOpen(true);
  };

  const stepFrom = (list: OcrDocumentListItem[], current: OcrDocumentListItem | null, step: number) => {
    const next = current ? list[list.indexOf(current) + step] : undefined;
    return next ? () => setActiveRowId(next.id) : undefined;
  };

  const processingValueForRow = (row: OcrDocumentListItem): ProcessingStatusValue =>
    (isProcessed(row) ? "processed" : "unprocessed");

  const categoryValueForRow = (row: OcrDocumentListItem) => pendingCategories[row.id] ?? row.category;

  const saveEdits = (edits: MailSorterEdit[], processing = false) => {
    if (!edits.length || saveInFlight.current || !canEdit) return;
    saveInFlight.current = true;
    setSaveFeedback(null);
    startSaveTransition(async () => {
      try {
        const form = new FormData();
        form.set("changes", JSON.stringify(edits));
        const result = await saveMailSorterBulkEdits(form);
        if (!result.ok) throw new Error(result.error);
        // Remove only the submitted category drafts after a successful save; keep newer edits.
        if (!processing) setPendingCategories((current) => {
          const next = { ...current };
          for (const row of rows) {
            const saved = edits.find((edit) => edit.mailDocumentId && edit.mailDocumentId === row.mailDocumentId);
            if (saved?.category && next[row.id] === saved.category) delete next[row.id];
          }
          return next;
        });
        const message = processing ? "処理状態を保存しました" : "分類の変更を保存しました";
        setSaveFeedback({ message, error: false });
        toast({ title: message, variant: "success" });
        // revalidatePath in the action returns fresh rows in the same response.
      } catch (error) {
        const reason = error instanceof Error ? error.message : "通信状況を確認して再試行してください";
        setSaveFeedback({ message: "保存できませんでした: " + reason + (processing ? "（処理状態は保存前の表示のままです）" : "（変更内容は保持しています）"), error: true });
        toast({ title: "保存に失敗しました", description: reason, variant: "destructive" });
      } finally {
        saveInFlight.current = false;
      }
    });
  };

  const saveProcessing = (targetRows: OcrDocumentListItem[], processingStatus: ProcessingStatusValue) => {
    const edits = targetRows.filter((row) => row.mailDocumentId || row.receivedInvoiceId).map((row) => ({
      mailDocumentId: row.mailDocumentId, receivedInvoiceId: row.receivedInvoiceId,
      mailUpdatedAt: row.mailUpdatedAt, invoiceUpdatedAt: row.invoiceUpdatedAt, processingStatus,
    }));
    saveEdits(edits, true);
  };

  const applyCategoryDraft = (targetRows: OcrDocumentListItem[], category: MailDocumentCategory) => {
    const editableRows = targetRows.filter((row) => row.mailDocumentId);
    if (!editableRows.length) return;
    setPendingCategories((current) => {
      const next = { ...current };
      for (const row of editableRows) {
        if (category === row.category) delete next[row.id];
        else next[row.id] = category;
      }
      return next;
    });
  };

  const selectedOrSingleRow = (row: OcrDocumentListItem) => (
    selectedIds.has(row.id) && selectedRows.length > 1 ? selectedRows : [row]
  );

  const openDropzone = () => {
    document.getElementById("mail-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const uploadFilesToMonth = useCallback(async (files: FileList | File[], targetMonth: string) => {
    const selected = Array.from(files);
    if (!canEdit || !selected.length || (company === "JAPAN" && folderUploadBusy.current)) return;
    if (company === "JAPAN") { folderUploadBusy.current = true; setFolderOperationError(""); setFolderRetry({ files: selected, month: targetMonth }); }
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
      if (company === "JAPAN") {
        const retained = unconfirmedUploadFiles(selected, results);
        setFolderRetry(retained.length ? { files: retained, month: targetMonth } : undefined);
        if (retained.length || errorCount) {
          const feedback = uploadFeedback(results, retained.length);
          setFolderOperationError([feedback.title, feedback.description, ...results.map((r: { error?: string }) => r.error)].filter(Boolean).join("。"));
          toast(feedback); router.refresh(); return;
        }
        if (folderUploadInputRef.current) folderUploadInputRef.current.value = "";
      }
      setActiveMonth(targetMonth);
      setActiveRowId(null);
      setViewMode("list");
      router.refresh();
      toast({
        title: errorCount ? `${okCount}件収納、${errorCount}件エラー` : `${okCount || selected.length}件を${monthLabel(targetMonth)}へ収納しました`,
        variant: errorCount ? "default" : "success",
      });
    } catch (error) {
      if (company === "JAPAN") setFolderOperationError(error instanceof Error ? error.message : "収納結果を確認できませんでした。登録済みの内容を確認してから再試行してください。");
      toast({
        title: "収納に失敗しました",
        description: error instanceof Error ? error.message : "郵便物の収納に失敗しました",
        variant: "destructive",
      });
    } finally {
      folderUploadBusy.current = false;
      setUploadingMonth(null);
      setUploadTargetMonth(null);
    }
  }, [canEdit, company, router]);

  const openFolderUpload = (month: string) => {
    if (!canEdit || (company === "JAPAN" && folderUploadBusy.current)) return;
    setUploadTargetMonth(month);
    folderUploadInputRef.current?.click();
  };

  const isFileDrag = (event: React.DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");

  const startColumnResize = useCallback((event: React.PointerEvent<HTMLElement>, target: ResizeTarget) => {
    event.preventDefault();
    const startX = event.clientX;
    const startSenderWidth = folderSenderWidth;
    const startPreviewWidth = listPreviewWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
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
  }, [folderSenderWidth, listPreviewWidth]);

  // #2: multi-row drag support
  const moveRowsToMonth = (ids: Set<string>, targetMonth: string) => {
    if (!ids.size || !canEdit || (company === "JAPAN" && isMoving)) return;
    if (company === "JAPAN") setFolderOperationError("");
    const rowsToMove = rows.filter((r) => ids.has(r.id) && (r.folderMonth || monthKey(r.createdAt)) !== targetMonth);
    if (!rowsToMove.length) return;
    startMoveTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("company", company);
        formData.set("targetMonth", targetMonth);
        for (const row of rowsToMove) {
          if (row.mailDocumentId) formData.append("mailDocumentId", row.mailDocumentId);
          if (row.receivedInvoiceId) formData.append("receivedInvoiceId", row.receivedInvoiceId);
        }
        await moveOcrDocumentToMonth(formData);
        setSelectedIds((current) => {
          const next = new Set(current);
          rowsToMove.forEach((row) => next.delete(row.id));
          return next;
        });
        toast({ title: `${rowsToMove.length}件を${monthLabel(targetMonth)}へ移動しました`, variant: "success" });
        router.refresh();
      } catch (error) {
        if (company === "JAPAN") setFolderOperationError(error instanceof Error ? error.message : "郵便物を移動できませんでした");
        toast({
          title: "移動に失敗しました",
          description: error instanceof Error ? error.message : "郵便物を移動できませんでした",
          variant: "destructive",
        });
      } finally {
        setDraggedIds(new Set());
        setDragOverMonth(null);
      }
    });
  };

  const handleDragStart = (row: OcrDocumentListItem) => {
    if (!canEdit) return;
    const idsToMove = selectedIds.has(row.id) && selectedIds.size > 1 ? new Set(selectedIds) : new Set([row.id]);
    if (selection.picking && (!selectedIds.has(row.id) || selectedIds.size <= 1)) {
      setSelectedIds(new Set([row.id]));
    }
    setActiveRowId(row.id);
    setDraggedIds(idsToMove);
  };

  const handleDrop = (targetMonth: string) => {
    if (!draggedIds.size) return;
    moveRowsToMonth(draggedIds, targetMonth);
  };

  const monthDropHandlers = (month: string) => ({
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
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
    },
    onDragLeave: () => {
      setFileDragMonth(null);
      setDragOverMonth(null);
    },
    onDrop: (event: React.DragEvent<HTMLElement>) => {
      if (!canEdit) return;
      event.preventDefault();
      setFileDragMonth(null);
      setDragOverMonth(null);
      if (event.dataTransfer.files.length) {
        void uploadFilesToMonth(event.dataTransfer.files, month);
        return;
      }
      handleDrop(month);
    },
  });

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
        disabled={isSaving}
        title="書類整理の状態です。変更すると保存します。支払状況とは独立しています"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => saveProcessing(selectedOrSingleRow(row), event.currentTarget.value as ProcessingStatusValue)}
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
        disabled={isSaving}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => applyCategoryDraft(selectedOrSingleRow(row), event.currentTarget.value as MailDocumentCategory)}
      >
        {categoryOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  };

  const renderDuplicateBadge = (row: OcrDocumentListItem) => {
    if (!isDuplicate(row)) return null;
    return (
      <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-800" title={duplicateDescription(row)}>
        <AlertTriangle className="h-3 w-3" />
        重複
      </Badge>
    );
  };

  const listGridStyle = { "--mail-list-preview-width": `${listPreviewWidth}px` } as CSSProperties;
  const folderGridStyle = {
    "--mail-folder-sender-width": `${folderSenderWidth}px`,
  } as CSSProperties;

  return (
    <>
      <input
        ref={folderUploadInputRef}
        className="sr-only"
        type="file"
        aria-label="月フォルダーへ収納する郵便物"
        accept="application/pdf,image/jpeg,image/png"
        multiple
        onChange={(event) => {
          if (event.target.files && uploadTargetMonth) void uploadFilesToMonth(event.target.files, uploadTargetMonth);
          if (company !== "JAPAN") event.target.value = "";
        }}
      />
      <section aria-label="郵便物一覧" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">郵便物 <span className="ml-1 text-sm font-normal text-muted-foreground">{filteredRows.length} / {rows.length}件</span></h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {canExport ? <Button asChild size="icon" variant="outline" className="size-11 lg:size-11"><a href={exportHref} title={exportRows.length ? `${exportRows.length}件をCSV出力` : "全件をCSV出力"} aria-label="郵便物をCSV出力"><Download className="size-4" /></a></Button> : null}
            <Button type="button" className="min-h-11 lg:min-h-11" variant="outline" disabled={!canEdit} onClick={() => { setFolderError(""); setFolderCreateOpen(true); }}><FolderPlus className="size-4" />月フォルダー</Button>
            <Button type="button" className="min-h-11 lg:min-h-11" disabled={!canEdit} onClick={openDropzone}><Plus className="size-4" />郵便物を追加</Button>
          </div>
        </div>
        {company === "JAPAN" ? <><OperationError message={folderOperationError} />
          {folderRetry && !uploadingMonth ? <div className="flex flex-wrap items-center gap-2 text-xs"><p className="text-muted-foreground">{monthLabel(folderRetry.month)}への選択{folderRetry.files.length}件を保持しています。登録済みの内容を確認してから再試行してください。</p><Button type="button" variant="outline" size="sm" onClick={() => void uploadFilesToMonth(folderRetry.files, folderRetry.month)}>保持したファイルを再試行（{folderRetry.files.length}件）</Button></div> : null}
        </> : null}
        <FilterPanel label="絞り込み・表示" activeCount={Number(categoryFilter !== "all") + Number(duplicateFilter !== "all")} onReset={hasFilters ? resetFilters : undefined} primary={<>
          <div className="filter-panel-search relative"><Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} aria-label="郵便物を検索" placeholder="発送元・ファイル名・案件を検索" className="min-h-11 pl-9 lg:min-h-9 lg:pl-9" onChange={(event) => { setQuery(event.target.value); setVisibleListCount(LIST_BATCH_SIZE); }} /></div>
          <OptionTabs label="郵便物の処理状態" value={processingFilter} options={(["all", "unprocessed", "processed"] as ProcessingFilter[]).map((filter) => [filter, <>{filter === "all" ? "すべて" : filter === "processed" ? "処理済み" : "未処理"} <span className="text-xs tabular-nums">{processingCounts[filter]}</span></>] as const)} onChange={(filter) => startFilterTransition(() => { setProcessingFilter(filter); setVisibleListCount(LIST_BATCH_SIZE); })} />
          <LoaderCircle aria-label="絞り込み中" className={`size-4 animate-spin ${isFiltering || query !== deferredQuery ? "" : "hidden"}`} />
        </>}>
          <OptionTabs label="郵便物の分類で絞り込み" caption="分類" value={categoryFilter} options={[["all", "すべて"], ...categoryOptions.map((option) => [option.value, option.label] as const)]} onChange={(value) => startFilterTransition(() => { setCategoryFilter(value as CategoryFilter); setVisibleListCount(LIST_BATCH_SIZE); })} />
          {duplicateRows.length || duplicateFilter === "duplicates" ? <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={duplicateFilter === "duplicates"} onChange={(event) => startFilterTransition(() => { setDuplicateFilter(event.target.checked ? "duplicates" : "all"); setVisibleListCount(LIST_BATCH_SIZE); })} />重複候補のみ ({duplicateRows.length})</label> : null}
          {duplicateRows.length ? <Button type="button" variant="ghost" className="min-h-11 lg:min-h-11" onClick={() => setSelectedIds(new Set(filteredRows.filter(isDuplicate).map((row) => row.id)))}><CheckSquare className="size-4" />重複を選択</Button> : null}
          {viewMode === "folder" ? <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 gap-1 lg:min-h-11"
              onClick={() => {
                const next = senderColumn === "normal" ? "compact" : "normal";
                setSenderColumn(next);
                setFolderSenderWidth(next === "normal" ? 220 : 150);
              }}
            >
              {senderColumn === "normal" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              発送元{senderColumn === "normal" ? "小" : "広"}
            </Button> : null}
          <p className="basis-full text-xs text-muted-foreground">処理状態は書類整理のための手動設定です。変更すると保存します。支払状況とは連動しません。</p>
        </FilterPanel>
        {isSaving ? <p role="status" className="flex items-center gap-1 text-sm"><OperationPending pending={company === "JAPAN"}>保存中…</OperationPending></p> : saveFeedback ? <p role={saveFeedback.error ? "alert" : "status"} className={saveFeedback.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{saveFeedback.message}</p> : null}
        <MonthTabs
          label="郵便物の月"
          value={viewMode === "list" ? listMonth : selectedMonth ?? ""}
          months={groups.map(([month]) => month)}
          counts={monthCounts}
          showAll={viewMode === "list"}
          disabled={isMoving}
          isMonthDisabled={viewMode === "folder" ? (month) => !monthCounts.has(month) : undefined}
          monthProps={(month) => monthCounts.has(month) ? { ...monthDropHandlers(month), "data-drop": dragOverMonth === month || fileDragMonth === month ? "" : undefined } : {}}
          onChange={chooseTabMonth}
        />
        <div className="list-mode-row">
          <OptionTabs label="郵便物の選び方" value={selection.picking ? "pick" : "review"} options={[["review", "1件ずつ確認"], ["pick", "まとめて選択"]]} onChange={(mode) => { setPickMode(mode === "pick"); if (mode === "review") selection.clear(); }} />
          {selection.picking ? <SelectionToolbar selection={selection} /> : null}
          <div role="group" aria-label="郵便物の表示形式" className="ml-auto flex rounded-md border p-0.5">
            <Button type="button" size="icon" className="size-11 lg:size-9" variant={viewMode === "list" ? "secondary" : "ghost"} aria-pressed={viewMode === "list"} aria-label="一覧表示" title="一覧表示" onClick={() => startFilterTransition(() => setViewMode("list"))}><List className="size-4" /></Button>
            <Button type="button" size="icon" className="size-11 lg:size-9" variant={viewMode === "folder" ? "secondary" : "ghost"} aria-pressed={viewMode === "folder"} aria-label="フォルダー表示" title="フォルダー表示" onClick={() => startFilterTransition(() => setViewMode("folder"))}><Folder className="size-4" /></Button>
          </div>
        </div>
        <div>
          {selectedRows.length || pendingEdits.length ? (
            <SelectionActionBar label="選択した郵便物の操作" className="[&_button]:min-h-11 [&_select]:min-h-11">
              <Badge variant={selectedRows.length ? "default" : "secondary"}>
                {selectedRows.length ? `${selectedRows.length}件選択` : "未保存あり"}
              </Badge>
              {pendingEdits.length ? <Badge variant="outline">{pendingEdits.length}件の変更</Badge> : null}
              {hiddenSelectedCount ? <span className="text-xs text-muted-foreground">表示外 {hiddenSelectedCount}件を含む</span> : null}
              <Button type="button" variant="ghost" size="icon" className="size-11 text-destructive" title="選択した郵便物を削除" aria-label="選択した郵便物を削除" disabled={!canEdit || !selectedRows.length || isSaving} onClick={() => setBulkDeleteOpen(true)}><Trash2 className="size-4" /></Button>
              <select
                aria-label="選択した書類の処理状態"
                className="h-9 min-w-32 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                disabled={!canEdit || !selectedRows.length || isSaving}
                value=""
                onChange={(event) => {
                  const value = event.currentTarget.value as ProcessingStatusValue;
                  if (value) saveProcessing(selectedRows, value);
                }}
              >
                <option value="">処理状態</option>
                {processingStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                aria-label="選択した書類の分類"
                className="h-9 min-w-32 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                disabled={!canEdit || isSaving || !selectedRows.some((row) => row.mailDocumentId)}
                value=""
                onChange={(event) => {
                  const value = event.currentTarget.value as MailDocumentCategory;
                  if (value) applyCategoryDraft(selectedRows, value);
                }}
              >
                <option value="">分類</option>
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                aria-label="選択した書類の移動先"
                className="h-9 min-w-36 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                disabled={!canEdit || !selectedRows.length || isMoving}
                value=""
                onChange={(event) => {
                  const targetMonth = event.currentTarget.value;
                  if (targetMonth) moveRowsToMonth(new Set(selectedRows.map((row) => row.id)), targetMonth);
                }}
              >
                <option value="">月へ移動</option>
                {monthOptions.map((month) => (
                  <option key={month} value={month}>{monthLabel(month)}</option>
                ))}
              </select>
              <Button type="button" size="sm" className="ml-auto h-9 gap-1" disabled={isSaving || !pendingEdits.length} onClick={() => saveEdits(pendingEdits)}>
                <OperationPending pending={company === "JAPAN" && isSaving}><Save className="h-3.5 w-3.5" />分類を保存</OperationPending>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 gap-1"
                disabled={!selectedRows.length}
                onClick={() => {
                  setSelectedIds(new Set());
                }}
              >
                <X className="h-3.5 w-3.5" />
                選択解除
              </Button>
            </SelectionActionBar>
          ) : null}
          {hasFilters && !filteredRows.length ? <p role="status" className="mb-3 border-l-2 border-primary py-3 pl-3 text-sm">条件に合う郵便物がありません。</p> : null}
          {groups.length ? (
            viewMode === "list" ? (
              <div
                className="grid min-h-0 gap-y-4 xl:min-h-[640px] xl:grid-cols-[minmax(0,1fr)_8px_var(--mail-list-preview-width)]"
                style={listGridStyle}
              >
                <div className="min-w-0 overflow-x-auto">
                  {listGroups.length ? (
                    <table className="record-cards record-cards-stack record-cards-compact workspace-record-table w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          {selection.picking ? <th className="w-10 px-3 py-2 text-left"></th> : null}
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
                        {renderedListGroups.map(([month, monthRows]) => {
                          const isDocumentDragOver = dragOverMonth === month;
                          const isFileDragOver = fileDragMonth === month;
                          return (
                          <Fragment key={month}>
                            <tr
                              className="record-section-row"
                              data-drop={isFileDragOver || isDocumentDragOver ? "" : undefined}
                              {...monthDropHandlers(month)}
                            >
                              <td colSpan={selection.picking ? 8 : 7} className="px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="flex items-center gap-2 text-sm font-medium">
                                    <Folder className="h-4 w-4 text-primary" />
                                    <span>{monthLabel(month)}</span>
                                  </span>
                                  <div className="ml-auto flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">{listMonthCounts.get(month) ?? monthRows.length}件</span>
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
                            {monthRows.length ? (
                              monthRows.map((row) => {
                                const isActive = row.id === (wideList ? listPreviewRow?.id : activeRowId);
                                const isDragging = draggedIds.has(row.id);
                                return (
                                  <tr
                                    key={row.id}
                                    {...selection.rowProps(row.id)}
                                    draggable={canEdit}
                                    data-active={isActive ? "" : undefined}
                                    className={`${processingValueForRow(row) === "processed" ? "[--card-tone:var(--color-green-500)]" : "[--card-tone:var(--color-amber-400)]"} ${isDragging ? "opacity-50" : ""}`}
                                    onClick={(event) => {
                                      if (isSelectionControl(event.target, event.currentTarget) || (selection.picking && isCardPress(event.target, event.currentTarget))) return;
                                      setActiveMonth(month);
                                      openRow(row);
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
                                    {selection.picking ? <td className="record-card-tick p-0">
                                      <RowSelectionCheckbox selection={selection} id={row.id} label={`${shippingSenderName(row)}を選択`} />
                                    </td> : null}
                                    <td className="record-card-title max-w-[240px] px-3 py-2 font-medium"><span className="flex flex-wrap items-center gap-1"><button type="button" data-selection-open className="record-card-open" title="開く">{shippingSenderName(row)}</button>{renderDuplicateBadge(row)}</span></td>
                                    <td className="px-3 py-2">{renderProcessingControl(row)}</td>
                                    <td className="px-3 py-2">{renderCategoryControl(row)}</td>
                                    <td data-card-sub="" className="whitespace-nowrap px-3 py-2">{row.extracted?.issueDate ? formatDate(row.extracted.issueDate) : formatDate(row.createdAt.slice(0, 10))}</td>
                                    <td data-card-end="" data-card-hide={row.extracted?.total ? undefined : ""} className="whitespace-nowrap px-3 py-2 text-right font-mono">{row.extracted?.total ? moneyFormatter.format(row.extracted.total) : "-"}</td>
                                    <td data-card-sub="" className="max-w-[200px] px-3 py-2"><span className="flex flex-wrap items-center gap-1"><span className="truncate">{row.savedAs}</span>{row.linkBroken ? <Badge variant="destructive">参照切れ</Badge> : null}{row.fileMissing ? <Badge variant="destructive">原本なし</Badge> : null}</span></td>
                                    <td data-card-hide="" className="px-3 py-2">
                                      {row.fileUrl ? (
                                        <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><a href={row.fileUrl} target="_blank" onClick={(event) => event.stopPropagation()}>
                                          表示
                                        <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></a></Button>
                                      ) : (
                                        "-"
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr className="record-section-row">
                                <td colSpan={selection.picking ? 8 : 7} className="px-3 py-6 text-center text-xs text-muted-foreground">
                                  <span className="sticky left-3 inline-block">この月の郵便物はありません。</span>
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
                  {hasMoreListRows ? (
                    <div className="sticky left-0 flex w-full justify-center border-t bg-background p-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startFilterTransition(() => setVisibleListCount((count) => count + LIST_BATCH_SIZE))}
                      >
                        さらに表示（残り{listRows.length - renderedListRowCount}件）
                      </Button>
                    </div>
                  ) : null}
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

                <RecordDetail wide={wideList} open={detailOpen && viewMode === "list"} title={listPreviewRow ? shippingSenderName(listPreviewRow) : ""} label="開いている郵便物" resetKey={listPreviewRow?.id} className="min-w-0 rounded-xl border bg-card p-5 shadow-sm" onClose={() => setDetailOpen(false)} onPrevious={stepFrom(listRows, listPreviewRow, -1)} onNext={stepFrom(listRows, listPreviewRow, 1)}>
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
                          {renderDuplicateBadge(listPreviewRow)}
                        </div>
                      </div>

                      {isDuplicate(listPreviewRow) ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <div className="flex items-center gap-2 font-medium">
                            <AlertTriangle className="h-4 w-4" />
                            重複候補
                          </div>
                          <div className="mt-1 text-xs">{duplicateDescription(listPreviewRow)}</div>
                        </div>
                      ) : null}

                      {canEdit ? (
                        <div className="rounded-lg border">
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium"
                            onClick={() => setShowEditor((current) => !current)}
                            aria-expanded={showEditor}
                          >
                            <span className="flex items-center gap-2">
                              <Pencil className="h-4 w-4" />
                              編集
                            </span>
                            {showEditor ? <Minimize2 className="h-4 w-4 text-muted-foreground" /> : <Maximize2 className="h-4 w-4 text-muted-foreground" />}
                          </button>
                          {showEditor ? (
                            <div className="border-t p-3">
                              <DocumentEditor
                                key={listPreviewRow.id}
                                canEdit={canEdit}
                                company={company}
                                compact
                                linkTargets={linkTargets}
                                projects={projects}
                                row={listPreviewRow}
                                statusOptions={statusOptions}
                                surface="list"
                                vendors={vendors}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="grid gap-3">
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
                        <DocumentPreview company={company} compact row={listPreviewRow} />
                      </div>

                      <div className="space-y-2 rounded-lg border p-3">
                        <div className="text-sm font-medium">OCR本文</div>
                        <OcrTextPanel
                          key={listPreviewRow.id}
                          row={listPreviewRow}
                          className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-40 flex-col items-center justify-center text-sm text-muted-foreground xl:min-h-80">
                      郵便物を押すとプレビューを表示します。
                    </div>
                  )}
                </RecordDetail>
              </div>
            ) : (
            <div
              className="grid min-h-[640px] content-start overflow-clip rounded-lg border md:grid-cols-[var(--mail-folder-sender-width)_8px_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)]"
              style={folderGridStyle}
            >
              {selectedMonth ? <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2 md:col-span-3">
                <Folder className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-sm font-medium">{monthLabel(selectedMonth)}</span>
                <span className="text-xs text-muted-foreground">{activeRows.length}件</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 cursor-help text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>月のタブで切り替え。書類やファイルを月のタブへドラッグすると移動・収納できます。</TooltipContent>
                </Tooltip>
                {isMoving ? <span className="text-xs text-primary">移動中…</span> : null}
                <div className="ml-auto flex items-center gap-2">
                  <Button type="button" size="sm" variant="outline" className="h-9 gap-1" title={`${monthLabel(selectedMonth)}へファイルを収納`} disabled={!canEdit || uploadingMonth === selectedMonth} onClick={() => openFolderUpload(selectedMonth)}>
                    <UploadCloud className="h-3.5 w-3.5" />
                    {uploadingMonth === selectedMonth ? "収納中" : "収納"}
                  </Button>
                  {canEdit && customFolderMonths.has(selectedMonth) && !activeRows.length ? <form action={deleteMailFolder}>
                    <input type="hidden" name="company" value={company} />
                    <input type="hidden" name="month" value={selectedMonth} />
                    <Button type="submit" size="sm" variant="ghost" className="h-9 gap-1 text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                      このフォルダーを削除
                    </Button>
                  </form> : null}
                </div>
              </div> : null}

              {/* #11: Column 2 – Sender list */}
              <aside className="border-b p-3 md:border-b-0">
                <div className="mb-3 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                  <span className="flex items-center gap-1">
                    発送元
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3 w-3 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>押すと詳細を表示。「まとめて選択」では押すと選択、Shiftで範囲選択。ドラッグで月移動。<br />左端の色: オレンジ=未処理、緑=処理済み。</TooltipContent>
                    </Tooltip>
                  </span>
                  {selectedRows.length ? <span className="text-primary">{selectedRows.length}件選択</span> : null}
                </div>
                <div className="space-y-1">
                  {activeRows.map((row) => {
                    const isActive = row.id === activeRow?.id;
                    const isDragging = draggedIds.has(row.id);
                    return (
                      <div
                        key={row.id}
                        {...selection.rowProps(row.id)}
                        role={selection.picking ? "button" : undefined}
                        draggable={canEdit}
                        data-active={isActive ? "" : undefined}
                        className={`record-card w-full px-3 py-2.5 text-left ${processingValueForRow(row) === "processed" ? "[--card-tone:var(--color-green-500)]" : "[--card-tone:var(--color-amber-400)]"} ${isDragging ? "cursor-grabbing opacity-50" : "cursor-grab"}`}
                        onClick={(event) => {
                          if (isSelectionControl(event.target, event.currentTarget) || (selection.picking && isCardPress(event.target, event.currentTarget))) return;
                          openRow(row);
                        }}
                        onKeyDown={(event) => {
                          if (event.target === event.currentTarget && event.key === "Enter") {
                            event.preventDefault();
                            openRow(row);
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
                          {selection.picking ? <RowSelectionCheckbox selection={selection} id={row.id} label={`${shippingSenderName(row)}を選択`} /> : null}
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-col items-start gap-1">
                              <div className="flex w-full min-w-0 items-center gap-2">
                                <button type="button" data-selection-open className="record-card-open truncate text-sm font-medium" title="開く">{shippingSenderName(row)}</button>
                                {senderColumn === "normal" ? renderDuplicateBadge(row) : null}
                              </div>
                              {senderColumn === "normal" ? (
                                <div className="flex max-w-full flex-wrap items-center gap-1">
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
              <RecordDetail wide={wideFolder} open={detailOpen && viewMode === "folder"} title={activeRow ? shippingSenderName(activeRow) : ""} label="開いている郵便物" resetKey={activeRow?.id} className="min-w-0 bg-card p-5" onClose={() => setDetailOpen(false)} onPrevious={stepFrom(activeRows, activeRow, -1)} onNext={stepFrom(activeRows, activeRow, 1)}>
                {activeRow ? (
                  <div key={activeRow.id} className="space-y-6">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                      <div className="min-w-0">
                        <div className="text-lg font-medium">{shippingSenderName(activeRow)}</div>
                        <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{activeRow.ocrPreview}</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {renderDuplicateBadge(activeRow)}
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

                    <form id={`ocr-edit-${activeRow.id}`} action={updateOcrDocumentInline} onSubmit={detailSave.onSubmit} />
                    <input type="hidden" form={`ocr-edit-${activeRow.id}`} name="company" value={company} />
                    {activeRow.mailDocumentId ? <input type="hidden" form={`ocr-edit-${activeRow.id}`} name="mailDocumentId" value={activeRow.mailDocumentId} /> : null}
                    {activeRow.receivedInvoiceId ? (
                      <input type="hidden" form={`ocr-edit-${activeRow.id}`} name="receivedInvoiceId" value={activeRow.receivedInvoiceId} />
                    ) : null}


                    <div className="space-y-4">
                      {isDuplicate(activeRow) ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <div className="flex items-center gap-2 font-medium">
                            <AlertTriangle className="h-4 w-4" />
                            重複候補
                          </div>
                          <div className="mt-1 text-xs">{duplicateDescription(activeRow)}</div>
                        </div>
                      ) : null}
                      <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
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
                            <Link href={`/projects/${activeRow.extracted.projectId}?company=${company}`} prefetch={false}>案件を開く</Link>
                          </Button>
                        ) : null}
                        <div className="space-y-2">
                          <div className="text-sm font-medium">OCR本文</div>
                          <OcrTextPanel
                            key={activeRow.id}
                            row={activeRow}
                            className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5"
                          />
                        </div>
                      </div>

                      <div className="min-w-0 space-y-4 rounded-xl border bg-card p-5 shadow-sm">
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
                        <DocumentPreview company={company} compact row={activeRow} />
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
                        <OperationError message={detailSave.feedback?.formId === `ocr-edit-${activeRow.id}` && detailSave.feedback.error ? detailSave.feedback.message : undefined} />
                        <div className="mb-3 flex items-center justify-end gap-3">
                          <Button type="submit" form={`ocr-edit-${activeRow.id}`} disabled={!canEdit || (company === "JAPAN" && detailSave.pending)} size="sm" className="gap-1">
                            <OperationPending pending={company === "JAPAN" && detailSave.pending}><Save className="h-4 w-4" />保存</OperationPending>
                          </Button>
                        </div>
                        <div className="grid gap-4 xl:grid-cols-2">
                        <div className="workspace-detail-group space-y-3"><h3 className="text-sm font-semibold">基本情報・連携</h3>
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
                              {activeRow.mailDocumentId && activeRow.receivedInvoiceId ? <MailUnlinkButton company={company} mailDocumentId={activeRow.mailDocumentId} mailUpdatedAt={activeRow.mailUpdatedAt} disabled={!canEdit} /> : null}
                            </>
                          ) : null}
                        </div>

                        <div className="workspace-detail-group space-y-3"><h3 className="text-sm font-semibold">金額・支払</h3>
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
                              <div className="col-span-2 space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">合計</label>
                                <Input form={`ocr-edit-${activeRow.id}`} name="total" type="number" defaultValue={activeRow.extracted.total} disabled={!canEdit} className="font-mono" />
                              </div>
                            </div>
                          ) : (
                            /* #26: Default values from OCR extraction when available */
                            <>
                            {activeRow.mailDocumentId ? <MailInvoiceReflectionForm company={company} key={activeRow.id} mailDocumentId={activeRow.mailDocumentId} mailUpdatedAt={activeRow.mailUpdatedAt} defaults={activeRow.reflectDefaults} vendors={vendors} projects={projects} statusOptions={statusOptions} broken={activeRow.linkBroken} disabled={!canEdit} /> : null}
                            {activeRow.mailDocumentId ? <MailRelinkForm company={company} mailDocumentId={activeRow.mailDocumentId} mailUpdatedAt={activeRow.mailUpdatedAt} candidates={activeRow.linkCandidates ?? []} targets={linkTargets} broken={activeRow.linkBroken} brokenTargetId={activeRow.brokenTargetId} disabled={!canEdit} /> : null}
                            </>
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
              </RecordDetail>
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
        </div>
      </section>
      <Dialog open={folderCreateOpen} onOpenChange={(open) => { if (!creatingFolder) setFolderCreateOpen(open); }}>
        <DialogContent showCloseButton={!creatingFolder} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
          <DialogHeader><DialogTitle>月フォルダーを作成</DialogTitle><DialogDescription>作成する年月を選択してください。</DialogDescription></DialogHeader>
          <form action={(formData) => startCreateFolder(async () => {
            setFolderError("");
            try { await createMailFolder(formData); setFolderCreateOpen(false); setNewFolderMonth(""); toast({ title: "月フォルダーを作成しました", variant: "success" }); }
            catch { setFolderError("フォルダーを作成できませんでした。年月と権限を確認してください。"); }
          })} className="grid gap-4">
            <input type="hidden" name="company" value={company} />
            <label className="grid gap-2 text-sm">年月<Input name="month" type="month" value={newFolderMonth} onChange={(event) => setNewFolderMonth(event.target.value)} className="min-h-11 lg:min-h-11" required disabled={creatingFolder} /></label>
            {folderError ? <p role="alert" className="text-sm text-destructive">{folderError}</p> : null}
            <Button type="submit" className="min-h-11 lg:min-h-11" disabled={creatingFolder}><OperationPending pending={company === "JAPAN" && creatingFolder}>{creatingFolder ? <LoaderCircle className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}作成</OperationPending></Button>
          </form>
        </DialogContent>
      </Dialog>

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
                      <Link href={`/projects/${dialogRow.extracted.projectId}?company=${company}`} prefetch={false}>案件を開く</Link>
                    </Button>
                  ) : null}
                  <div className="space-y-2">
                    <div className="text-sm font-medium">OCR本文</div>
                    <OcrTextPanel
                      key={dialogRow.id}
                      row={dialogRow}
                      className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5"
                    />
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
                  <DocumentPreview company={company} row={dialogRow} />
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
