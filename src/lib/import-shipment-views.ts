import { z } from "zod";
import { companyFromParam, matchesCompany, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { detectImportDocument, extractImportShipmentFields, fillImportShipment, importChecklist, importDocumentKinds, importFillKeysByKind, importShipmentAmounts, importShipmentMonth, importShipmentStatuses, missingImportDocuments, normalizePermitNumber, type ImportFillKey, type ImportLinkedDocument, type ImportShipmentAmounts } from "@/lib/import-shipments";
import { receivedPaymentSummary } from "@/lib/payment-records";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, ImportDocumentKind, ImportShipment, MailDocument, ReceivedInvoice, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;

export type ImportShipmentView = ImportShipment & ImportShipmentAmounts & {
  month: string; projectName: string; brokerName: string; documents: ImportLinkedDocument[];
  checklist: ReturnType<typeof importChecklist>; missing: ImportDocumentKind[]; unpaidCount: number;
};

function scopedProjectIds(data: AppData, company: CompanyScope) {
  return new Set(data.projects.filter((row) => !row.deletedAt && matchesCompany(row, company)).map((row) => row.id));
}

function vendorName(data: AppData, id?: string) {
  return (id && data.vendors.find((row) => row.id === id)?.companyName) || "支払先未設定";
}

// A mail document whose received invoice is live is represented by that invoice, never twice.
function hasLiveInvoice(data: AppData, mail: MailDocument) {
  return Boolean(mail.relatedReceivedInvoiceId && data.receivedInvoices.some((row) => row.id === mail.relatedReceivedInvoiceId && !row.deletedAt));
}

function mailDocumentView(company: CompanyScope, mail: MailDocument): ImportLinkedDocument {
  const detected = detectImportDocument(mail.ocrText, mail.originalFileName);
  return {
    key: `mail:${mail.id}`, source: "mail", id: mail.id, title: mail.title || mail.originalFileName, party: mail.senderName || "差出人不明",
    date: mail.folderMonth ? `${mail.folderMonth}-01` : mail.createdAt.slice(0, 10), kind: mail.importDocumentKind ?? detected?.kind ?? "OTHER",
    suggestedKind: mail.importDocumentKind ?? detected?.kind, evidence: detected?.evidence, href: `/mail-sorter?company=${company}`, updatedAt: mail.updatedAt,
  };
}

function receivedInvoiceView(data: AppData, company: CompanyScope, invoice: ReceivedInvoice, brokerVendorId?: string): ImportLinkedDocument {
  const detected = detectImportDocument(invoice.ocrText, invoice.originalFileName);
  const fallback: ImportDocumentKind = brokerVendorId && invoice.vendorId === brokerVendorId ? "BROKER_INVOICE" : "SUPPLIER_INVOICE";
  return {
    key: `received:${invoice.id}`, source: "received", id: invoice.id, title: invoice.originalFileName || "受領請求書", party: vendorName(data, invoice.vendorId),
    date: invoice.issueDate, amount: invoice.total, kind: invoice.importDocumentKind ?? detected?.kind ?? fallback, suggestedKind: invoice.importDocumentKind ?? detected?.kind ?? fallback, evidence: detected?.evidence,
    href: `/received-invoices?company=${company}&document=${encodeURIComponent(invoice.id)}`, updatedAt: invoice.updatedAt,
    paid: invoice.status === "PAID" || receivedPaymentSummary(data, invoice).complete,
  };
}

export function importShipmentViews(data: AppData, company: CompanyScope): ImportShipmentView[] {
  const projects = scopedProjectIds(data, company);
  return (data.importShipments || [])
    .filter((row) => !row.deletedAt && companyFromParam(row.company) === company)
    .map((row) => {
      const received = data.receivedInvoices.filter((invoice) => !invoice.deletedAt && invoice.importShipmentId === row.id && projects.has(invoice.projectId))
        .map((invoice) => receivedInvoiceView(data, company, invoice, row.brokerVendorId));
      const mails = data.mailDocuments.filter((mail) => !mail.deletedAt && mail.importShipmentId === row.id && companyFromParam(mail.company) === company && !hasLiveInvoice(data, mail))
        .map((mail) => mailDocumentView(company, mail));
      const documents = [...received, ...mails].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "ja"));
      return {
        ...row, ...importShipmentAmounts(row), month: importShipmentMonth(row),
        projectName: data.projects.find((project) => project.id === row.projectId)?.name ?? "", brokerName: row.brokerVendorId ? vendorName(data, row.brokerVendorId) : "",
        documents, checklist: importChecklist(documents), missing: missingImportDocuments(documents), unpaidCount: received.filter((document) => !document.paid).length,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month) || (b.permitDate || "").localeCompare(a.permitDate || "") || b.createdAt.localeCompare(a.createdAt));
}

