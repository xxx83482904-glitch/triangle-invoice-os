import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { applyIssuedInvoiceEdits } from "@/lib/issued-invoice-edits";
import { invoicePaymentSummary } from "@/lib/invoice-status";
import { normalizePdfLayout } from "@/lib/invoice-pdf-layout";
import { estimatePdfContent, issuedInvoiceValues, issuedPdfContent, PdfDraftError } from "@/lib/pdf-document-draft";
import { pdfTextDefaults } from "@/lib/pdf-document-text";
import { normalizePdfText, pdfEditsSchema, samePdfContent, type PdfEditsInput } from "@/lib/pdf-document-values";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import { assertCanChangeIssuedRecord } from "@/lib/issued-amount-access";
import { saveEstimate } from "@/lib/estimates";
import type { AppData, Estimate, InvoicePdfLayout, InvoicePdfText, IssuedInvoice, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role" | "featureAccess">;

// Saving from the PDF dialog. Layout and wording are presentation only: they keep `updatedAt`, so edits
// already open in a list stay valid. Number, dates, lines and notes are the document itself and go
// through the same rules as every other edit, with the version check that implies.

function companyProjects(data: AppData, user: Actor, company: CompanyScope) {
  return new Set(visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company).map((p) => p.id));
}

function storePresentation(document: { pdfLayout?: InvoicePdfLayout; pdfText?: InvoicePdfText }, layout: InvoicePdfLayout, text: InvoicePdfText | undefined, defaults: Parameters<typeof normalizePdfText>[1]) {
  const storedLayout = normalizePdfLayout(layout);
  if (storedLayout) document.pdfLayout = storedLayout; else delete document.pdfLayout;
  // Without wording in the input, the wording already saved is left alone.
  if (text) {
    const storedText = normalizePdfText(text, defaults);
    if (storedText) document.pdfText = storedText; else delete document.pdfText;
  }
  return { layout: storedLayout ?? null, text: document.pdfText ?? null };
}

export function applyIssuedInvoicePdfEdits(data: AppData, user: Actor, company: CompanyScope, input: PdfEditsInput) {
  assertCan(user, "manage:issuedInvoices");
  assertCompanyAccess(user, company);
  const parsed = pdfEditsSchema.parse(input);
  const scope = companyProjects(data, user, company);
  const find = () => data.issuedInvoices.find((i) => i.id === parsed.id && !i.deletedAt && scope.has(i.projectId));
  const invoice = find();
  if (!invoice) throw new Error("請求書が見つかりません");
  assertCanChangeIssuedRecord(user, invoice, "invoice");
  if (invoice.fileUrl) throw new Error("取り込んだ原本の内容は変更できません");
  const saved = data.issuedInvoiceItems.filter((item) => item.invoiceId === invoice.id);
  const contentChanged = Boolean(parsed.content && !samePdfContent(issuedPdfContent(invoice, saved), parsed.content));
  if (contentChanged && parsed.content) {
    if (invoice.updatedAt !== parsed.updatedAt) throw new Error("他の操作で更新されています。再読み込みして確認してください");
    const timestamp = new Date().toISOString();
    const values = issuedInvoiceValues(invoice, data, saved, parsed.content, timestamp);
    const before: Partial<IssuedInvoice> = { subtotal: invoice.subtotal, taxTotal: invoice.taxTotal, total: invoice.total, taxRounding: invoice.taxRounding };
    Object.assign(invoice, values.totals);
    try {
      // Number uniqueness, date order and status consistency are the list's own rules.
      applyIssuedInvoiceEdits(data, user, company, [{ id: invoice.id, updatedAt: invoice.updatedAt, invoiceNumber: parsed.content.number, projectId: invoice.projectId,
        issueDate: parsed.content.issueDate, dueDate: parsed.content.dueDate, total: values.totals.total, status: invoicePaymentSummary(data, invoice).status, needsReview: Boolean(invoice.needsReview) }]);
    } catch (error) { Object.assign(invoice, before); throw error; }
    // The list's rules replace the invoice object, so it has to be looked up again.
    const edited = find()!;
    if (parsed.content.notes) edited.notes = parsed.content.notes; else delete edited.notes;
    data.issuedInvoiceItems = [...data.issuedInvoiceItems.filter((item) => item.invoiceId !== invoice.id), ...values.items];
  }
  const current = find()!;
  const stored = storePresentation(current, parsed.layout, parsed.text, pdfTextDefaults(current, data, "invoice"));
  return { id: current.id, updatedAt: current.updatedAt, contentChanged, ...stored };
}

export function applyEstimatePdfEdits(data: AppData, user: Actor, company: CompanyScope, input: PdfEditsInput) {
  assertCan(user, "manage:estimates");
  assertCompanyAccess(user, company);
  const parsed = pdfEditsSchema.parse(input);
  const scope = companyProjects(data, user, company);
  const estimate: Estimate | undefined = data.estimates.find((e) => e.id === parsed.id && !e.deletedAt && scope.has(e.projectId));
  if (!estimate) throw new Error("見積書が見つかりません");
  assertCanChangeIssuedRecord(user, estimate, "estimate");
  const contentChanged = Boolean(parsed.content && !samePdfContent(estimatePdfContent(estimate), parsed.content));
  if (contentChanged && parsed.content) {
    if (estimate.invoiceId || estimate.status === "CONVERTED") throw new Error("請求書に変換済みの見積書は編集できません");
    if (!parsed.content.issueDate || !parsed.content.dueDate) throw new PdfDraftError("見積日と有効期限を入力してください");
    const number = parsed.content.number;
    if (data.estimates.some((e) => e.id !== estimate.id && !e.deletedAt && e.estimateNumber === number)) throw new Error("見積書番号が重複しています");
    saveEstimate(data, user, company, { id: estimate.id, updatedAt: parsed.updatedAt, projectId: estimate.projectId, clientId: estimate.clientId, issueDate: parsed.content.issueDate, validUntil: parsed.content.dueDate,
      status: estimate.status as Exclude<Estimate["status"], "CONVERTED">, notes: parsed.content.notes, internalMemo: estimate.internalMemo || "", items: parsed.content.items });
    estimate.estimateNumber = number;
  }
  const stored = storePresentation(estimate, parsed.layout, parsed.text, pdfTextDefaults(estimate, data, "estimate"));
  return { id: estimate.id, updatedAt: estimate.updatedAt, contentChanged, ...stored };
}
