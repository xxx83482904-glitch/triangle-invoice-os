import Link from "next/link";
import { MailSorterDropzone } from "@/app/mail-sorter/mail-sorter-dropzone";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany } from "@/lib/company";
import { formatDate, yen } from "@/lib/format";
import { can } from "@/lib/rbac";
import { readData } from "@/lib/store";
import type { MailDocumentCategory, ReceivedInvoice } from "@/lib/types";

const categoryLabels: Record<MailDocumentCategory, string> = {
  INVOICE: "請求書",
  CONTRACT: "契約書",
  ESTIMATE: "見積書",
  DELIVERY_NOTE: "納品書",
  RECEIPT: "領収書",
  NOTICE: "通知",
  OTHER: "その他",
};

type OcrDocumentRow = {
  category: MailDocumentCategory;
  confidence?: number;
  createdAt: string;
  fileName: string;
  fileUrl?: string;
  id: string;
  memo?: string;
  ocrText?: string;
  receivedInvoice?: ReceivedInvoice;
  source: "mail-sorter" | "received-invoice";
};

function ocrPreview(text?: string) {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "OCR本文はまだありません。";
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function extractedSummary(row: OcrDocumentRow, data: Awaited<ReturnType<typeof readData>>, company: string) {
  if (!row.receivedInvoice) {
    return (
      <div className="space-y-1 text-sm">
        <div className="text-muted-foreground">{row.memo || "分類のみ保存されています。"}</div>
      </div>
    );
  }

  const invoice = row.receivedInvoice;
  const vendor = data.vendors.find((item) => item.id === invoice.vendorId);
  const project = data.projects.find((item) => item.id === invoice.projectId);

  return (
    <div className="space-y-1 text-sm">
      <div className="font-medium">{vendor?.companyName ?? "支払先未設定"}</div>
      <div>
        {project ? (
          <Link className="underline underline-offset-2" href={`/projects/${project.id}?company=${company}`}>
            {project.name}
          </Link>
        ) : (
          "案件未設定"
        )}
      </div>
      <div className="text-muted-foreground">
        {formatDate(invoice.issueDate)} / 期限 {formatDate(invoice.dueDate)}
      </div>
      <div className="font-mono font-medium">{yen.format(invoice.total)}</div>
    </div>
  );
}

export default async function MailSorterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  const data = await readData();
  const mayUpload = user && (can(user, "manage:receivedInvoices") || can(user, "upload:receivedInvoices"));
  const projects = data.projects.filter((project) => !project.deletedAt && matchesCompany(project, company));
  const projectIds = new Set(projects.map((project) => project.id));

  const mailDocuments = data.mailDocuments
    .filter((document) => !document.deletedAt && companyFromParam(document.company) === company)
    .map<OcrDocumentRow>((document) => ({
      category: document.category,
      confidence: document.confidence,
      createdAt: document.createdAt,
      fileName: document.originalFileName,
      fileUrl: document.fileUrl,
      id: document.id,
      memo: document.memo,
      ocrText: document.ocrText,
      receivedInvoice: document.relatedReceivedInvoiceId
        ? data.receivedInvoices.find((invoice) => invoice.id === document.relatedReceivedInvoiceId)
        : undefined,
      source: "mail-sorter",
    }));

  const linkedReceivedInvoiceIds = new Set(mailDocuments.map((document) => document.receivedInvoice?.id).filter(Boolean));
  const directReceivedInvoices = data.receivedInvoices
    .filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId) && invoice.ocrText && !linkedReceivedInvoiceIds.has(invoice.id))
    .map<OcrDocumentRow>((invoice) => ({
      category: "INVOICE",
      createdAt: invoice.createdAt,
      fileName: invoice.originalFileName ?? "受領請求書",
      fileUrl: invoice.fileUrl,
      id: invoice.id,
      memo: invoice.memo,
      ocrText: invoice.ocrText,
      receivedInvoice: invoice,
      source: "received-invoice",
    }));

  const rows = [...mailDocuments, ...directReceivedInvoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <AppShell>
      <PageHeader
        title="OCR書類一覧"
        description="アップロードした郵便物・請求書・契約書のOCR結果を一覧で確認します。請求書は抽出された支払先、案件、日付、金額も表示します。"
      >
        <Button asChild variant="outline">
          <Link href={`/received-invoices?company=${company}`}>受領請求書を見る</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-4">
          {mayUpload ? <MailSorterDropzone company={company} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>OCRの流れ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div>Google Vision OCRで文字を読み取り、AIで書類種別と主要項目を分類します。</div>
              <div>請求書は受領請求書として保存され、その他の書類はこの一覧に保管されます。</div>
              <div>AIの読み取り結果は下書き扱いです。金額や期限は保存前に確認してください。</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>OCRした書類</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">登録日</TableHead>
                  <TableHead className="w-24">種別</TableHead>
                  <TableHead>ファイル / OCR内容</TableHead>
                  <TableHead className="w-60">抽出内容</TableHead>
                  <TableHead className="w-24">保存先</TableHead>
                  <TableHead className="w-20">表示</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.source}-${row.id}`} className="align-top">
                    <TableCell className="whitespace-nowrap">{formatDate(row.createdAt.slice(0, 10))}</TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <Badge variant={row.category === "INVOICE" ? "default" : "secondary"}>{categoryLabels[row.category]}</Badge>
                        <div className="text-xs text-muted-foreground">{row.confidence ? `${row.confidence}%` : "-"}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[460px] space-y-2">
                        <div className="truncate font-medium">{row.fileName}</div>
                        <div className="max-h-12 overflow-hidden text-sm leading-6 text-muted-foreground">{ocrPreview(row.ocrText)}</div>
                        {row.ocrText ? (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer underline underline-offset-2">OCR全文を表示</summary>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-xs leading-5">
                              {row.ocrText}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{extractedSummary(row, data, company)}</TableCell>
                    <TableCell>
                      {row.receivedInvoice ? (
                        <Link className="text-sm underline underline-offset-2" href={`/received-invoices?company=${company}`}>
                          受領請求書
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">その他書類</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.fileUrl ? (
                        <a className="text-sm underline underline-offset-2" href={row.fileUrl} target="_blank">
                          表示
                        </a>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      まだOCRした書類はありません。
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
