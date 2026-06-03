"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Folder, Image as ImageIcon, Maximize2, Minimize2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { createMailFolder, deleteMailFolder, deleteOcrDocument, moveOcrDocumentToMonth, updateOcrDocumentInline } from "@/app/actions";
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
  company,
  projects,
  rows,
  statusOptions,
  vendors,
  folders,
}: {
  canEdit: boolean;
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
  const groups = useMemo(() => {
    const grouped = new Map<string, OcrDocumentListItem[]>();
    for (const row of rows) {
      const key = row.folderMonth || monthKey(row.createdAt);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    for (const folder of folders) {
      if (!grouped.has(folder.month)) grouped.set(folder.month, []);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [folders, rows]);
  const customFolderMonths = useMemo(() => new Set(folders.map((folder) => folder.month)), [folders]);
  const [activeMonth, setActiveMonth] = useState<string | null>(groups[0]?.[0] ?? null);
  const activeRows = groups.find(([month]) => month === activeMonth)?.[1] ?? [];
  const [activeRowId, setActiveRowId] = useState<string | null>(activeRows[0]?.id ?? null);
  const activeRow = activeRows.find((row) => row.id === activeRowId) ?? activeRows[0] ?? null;
  const [dialogRow, setDialogRow] = useState<OcrDocumentListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OcrDocumentListItem | null>(null);
  const [monthColumn, setMonthColumn] = useState<ColumnMode>("normal");
  const [senderColumn, setSenderColumn] = useState<ColumnMode>("normal");
  const [showEditor, setShowEditor] = useState(false);

  const chooseMonth = (month: string, monthRows: OcrDocumentListItem[]) => {
    setActiveMonth(month);
    setActiveRowId(monthRows[0]?.id ?? null);
  };

  const openDropzone = () => {
    document.getElementById("mail-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const moveRowToMonth = (row: OcrDocumentListItem | null, targetMonth: string) => {
    if (!row || !canEdit) return;
    const sourceMonth = row.folderMonth || monthKey(row.createdAt);
    if (sourceMonth === targetMonth) return;
    const formData = new FormData();
    formData.set("company", company);
    formData.set("targetMonth", targetMonth);
    if (row.mailDocumentId) formData.set("mailDocumentId", row.mailDocumentId);
    if (row.receivedInvoiceId) formData.set("receivedInvoiceId", row.receivedInvoiceId);
    startMoveTransition(async () => {
      await moveOcrDocumentToMonth(formData);
      setActiveMonth(targetMonth);
      setActiveRowId(row.id);
      setDraggedRow(null);
      router.refresh();
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>郵便物フォルダー</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">追加・変更・削除と、カラム幅の切り替えができます。</div>
          </div>
          <div className="flex flex-wrap gap-2">
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
        <CardContent>
          {groups.length ? (
            <div className={`grid min-h-[640px] overflow-hidden rounded-lg border ${folderGridColumns[monthColumn][senderColumn]}`}>
              <aside className="border-b bg-muted/20 p-3 lg:border-r lg:border-b-0">
                <div className="mb-3 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                  <span>{monthColumn === "compact" ? "月" : "月フォルダー"}</span>
                  {isMoving ? <span className="text-primary">移動中</span> : null}
                </div>
                <div className="space-y-2">
                  {groups.map(([month, monthRows]) => {
                    const isActive = month === activeMonth;
                    const canDeleteFolder = canEdit && customFolderMonths.has(month) && monthRows.length === 0;
                    return (
                      <div key={month} className="group relative">
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
                            <div className="mt-1 text-xs text-muted-foreground">{monthColumn === "compact" ? monthRows.length : `${monthRows.length}件`}</div>
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

              <aside className="border-b p-3 lg:border-r lg:border-b-0">
                <div className="mb-3 text-xs font-medium text-muted-foreground">発送元</div>
                <div className="space-y-2">
                  {activeRows.map((row) => {
                    const isActive = row.id === activeRow?.id;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        draggable={canEdit}
                        className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                          isActive ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"
                        } ${draggedRow?.id === row.id ? "cursor-grabbing opacity-60" : "cursor-grab"}`}
                        onClick={() => setActiveRowId(row.id)}
                        onDragStart={(event) => {
                          setDraggedRow(row);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", row.id);
                        }}
                        onDragEnd={() => setDraggedRow(null)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-medium">{shippingSenderName(row)}</div>
                          {senderColumn === "normal" ? <Badge variant={row.category === "INVOICE" ? "default" : "secondary"}>{categoryLabels[row.category]}</Badge> : null}
                        </div>
                        {senderColumn === "normal" ? <div className="mt-1 truncate text-xs text-muted-foreground">{formatDate(row.createdAt.slice(0, 10))}</div> : null}
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="min-w-0 p-4">
                {activeRow ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                      <div>
                        <div className="text-lg font-medium">{shippingSenderName(activeRow)}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{activeRow.ocrPreview}</div>
                      </div>
                      <div className="flex gap-2">
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

                    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
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
                          <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">その他書類として保存されています。</div>
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
        <DialogContent className="max-h-[92vh] max-w-[min(1200px,calc(100vw-2rem))] overflow-hidden">
          {dialogRow ? (
            <>
              <DialogHeader>
                <DialogTitle>{shippingSenderName(dialogRow)}</DialogTitle>
                <DialogDescription>
                  {categoryLabels[dialogRow.category]} / {formatDate(dialogRow.createdAt.slice(0, 10))}
                </DialogDescription>
              </DialogHeader>
              <div className="grid min-h-0 gap-4 lg:grid-cols-[360px_1fr]">
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
