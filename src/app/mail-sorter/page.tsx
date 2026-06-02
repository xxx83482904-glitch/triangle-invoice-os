import Link from "next/link";
import { MailSorterDropzone } from "@/app/mail-sorter/mail-sorter-dropzone";
import { OcrDocumentsTable, type OcrDocumentListItem } from "@/app/mail-sorter/ocr-documents-table";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany } from "@/lib/company";
import { can } from "@/lib/rbac";
import { readData } from "@/lib/store";

function cleanText(value?: string) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function previewText(value?: string, limit = 180) {
  const text = cleanText(value);
  if (!text) return "OCR本文はまだありません。";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
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
    .map<OcrDocumentListItem>((document) => {
      const invoice = document.relatedReceivedInvoiceId
        ? data.receivedInvoices.find((item) => item.id === document.relatedReceivedInvoiceId)
        : undefined;
      const vendor = invoice ? data.vendors.find((item) => item.id === invoice.vendorId) : undefined;
      const project = invoice ? data.projects.find((item) => item.id === invoice.projectId) : undefined;

      return {
        category: document.category,
        confidence: document.confidence,
        createdAt: document.createdAt,
        extracted: invoice
          ? {
              dueDate: invoice.dueDate,
              issueDate: invoice.issueDate,
              projectId: project?.id,
              projectName: project?.name ?? "案件未設定",
              total: invoice.total,
              vendorName: vendor?.companyName ?? "支払先未設定",
            }
          : undefined,
        fileName: document.originalFileName,
        fileUrl: document.fileUrl,
        id: `mail-${document.id}`,
        memo: document.memo,
        mimeType: document.mimeType,
        ocrPreview: previewText(document.ocrText),
        ocrText: document.ocrText,
        savedAs: invoice ? "受領請求書" : "その他書類",
      };
    });

  const linkedReceivedInvoiceIds = new Set(
    data.mailDocuments.map((document) => document.relatedReceivedInvoiceId).filter((id): id is string => Boolean(id)),
  );
  const directReceivedInvoices = data.receivedInvoices
    .filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId) && invoice.ocrText && !linkedReceivedInvoiceIds.has(invoice.id))
    .map<OcrDocumentListItem>((invoice) => {
      const vendor = data.vendors.find((item) => item.id === invoice.vendorId);
      const project = data.projects.find((item) => item.id === invoice.projectId);

      return {
        category: "INVOICE",
        createdAt: invoice.createdAt,
        extracted: {
          dueDate: invoice.dueDate,
          issueDate: invoice.issueDate,
          projectId: project?.id,
          projectName: project?.name ?? "案件未設定",
          total: invoice.total,
          vendorName: vendor?.companyName ?? "支払先未設定",
        },
        fileName: invoice.originalFileName ?? "受領請求書",
        fileUrl: invoice.fileUrl,
        id: `invoice-${invoice.id}`,
        memo: invoice.memo,
        mimeType: invoice.mimeType,
        ocrPreview: previewText(invoice.ocrText),
        ocrText: invoice.ocrText,
        savedAs: "受領請求書",
      };
    });

  const rows = [...mailDocuments, ...directReceivedInvoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <AppShell>
      <PageHeader
        title="OCR書類一覧"
        description="アップロードした郵便物・請求書・契約書のOCR結果を月ごとに確認します。行をクリックすると要約と書類プレビューを同時に表示します。"
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
              <div>請求書は受領請求書として保存され、その他の書類はOCR書類として保管されます。</div>
              <div>AIの読み取り結果は下書き扱いです。金額や期限は保存前に確認してください。</div>
            </CardContent>
          </Card>
        </div>

        <OcrDocumentsTable company={company} rows={rows} />
      </div>
    </AppShell>
  );
}