// Documents that look like import paperwork and are not attached to any shipment yet.
export function unassignedImportDocuments(data: AppData, company: CompanyScope): ImportLinkedDocument[] {
  const projects = scopedProjectIds(data, company);
  const received = data.receivedInvoices
    .filter((invoice) => !invoice.deletedAt && !invoice.importShipmentId && projects.has(invoice.projectId) && (invoice.importDocumentKind || detectImportDocument(invoice.ocrText, invoice.originalFileName)))
    .map((invoice) => receivedInvoiceView(data, company, invoice));
  const mails = data.mailDocuments
    .filter((mail) => !mail.deletedAt && !mail.importShipmentId && companyFromParam(mail.company) === company && !hasLiveInvoice(data, mail)
      && (mail.category === "CUSTOMS" || mail.importDocumentKind || detectImportDocument(mail.ocrText, mail.originalFileName)))
    .map((mail) => mailDocumentView(company, mail));
  return [...received, ...mails].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, "ja"));
}

export function importShipmentOptions(data: AppData, company: CompanyScope) {
  return importShipmentViews(data, company).map((row) => ({ value: row.id, label: `${row.title}（${row.month.replace("-", "年")}月）` }));
}

export function findImportShipmentByPermitNumber(data: AppData, company: CompanyScope, permitNumber: string) {
  const normalized = normalizePermitNumber(permitNumber);
  return normalized ? data.importShipments?.find((row) => !row.deletedAt && companyFromParam(row.company) === company
    && normalizePermitNumber(row.permitNumber ?? "") === normalized) : undefined;
}

export type ImportMonthlyRow = { month: string; count: number; goodsValue: number; dutyAmount: number; importTax: number; brokerFee: number; otherCost: number; costTotal: number };

export function importMonthlySummary(rows: ImportShipmentView[]): ImportMonthlyRow[] {
  const months = new Map<string, ImportMonthlyRow>();
  for (const row of rows) {
    const entry = months.get(row.month) ?? { month: row.month, count: 0, goodsValue: 0, dutyAmount: 0, importTax: 0, brokerFee: 0, otherCost: 0, costTotal: 0 };
    entry.count += 1;
    for (const key of ["goodsValue", "dutyAmount", "importTax", "brokerFee", "otherCost", "costTotal"] as const) entry[key] = Math.round((entry[key] + row[key]) * 100) / 100;
    months.set(row.month, entry);
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

const required = (label: string, max = 200) => z.string().trim().min(1, `${label}を入力してください`).max(max, `${label}は${max}文字以内にしてください`);
const reference = z.string().min(1).max(1000);
const version = z.string().min(1).max(100);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const money = z.number().finite().min(0, "金額は0以上で入力してください").max(1e12, "金額が大きすぎます").optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付の形式が正しくありません").or(z.literal("")).optional();
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "月の形式が正しくありません").or(z.literal("")).optional();
const fields = {
  title: required("便名"), projectId: optionalText(1000), supplierName: optionalText(200), brokerVendorId: optionalText(1000), permitNumber: optionalText(100),
  permitDate: isoDate, arrivalDate: isoDate, folderMonth: yearMonth, goodsValue: money, dutyAmount: money, importTaxNational: money, importTaxLocal: money,
  brokerFee: money, otherCost: money, status: z.enum(importShipmentStatuses).optional(), memo: optionalText(2000),
};
const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...fields }).strict(),
  z.object({ action: z.literal("update"), id: reference, version, ...fields }).strict(),
  z.object({ action: z.literal("delete"), id: reference, version }).strict(),
  z.object({ action: z.literal("assign"), shipmentId: reference.nullable(), source: z.enum(["mail", "received"]), documentId: reference, kind: z.enum(importDocumentKinds).optional(), fill: z.boolean().default(true) }).strict(),
]);
export type ImportShipmentMutation = z.input<typeof mutationSchema>;
type ShipmentFields = z.infer<typeof mutationSchema> & { action: "create" };

const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();

function applyShipmentFields(data: AppData, company: CompanyScope, row: ImportShipment, value: Omit<ShipmentFields, "action">) {
  if (value.projectId) {
    if (!data.projects.some((project) => project.id === value.projectId && !project.deletedAt && matchesCompany(project, company))) throw new Error("案件が見つかりません");
    row.projectId = value.projectId;
  } else delete row.projectId;
  if (value.brokerVendorId) {
    if (!data.vendors.some((vendor) => vendor.id === value.brokerVendorId && !vendor.deletedAt && partnerMatchesCompany(vendor, company))) throw new Error("通関業者（支払先）が見つかりません");
    row.brokerVendorId = value.brokerVendorId;
  } else delete row.brokerVendorId;
  row.title = value.title;
  for (const key of ["supplierName", "permitNumber", "permitDate", "arrivalDate", "folderMonth", "memo"] as const) {
    if (value[key]) row[key] = value[key]; else delete row[key];
  }
  for (const key of ["goodsValue", "dutyAmount", "importTaxNational", "importTaxLocal", "brokerFee", "otherCost"] as const) {
    if (value[key] === undefined) delete row[key]; else row[key] = value[key];
  }
  if (value.status) row.status = value.status;
}

