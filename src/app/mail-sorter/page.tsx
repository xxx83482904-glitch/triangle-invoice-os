import Link from "next/link";
import { MailSorterDropzone } from "@/app/mail-sorter/mail-sorter-dropzone";
import { OcrDocumentsTable, type OcrDocumentListItem } from "@/app/mail-sorter/ocr-documents-table";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany } from "@/lib/company";
import { can } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
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
  const mayEdit = Boolean(mayUpload);
  const projects = data.projects.filter((project) => !project.deletedAt && matchesCompany(project, company));
  const projectIds = new Set(projects.map((project) => project.id));
  const vendors = data.vendors.filter((vendor) => !vendor.deletedAt && companyFromParam(vendor.company) === company);
  const statusOptions = selectOptionsFor(data, "RECEIVED_INVOICE_STATUS", company).map((option) => ({
    label: option.label,
    value: option.value,
  }));

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
              projectId: invoice.projectId,
              projectName: project?.name ?? "案件未設定",
              status: invoice.status,
              subtotal: invoice.subtotal,
              taxTotal: invoice.taxTotal,
              total: invoice.total,
              vendorId: invoice.vendorId,
              vendorName: vendor?.companyName ?? "支払先未設定",
            }
          : undefined,
        fileName: document.originalFileName,
        fileUrl: document.fileUrl,
        folderMonth: document.folderMonth ?? invoice?.folderMonth,
        id: `mail-${document.id}`,
        mailDocumentId: document.id,
        memo: document.memo,
        mimeType: document.mimeType,
        ocrPreview: previewText(document.ocrText),
        ocrText: document.ocrText,
        receivedInvoiceId: invoice?.id,
        savedAs: invoice ? "受領請求書" : "その他書類",
        senderName: document.senderName || vendor?.companyName,
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
          projectId: invoice.projectId,
          projectName: project?.name ?? "案件未設定",
          status: invoice.status,
          subtotal: invoice.subtotal,
          taxTotal: invoice.taxTotal,
          total: invoice.total,
          vendorId: invoice.vendorId,
          vendorName: vendor?.companyName ?? "支払先未設定",
        },
        fileName: invoice.originalFileName ?? "受領請求書",
        fileUrl: invoice.fileUrl,
        folderMonth: invoice.folderMonth,
        id: `invoice-${invoice.id}`,
        memo: invoice.memo,
        mimeType: invoice.mimeType,
        ocrPreview: previewText(invoice.ocrText),
        ocrText: invoice.ocrText,
        receivedInvoiceId: invoice.id,
        savedAs: "受領請求書",
        senderName: vendor?.companyName,
      };
    });

  const rows = [...mailDocuments, ...directReceivedInvoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <AppShell>
      <PageHeader
        title="郵便物フォルダー"
        description="OCRした郵便物を月別フォルダーで管理します。上部にまとめてドロップし、下のフォルダー領域を広く使えます。"
      >
        <Button asChild variant="outline">
          <Link href={`/received-invoices?company=${company}`}>受領請求書を見る</Link>
        </Button>
      </PageHeader>

      <div className="space-y-6">
        {mayUpload ? <MailSorterDropzone company={company} /> : null}
        <OcrDocumentsTable
          canEdit={mayEdit}
          company={company}
          folders={data.mailFolders
            .filter((folder) => !folder.deletedAt && companyFromParam(folder.company) === company)
            .map((folder) => ({ label: folder.label, month: folder.month }))}
          projects={projects.map((project) => ({ label: project.name, value: project.id }))}
          rows={rows}
          statusOptions={statusOptions}
          vendors={vendors.map((vendor) => ({ label: vendor.companyName, value: vendor.id }))}
        />
      </div>
    </AppShell>
  );
}
