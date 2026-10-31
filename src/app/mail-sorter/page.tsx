import { BankReconciliationLink } from "@/components/app/bank-reconciliation-link";
import { SectionExportDialog } from "@/components/app/section-export-dialog";
import { redirect } from "next/navigation";
import { MailSorterDropzone } from "@/app/mail-sorter/mail-sorter-dropzone";
import { OcrDocumentsTable, type OcrDocumentListItem } from "@/app/mail-sorter/ocr-documents-table";
import { AppShell, PageHeader } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, mailSorterCompany, matchesCompany } from "@/lib/company";
import { can, defaultPathForRole } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { readDataForRequest as readData } from "@/lib/store";
import { uploadedFileExists } from "@/lib/files";
import { mailIntegrityReport, mailLinkCandidates, resolveMailLink } from "@/lib/mail-links";

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
  const company = mailSorterCompany;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:mailSorter")) redirect(defaultPathForRole(user.role));
  if (params.company !== mailSorterCompany) redirect(`/mail-sorter?company=${mailSorterCompany}`);
  const data = await readData();
  const mayUpload = user && (can(user, "manage:mailSorter") || can(user, "manage:receivedInvoices") || can(user, "upload:receivedInvoices"));
  const mayEdit = Boolean(mayUpload);
  const projects = data.projects.filter((project) => !project.deletedAt && matchesCompany(project, company));
  const projectIds = new Set(projects.map((project) => project.id));
  const vendors = data.vendors.filter((vendor) => !vendor.deletedAt && companyFromParam(vendor.company) === company);
  const statusOptions = selectOptionsFor(data, "RECEIVED_INVOICE_STATUS", company).map((option) => ({
    label: option.label,
    value: option.value,
  }));

  const vendorName = (id: string) => vendors.find((vendor) => vendor.id === id)?.companyName ?? "支払先未設定";
  const linkTargets = data.receivedInvoices
    .filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt))
    .map((invoice) => ({ value: invoice.id, label: `${vendorName(invoice.vendorId)} / ${invoice.issueDate || "日付なし"} / ¥${invoice.total.toLocaleString("ja-JP")}${invoice.originalFileName ? ` / ${invoice.originalFileName}` : ""}` }));
  const targetLabels = new Map(linkTargets.map((target) => [target.value, target.label]));
  const integrity = mailIntegrityReport(data, company, uploadedFileExists);

  const mailDocuments = data.mailDocuments
    .filter((document) => !document.deletedAt && companyFromParam(document.company) === company)
    .map<OcrDocumentListItem>((document) => {
      // Only a live received invoice counts as a link; a deleted target is shown as "参照切れ" with repair actions.
      const link = resolveMailLink(data, company, document);
      const invoice = link.invoice;
      const vendor = invoice ? data.vendors.find((item) => item.id === invoice.vendorId) : undefined;
      const project = invoice ? data.projects.find((item) => item.id === invoice.projectId) : undefined;
      const duplicateMailDocument = document.duplicateOfMailDocumentId
        ? data.mailDocuments.find((item) => item.id === document.duplicateOfMailDocumentId && !item.deletedAt)
        : undefined;
      const duplicateReceivedInvoice = document.duplicateOfReceivedInvoiceId
        ? data.receivedInvoices.find((item) => item.id === document.duplicateOfReceivedInvoiceId && !item.deletedAt)
        : undefined;
      return {
        category: document.category,
        confidence: document.confidence,
        createdAt: document.createdAt,
        duplicateOfMailDocumentId: document.duplicateOfMailDocumentId,
        duplicateOfReceivedInvoiceId: document.duplicateOfReceivedInvoiceId,
        duplicateReason: document.duplicateReason,
        duplicateScore: document.duplicateScore,
        duplicateTitle:
          duplicateMailDocument?.originalFileName ??
          duplicateMailDocument?.title ??
          duplicateReceivedInvoice?.originalFileName,
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
        fileMissing: uploadedFileExists(document.fileUrl) === false,
        fileUrl: document.fileUrl,
        folderMonth: document.folderMonth ?? invoice?.folderMonth,
        id: `mail-${document.id}`,
        linkBroken: link.broken,
        brokenTargetId: link.targetId,
        linkCandidates: invoice ? [] : mailLinkCandidates(data, company, document).map((candidate) => ({ value: candidate.id, label: `${targetLabels.get(candidate.id) ?? candidate.id} — ${candidate.reasons.join("・")}` })),
        mailProcessed: document.mailProcessed ?? Boolean(invoice),
        mailDocumentId: document.id,
        mailUpdatedAt: document.updatedAt,
        memo: document.memo,
        mimeType: document.mimeType,
        ocrPreview: previewText(document.ocrText),
        receivedInvoiceId: invoice?.id,
        savedAs: invoice ? "受領請求書" : link.broken ? "受領請求書（参照切れ）" : "その他書類",
        senderName: document.senderName || vendor?.companyName,
      };
    });

  const linkedReceivedInvoiceIds = new Set(mailDocuments.map((row) => row.receivedInvoiceId).filter((id): id is string => Boolean(id)));
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
        fileMissing: uploadedFileExists(invoice.fileUrl) === false,
        fileUrl: invoice.fileUrl,
        folderMonth: invoice.folderMonth,
        id: `invoice-${invoice.id}`,
        mailProcessed: invoice.mailProcessed ?? invoice.status === "PAID",
        memo: invoice.memo,
        mimeType: invoice.mimeType,
        ocrPreview: previewText(invoice.ocrText),
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
      >
        {can(user, "view:banking") ? <BankReconciliationLink company={company} invoices /> : null}
        <SectionExportDialog scope="mail" role={user.role} />
      </PageHeader>

      <div className="space-y-6">
        {integrity.brokenLinks || integrity.missingMailFiles ? (
          <p role="alert" className="border-l-2 border-amber-500 pl-3 text-sm">
            {[integrity.brokenLinks ? `参照先の受領請求書が削除された郵便物 ${integrity.brokenLinks}件` : "", integrity.missingMailFiles ? `原本ファイルが見つからない郵便物 ${integrity.missingMailFiles}件` : ""].filter(Boolean).join(" / ")}。該当行は「参照切れ」「原本なし」の表示で確認でき、参照切れは編集欄から作り直すか既存の受領請求書へ再連携できます。
          </p>
        ) : null}
        <OcrDocumentsTable
          canEdit={mayEdit}
          canExport={can(user, "export:csv")}
          company={company}
          linkTargets={linkTargets}
          folders={data.mailFolders
            .filter((folder) => !folder.deletedAt && companyFromParam(folder.company) === company)
            .map((folder) => ({ label: folder.label, month: folder.month }))}
          projects={projects.map((project) => ({ label: project.name, value: project.id }))}
          rows={rows}
          statusOptions={statusOptions}
          vendors={vendors.map((vendor) => ({ label: vendor.companyName, value: vendor.id }))}
        />
        {mayUpload ? <MailSorterDropzone company={company} /> : null}
      </div>
    </AppShell>
  );
}
