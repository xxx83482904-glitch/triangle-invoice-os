"use client";

import Link from "next/link";
import { ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompanyScope } from "@/lib/company";
import type { MailDocumentCategory } from "@/lib/types";

export type OcrDocumentListItem = {
  category: MailDocumentCategory;
  confidence?: number;
  createdAt: string;
  extracted?: {
    dueDate: string;
    issueDate: string;
    projectId?: string;
    projectName: string;
    total: number;
    vendorName: string;
  };
  fileName: string;
  fileUrl?: string;
  id: string;
  memo?: string;
  mimeType?: string;
  ocrPreview: string;
  ocrText?: string;
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

function summaryLines(row: OcrDocumentListItem) {
  const lines = [`種別: ${categoryLabels[row.category]}`, `保存先: ${row.savedAs}`];
  if (row.extracted) {
    lines.push(`支払先: ${row.extracted.vendorName}`);
    lines.push(`案件: ${row.extracted.projectName}`);
    lines.push(`請求日: ${formatDate(row.extracted.issueDate)}`);
    lines.push(`支払期限: ${formatDate(row.extracted.dueDate)}`);
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

export function OcrDocumentsTable({ company, rows }: { company: CompanyScope; rows: OcrDocumentListItem[] }) {
  const [selected, setSelected] = useState<OcrDocumentListItem | null>(null);
  const groups = useMemo(() => {
    const grouped = new Map<string, OcrDocumentListItem[]>();
    for (const row of rows) {
      const key = monthKey(row.createdAt);
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>OCRした書類</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {groups.map(([month, monthRows]) => (
            <section key={month} className="space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-base font-medium">{monthLabel(month)}</h2>
                <Badge variant="outline">{monthRows.length}件</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">登録日</TableHead>
                    <TableHead className="w-24">種別</TableHead>
                    <TableHead>ファイル / OCR内容</TableHead>
                    <TableHead className="w-56">抽出内容</TableHead>
                    <TableHead className="w-24">保存先</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer align-top hover:bg-muted/60"
                      onClick={() => setSelected(row)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") setSelected(row);
                      }}
                    >
                      <TableCell className="whitespace-nowrap">{formatDate(row.createdAt.slice(0, 10))}</TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <Badge variant={row.category === "INVOICE" ? "default" : "secondary"}>{categoryLabels[row.category]}</Badge>
                          <div className="text-xs text-muted-foreground">{row.confidence ? `${row.confidence}%` : "-"}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[460px] space-y-1">
                          <div className="truncate font-medium">{row.fileName}</div>
                          <div className="line-clamp-2 text-sm leading-6 text-muted-foreground">{row.ocrPreview}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.extracted ? (
                          <div className="space-y-1 text-sm">
                            <div className="font-medium">{row.extracted.vendorName}</div>
                            <div className="truncate text-muted-foreground">{row.extracted.projectName}</div>
                            <div className="font-mono">{moneyFormatter.format(row.extracted.total)}</div>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">{row.memo || "分類のみ保存"}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.savedAs}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
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