// Shipments and their document links are the only things that change here; invoice amounts and mail content stay as they are.
export function applyImportShipmentMutation(data: AppData, actor: Actor, company: CompanyScope, input: ImportShipmentMutation) {
  assertCompanyAccess(actor, company); assertCan(actor, "manage:imports");
  const value = mutationSchema.parse(input);
  const rows = (data.importShipments ??= []);
  const liveShipment = (id: string) => rows.find((row) => row.id === id && !row.deletedAt && companyFromParam(row.company) === company);
  if (value.action === "create") {
    const timestamp = stamp(), id = crypto.randomUUID();
    const row: ImportShipment = { id, company, title: value.title, status: value.status ?? "OPEN", createdById: actor.id, createdAt: timestamp, updatedAt: timestamp };
    applyShipmentFields(data, company, row, value);
    rows.push(row);
    return { id, action: value.action, updatedAt: timestamp };
  }
  if (value.action === "assign") {
    const shipment = value.shipmentId ? liveShipment(value.shipmentId) : null;
    if (value.shipmentId && !shipment) throw new Error("輸入便が見つかりません");
    const target: MailDocument | ReceivedInvoice | undefined = value.source === "mail"
      ? data.mailDocuments.find((mail) => mail.id === value.documentId && !mail.deletedAt && companyFromParam(mail.company) === company)
      : data.receivedInvoices.find((invoice) => invoice.id === value.documentId && !invoice.deletedAt && scopedProjectIds(data, company).has(invoice.projectId));
    if (!target) throw new Error(value.source === "mail" ? "郵便物が見つかりません" : "受領請求書が見つかりません");
    if (shipment) target.importShipmentId = shipment.id; else delete target.importShipmentId;
    const detected = value.kind ?? target.importDocumentKind ?? detectImportDocument(target.ocrText, target.originalFileName)?.kind;
    if (detected) target.importDocumentKind = detected;
    let filled: ImportFillKey[] = [];
    if (shipment && value.fill && detected && detected !== "OTHER") {
      const candidates = extractImportShipmentFields(target.ocrText, target.originalFileName);
      const vendor = "vendorId" in target ? data.vendors.find((row) => row.id === target.vendorId && !row.deletedAt && partnerMatchesCompany(row, company)) : undefined;
      const brokerVendorId = detected === "BROKER_INVOICE" ? vendor?.id : undefined;
      if (detected === "SUPPLIER_INVOICE" && vendor) candidates.supplierName ||= vendor.companyName;
      filled = fillImportShipment(shipment, { ...candidates, brokerVendorId }, importFillKeysByKind[detected]);
      if (filled.length) shipment.updatedAt = stamp(shipment.updatedAt);
    }
    target.updatedAt = stamp(target.updatedAt);
    return { id: target.id, action: value.action, updatedAt: target.updatedAt, shipmentId: shipment?.id ?? null, kind: target.importDocumentKind, filled };
  }
  const row = liveShipment(value.id);
  if (!row) throw new Error("輸入便が見つかりません");
  if (row.updatedAt !== value.version) throw new Error("輸入便が更新されています。再読込してください");
  if (value.action === "delete") {
    row.deletedAt = row.updatedAt = stamp(row.updatedAt);
    for (const document of [...data.mailDocuments, ...data.receivedInvoices]) {
      if (document.importShipmentId !== row.id) continue;
      delete document.importShipmentId;
      document.updatedAt = stamp(document.updatedAt);
    }
    return { id: row.id, action: value.action, updatedAt: row.updatedAt };
  }
  applyShipmentFields(data, company, row, value);
  row.updatedAt = stamp(row.updatedAt);
  return { id: row.id, action: value.action, updatedAt: row.updatedAt };
}

// Mail sorter and received invoice forms carry the shipment as plain fields; absent fields leave the link alone.
export function applyImportShipmentFormFields(data: AppData, form: FormData, row: MailDocument | ReceivedInvoice) {
  if (form.has("importShipmentId")) {
    const id = String(form.get("importShipmentId") ?? "").trim();
    if (id) {
      if (!(data.importShipments || []).some((shipment) => shipment.id === id && !shipment.deletedAt)) throw new Error("輸入便が見つかりません");
      row.importShipmentId = id;
    } else delete row.importShipmentId;
  }
  if (form.has("importDocumentKind")) {
    const kind = String(form.get("importDocumentKind") ?? "").trim();
    if (kind && (importDocumentKinds as readonly string[]).includes(kind)) row.importDocumentKind = kind as ImportDocumentKind;
    else if (!kind) delete row.importDocumentKind;
  }
}
