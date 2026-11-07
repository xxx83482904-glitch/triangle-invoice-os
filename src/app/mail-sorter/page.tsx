import { formatMoney } from "@/lib/format";
import { importShipmentOptions } from "@/lib/import-shipment-views";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { mailInvoiceDefaults } from "@/lib/mail-invoice-defaults";
import { BankReconciliationLink } from "@/components/app/bank-reconciliation-link";
import { isMailProcessed } from "@/lib/mail-processing";
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
import { mailIntegrityReport, mailLinkCandidates, resolveMailLink, mailsNeedingReceivedInvoice, mailInvoiceLinkRequiredHref } from "@/lib/mail-links";

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
  const linkRequiredOnly = params.link === "required";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:mailSorter")) redirect(defaultPathForRole(user.role));
  if (params.company !== mailSorterCompany) redirect(linkRequiredOnly ? mailInvoiceLinkRequiredHref(company) : `/mail-sorter?company=${company}`);
  const data = await readData();
  const requiredMailIds = new Set(mailsNeedingReceivedInvoice(data, company).map((row) => row.id));
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
    .map((invoice) => ({ value: invoice.id, label: `${vendorName(invoice.vendorId)} / ${invoice.issueDate || "日付なし"} / ${formatMoney(invoice.total, { maximumFractionDigits: 3 })}${invoice.originalFileName ? ` / ${invoice.originalFileName}` : ""}` }));
  const targetLabels = new Map(linkTargets.map((target) => [target.value, target.label]));
  const integrity = mailIntegrityReport(data, company, uploadedFileExists);

  const mailDocuments = data.mailDocuments
    .filter((document) => !document.deletedAt && companyFromParam(document.company) === company && (!linkRequiredOnly || requiredMailIds.has(document.id)))
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
        reflectDefaults: invoice ? undefined : mailInvoiceDefaults(document, vendors.map((row) => ({ value: row.id, label: row.companyName })), projects.map((row) => ({ value: row.id, label: row.name }))),
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
        mailProcessed: isMailProcessed(document),
        invoiceUpdatedAt: invoice?.updatedAt,
        mailDocumentId: document.id,
        mailUpdatedAt: document.updatedAt,
        memo: document.memo,
        importShipmentId: document.importShipmentId,
        mimeType: document.mimeType,
        ocrPreview: previewText(document.ocrText),
        receivedInvoiceId: invoice?.id,
        savedAs: invoice ? "受領請求書" : link.broken ? "受領請求書（参照切れ）" : "その他書類",
        senderName: document.senderName || vendor?.companyName,
      };
    });

  const linkedReceivedInvoiceIds = new Set(mailDocuments.map((row) => row.receivedInvoiceId).filter((id): id is string => Boolean(id)));
  const directReceivedInvoices = data.receivedInvoices
    .filter((invoice) => !linkRequiredOnly && !invoice.deletedAt && projectIds.has(invoice.projectId) && invoice.ocrText && !linkedReceivedInvoiceIds.has(invoice.id))
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
        mailProcessed: isMailProcessed(invoice),
        invoiceUpdatedAt: invoice.updatedAt,
        memo: invoice.memo,
        importShipmentId: invoice.importShipmentId,
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
        {linkRequiredOnly ? <section aria-label="連携が必要な郵便物" className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
          <h2 className="font-semibold">受領請求書への連携が必要な郵便物 {rows.length}件</h2>
          <p>未処理の請求書・領収書で、有効な連携先がないものだけを表示しています。原本欠落・重複候補は確認対象に含みます。連携不要と判断したものは処理済みにすると、この一覧から外れます。</p>
          <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={"/mail-sorter?company=" + company}>すべての郵便物に戻る<ArrowUpRight aria-hidden="true" className="size-4 shrink-0" /></Link></Button>
        </section> : null}
        {!linkRequiredOnly && (integrity.brokenLinks || integrity.missingMailFiles) ? (
          <p role="alert" className="border-l-2 border-amber-500 pl-3 text-sm">
            {[integrity.brokenLinks ? `参照先の受領請求書が有効でない郵便物 ${integrity.brokenLinks}件` : "", integrity.missingMailFiles ? `原本ファイルが見つからない郵便物 ${integrity.missingMailFiles}件` : ""].filter(Boolean).join(" / ")}。該当行は「参照切れ」「原本なし」の表示で確認でき、連携が必要な参照切れは編集欄から作り直すか既存の受領請求書へ再連携できます。処理済みの郵便物も、この参照・原本の点検には含まれます。
          </p>
        ) : null}
        <OcrDocumentsTable
          key={company + ":" + (linkRequiredOnly ? "link-required" : "all")}
          linkRequiredOnly={linkRequiredOnly}
          canEdit={mayEdit}
          canReconcile={company === "JAPAN" && can(user, "manage:banking")}
          canExport={can(user, "export:csv") && (!linkRequiredOnly || rows.length > 0)}
          company={company}
          linkTargets={linkTargets}
          folders={data.mailFolders
            .filter((folder) => !linkRequiredOnly && !folder.deletedAt && companyFromParam(folder.company) === company)
            .map((folder) => ({ label: folder.label, month: folder.month }))}
          projects={projects.map((project) => ({ label: project.name, value: project.id }))}
          rows={rows}
          statusOptions={statusOptions}
          vendors={vendors.map((vendor) => ({ label: vendor.companyName, value: vendor.id }))}
          shipments={importShipmentOptions(data, company)}
        />
        {mayUpload ? <MailSorterDropzone company={company} /> : null}
      </div>
    </AppShell>
  );
}
