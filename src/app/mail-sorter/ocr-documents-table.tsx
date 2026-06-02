"use client";

import Link from "next/link";
import { ExternalLink, FileText, Folder, FolderOpen, Image as ImageIcon, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { updateOcrDocumentInline } from "@/app/actions";
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
  id: string;
  mailDocumentId?: string;
  memo?: string;
  mimeType?: string;
  ocrPreview: string;
  ocrText?: string;
  receivedInvoiceId?: string;
  savedAs: string;
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

function selectClass(extra = "") {
  return `h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${extra}`;
}

function summaryLines(row: OcrDocumentListItem) {
  const lines = [`種別: ${categoryLabels[row.category]}`, `保存先: ${row.savedAs}`];
  if (row.extracted) {
    lines.push(`支払先: ${row.extracted.vendorName}`);
    lines.push(`案件: ${row.extracted.projectName}`);
    lines.push(`請求日: ${formatDate(row.extracted.issueDate)}`);
    lines.push(`支払期限: ${formatDate(row.extracted.dueDate)}`);
    lines.push(`税抜: ${moneyFormatter.format(row.extracted.subtotal)}`);
    lines.push(`消費税: ${moneyFormatter.format(row.extracted.taxTotal)}`);
    lines.push(`合計: ${moneyFormatter.format(row.extracted.total)}`);
  }
  if (row.confidence) lines.push(`信頼度: ${row.confidence}%`);
  if (row.memo) lines.push(`メモ: ${row.memo.split("\n").filter(Boolean).slice(0, 2).join(" / ")}`);
  return lines;
}

function DocumentPreview({ row }: { row: OcrDocumentListItem }) {
  if (!row.fileUrl) {
    return <div className="flex h-full min-h-80 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">ファイルがありません。</div>;
  }

  if (row.mimeType?.startsWith("image/")) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center overflow-hidden rounded-md bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.fileUrl} alt={row.fileName} className="max-h-full w-full object-contain" />
      </div>
    );
  }

  if (row.mimeType === "application/pdf") {
    return <iframe title={row.fileName} src={row.fileUrl} className="h-[68vh] min-h-96 w-full rounded-md border bg-muted" />;
  }

  return (
    <div className="flex h-full min-h-80 items-center justify-center rounded-md bg-muted">
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

function FileIcon({ category }: { category: MailDocumentCategory }) {
  return category === "INVOICE" ? (
    <FileText className="h-5 w-5 text-primary" />
  ) : (
    <FileText className="h-5 w-5 text-muted-foreground" />
  );
}

export function OcrDocumentsTable({
  canEdit,
  company,
  projects,
  rows,
  statusOptions,
  vendors,
}: {
  canEdit: boolean;
  company: CompanyScope;
  projects: Option[];
  rows: OcrDocumentListItem[];
  statusOptions: Option[];
  vendors: Option[];
}) {
  const [selected, setSelected] = useState<OcrDocumentListItem | null>(null);
  const groups = useMemo(() => {
    const grouped = new Map<string, OcrDocumentListItem[]>();
    for (const row of rows) {
      const key = monthKey(row.createdAt);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);
  const [activeMonth, setActiveMonth] = useState<string | null>(groups[0]?.[0] ?? null);

  const activeRows = groups.find(([month]) => month === activeMonth)?.[1] ?? [];
  const activeInvoiceCount = activeRows.filter((row) => row.category === "INVOICE").length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>郵便物フォルダー</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <div className="grid min-h-[640px] gap-4 lg:grid-cols-[260px_1fr]">
              <aside className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-3 px-2 text-xs font-medium text-muted-foreground">月別フォルダー</div>
                <div className="space-y-2">
                  {groups.map(([month, monthRows]) => {
                    const isActive = month === activeMonth;
                    const invoiceCount = monthRows.filter((row) => row.category === "INVOICE").length;
                    return (
                      <button
                        key={month}
                        type="button"
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition ${
                          isActive ? "border-primary bg-background shadow-sm" : "border-transparent hover:bg-background"
                        }`}
                        onClick={() => setActiveMonth(month)}
                      >
                        {isActive ? <FolderOpen className="h-6 w-6 text-primary" /> : <Folder className="h-6 w-6 text-muted-foreground" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{monthLabel(month)}</div>
                          <div className="mt-1 flex gap-1">
                            <Badge variant="outline">{monthRows.length}件</Badge>
                            {invoiceCount ? <Badge>{invoiceCount}請求書</Badge> : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="min-w-0 rounded-lg border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-5 w-5 text-primary" />
                    <div>
                      <div className="font-medium">{activeMonth ? monthLabel(activeMonth) : "フォルダー未選択"}</div>
                      <div className="text-xs text-muted-foreground">ファイルを選んで内容確認、欄を編集して保存できます。</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{activeRows.length}件</Badge>
                    {activeInvoiceCount ? <Badge>{activeInvoiceCount}請求書</Badge> : null}
                  </div>
                </div>

                <div className="space-y-3 p-3">
                  {activeRows.map((row) => (
                    <div
                      key={row.id}
                      className="rounded-lg border bg-background p-3 transition hover:bg-muted/30"
                      onClick={() => setSelected(row)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") setSelected(row);
                      }}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <FileIcon category={row.category} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{row.fileName}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{row.ocrPreview}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge variant={row.category === "INVOICE" ? "default" : "secondary"}>{categoryLabels[row.category]}</Badge>
                          <span className="text-xs text-muted-foreground">{formatDate(row.createdAt.slice(0, 10))}</span>
                        </div>
                      </div>

                      <div onClick={stopEditClick}>
                        <form id={`ocr-edit-${row.id}`} action={updateOcrDocumentInline} />
                        <input type="hidden" form={`ocr-edit-${row.id}`} name="company" value={company} />
                        {row.mailDocumentId ? <input type="hidden" form={`ocr-edit-${row.id}`} name="mailDocumentId" value={row.mailDocumentId} /> : null}
                        {row.receivedInvoiceId ? <input type="hidden" form={`ocr-edit-${row.id}`} name="receivedInvoiceId" value={row.receivedInvoiceId} /> : null}

                        <div className="grid gap-3 xl:grid-cols-[1fr_1.2fr_1.2fr_0.9fr_112px]">
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">ファイル名 / 分類</label>
                            <Input form={`ocr-edit-${row.id}`} name="fileName" defaultValue={row.fileName} disabled={!canEdit || !row.mailDocumentId} />
                            {row.mailDocumentId ? (
                              <select form={`ocr-edit-${row.id}`} name="category" defaultValue={row.category} className={selectClass()} disabled={!canEdit}>
                                {categoryOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input form={`ocr-edit-${row.id}`} type="hidden" name="category" value={row.category} />
                            )}
                          </div>

                          {row.extracted ? (
                            <>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">支払先 / 案件 / 状態</label>
                                <select form={`ocr-edit-${row.id}`} name="vendorId" defaultValue={row.extracted.vendorId} className={selectClass()} disabled={!canEdit}>
                                  {vendors.map((vendor) => (
                                    <option key={vendor.value} value={vendor.value}>
                                      {vendor.label}
                                    </option>
                                  ))}
                                </select>
                                <select form={`ocr-edit-${row.id}`} name="projectId" defaultValue={row.extracted.projectId} className={selectClass()} disabled={!canEdit}>
                                  {projects.map((project) => (
                                    <option key={project.value} value={project.value}>
                                      {project.label}
                                    </option>
                                  ))}
                                </select>
                                <select form={`ocr-edit-${row.id}`} name="status" defaultValue={row.extracted.status ?? "REVIEWING"} className={selectClass()} disabled={!canEdit}>
                                  {statusOptions.map((status) => (
                                    <option key={status.value} value={status.value}>
                                      {status.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs font-medium text-muted-foreground">日付 / 金額</label>
                                <div className="grid grid-cols-2 gap-2">
                                  <Input form={`ocr-edit-${row.id}`} name="issueDate" type="date" defaultValue={row.extracted.issueDate} disabled={!canEdit} />
                                  <Input form={`ocr-edit-${row.id}`} name="dueDate" type="date" defaultValue={row.extracted.dueDate} disabled={!canEdit} />
                                  <Input form={`ocr-edit-${row.id}`} name="subtotal" type="number" defaultValue={row.extracted.subtotal} disabled={!canEdit} />
                                  <Input form={`ocr-edit-${row.id}`} name="taxTotal" type="number" defaultValue={row.extracted.taxTotal} disabled={!canEdit} />
                                  <Input
                                    form={`ocr-edit-${row.id}`}
                                    name="total"
                                    type="number"
                                    defaultValue={row.extracted.total}
                                    disabled={!canEdit}
                                    className="col-span-2 font-mono"
                                  />
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground xl:col-span-2">その他書類として保存されています。</div>
                            </>
                          )}

                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">メモ</label>
                            <Textarea form={`ocr-edit-${row.id}`} name="memo" defaultValue={row.memo ?? ""} disabled={!canEdit} className="min-h-28" />
                          </div>

                          <div className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-muted-foreground">操作</label>
                            <Button type="submit" form={`ocr-edit-${row.id}`} size="sm" disabled={!canEdit} className="gap-1">
                              <Save className="h-4 w-4" />
                              保存
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => setSelected(row)}>
                              詳細
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">まだOCRした書類はありません。</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[92vh] max-w-[min(1200px,calc(100vw-2rem))] overflow-hidden">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.fileName}</DialogTitle>
                <DialogDescription>
                  {categoryLabels[selected.category]} / {formatDate(selected.createdAt.slice(0, 10))}
                </DialogDescription>
              </DialogHeader>
              <div className="grid min-h-0 gap-4 lg:grid-cols-[360px_1fr]">
                <div className="min-h-0 space-y-4 overflow-auto rounded-md border p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="h-4 w-4" />
                    内容の要約
                  </div>
                  <dl className="space-y-2 text-sm">
                    {summaryLines(selected).map((line) => {
                      const [label, ...rest] = line.split(": ");
                      return (
                        <div key={line} className="grid grid-cols-[80px_1fr] gap-3">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="whitespace-pre-wrap">{rest.join(": ")}</dd>
                        </div>
                      );
                    })}
                  </dl>
                  {selected.extracted?.projectId ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/projects/${selected.extracted.projectId}?company=${company}`}>案件を開く</Link>
                    </Button>
                  ) : null}
                  <div className="space-y-2">
                    <div className="text-sm font-medium">OCR本文</div>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                      {selected.ocrText || "OCR本文はありません。"}
                    </pre>
                  </div>
                </div>
                <div className="min-h-0 space-y-3 overflow-hidden rounded-md border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ImageIcon className="h-4 w-4" />
                      画面キャプチャー / プレビュー
                    </div>
                    {selected.fileUrl ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={selected.fileUrl} target="_blank">
                          <ExternalLink className="h-4 w-4" />
                          別画面
                        </a>
                      </Button>
                    ) : null}
                  </div>
                  <DocumentPreview row={selected} />
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
