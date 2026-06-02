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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

function nativeSelectClass(extra = "") {
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
    lines.push(`金額: ${moneyFormatter.format(row.extracted.total)}`);
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
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map(([month]) => [month, true])),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>月別フォルダー</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.map(([month, monthRows]) => {
            const isOpen = openFolders[month] ?? true;
            const invoiceCount = monthRows.filter((row) => row.category === "INVOICE").length;
            return (
              <section key={month} className="overflow-hidden rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 bg-muted/50 px-4 py-3 text-left hover:bg-muted"
                  onClick={() => setOpenFolders((current) => ({ ...current, [month]: !isOpen }))}
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? <FolderOpen className="h-5 w-5 text-primary" /> : <Folder className="h-5 w-5 text-muted-foreground" />}
                    <span className="font-medium">{monthLabel(month)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{monthRows.length}件</Badge>
                    {invoiceCount ? <Badge>{invoiceCount}請求書</Badge> : null}
                  </div>
                </button>

                {isOpen ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-24">登録日</TableHead>
                          <TableHead className="min-w-48">書類</TableHead>
                          <TableHead className="min-w-44">分類</TableHead>
                          <TableHead className="min-w-64">支払先 / 案件</TableHead>
                          <TableHead className="min-w-64">日付 / 金額</TableHead>
                          <TableHead className="min-w-56">メモ</TableHead>
                          <TableHead className="w-28">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {monthRows.map((row) => (
                          <TableRow
                            key={row.id}
                            className="cursor-pointer align-top hover:bg-muted/40"
                            onClick={() => setSelected(row)}
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") setSelected(row);
                            }}
                          >
                            <TableCell className="whitespace-nowrap">{formatDate(row.createdAt.slice(0, 10))}</TableCell>
                            <TableCell>
                              <div className="space-y-2" onClick={stopEditClick}>
                                <input type="hidden" form={`ocr-edit-${row.id}`} name="company" value={company} />
                                {row.mailDocumentId ? <input type="hidden" form={`ocr-edit-${row.id}`} name="mailDocumentId" value={row.mailDocumentId} /> : null}
                                {row.receivedInvoiceId ? (
                                  <input type="hidden" form={`ocr-edit-${row.id}`} name="receivedInvoiceId" value={row.receivedInvoiceId} />
                                ) : null}
                                <Input
                                  form={`ocr-edit-${row.id}`}
                                  name="fileName"
                                  defaultValue={row.fileName}
                                  disabled={!canEdit || !row.mailDocumentId}
                                />
                                <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">{row.ocrPreview}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-2" onClick={stopEditClick}>
                                {row.mailDocumentId ? (
                                  <select
                                    form={`ocr-edit-${row.id}`}
                                    name="category"
                                    defaultValue={row.category}
                                    className={nativeSelectClass()}
                                    disabled={!canEdit}
                                  >
                                    {categoryOptions.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <>
                                    <input form={`ocr-edit-${row.id}`} type="hidden" name="category" value={row.category} />
                                    <Badge>{categoryLabels[row.category]}</Badge>
                                  </>
                                )}
                                <div className="text-xs text-muted-foreground">{row.confidence ? `信頼度 ${row.confidence}%` : "信頼度 -"}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {row.extracted ? (
                                <div className="space-y-2" onClick={stopEditClick}>
                                  <select
                                    form={`ocr-edit-${row.id}`}
                                    name="vendorId"
                                    defaultValue={row.extracted.vendorId}
                                    className={nativeSelectClass()}
                                    disabled={!canEdit}
                                  >
                                    {vendors.map((vendor) => (
                                      <option key={vendor.value} value={vendor.value}>
                                        {vendor.label}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    form={`ocr-edit-${row.id}`}
                                    name="projectId"
                                    defaultValue={row.extracted.projectId}
                                    className={nativeSelectClass()}
                                    disabled={!canEdit}
                                  >
                                    {projects.map((project) => (
                                      <option key={project.value} value={project.value}>
                                        {project.label}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    form={`ocr-edit-${row.id}`}
                                    name="status"
                                    defaultValue={row.extracted.status ?? "REVIEWING"}
                                    className={nativeSelectClass()}
                                    disabled={!canEdit}
                                  >
                                    {statusOptions.map((status) => (
                                      <option key={status.value} value={status.value}>
                                        {status.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <div className="text-sm text-muted-foreground">その他書類</div>
                              )}
                            </TableCell>
                            <TableCell>
                              {row.extracted ? (
                                <div className="grid grid-cols-2 gap-2" onClick={stopEditClick}>
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
                              ) : (
                                <div className="text-sm text-muted-foreground">-</div>
                              )}
                            </TableCell>
                            <TableCell onClick={stopEditClick}>
                              <Textarea form={`ocr-edit-${row.id}`} name="memo" defaultValue={row.memo ?? ""} disabled={!canEdit} className="min-h-24" />
                            </TableCell>
                            <TableCell onClick={stopEditClick}>
                              <form id={`ocr-edit-${row.id}`} action={updateOcrDocumentInline} className="space-y-2">
                                <Button type="submit" size="sm" disabled={!canEdit} className="w-full gap-1">
                                  <Save className="h-4 w-4" />
                                  保存
                                </Button>
                                <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setSelected(row)}>
                                  詳細
                                </Button>
                              </form>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </section>
            );
          })}
          {!rows.length ? <div className="py-12 text-center text-sm text-muted-foreground">まだOCRした書類はありません。</div> : null}
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
