import { z } from "zod";
import { companyFromParam, matchesCompany, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { detectImportDocument, documentDisplayName, extractImportShipmentFields, fillImportShipment, importChecklist, importDocumentKinds, importFillKeysByKind, importFillLabels, importShipmentAmounts, importShipmentMonth, importShipmentStatuses, missingImportDocuments, normalizeReference, readImportReferences, type ImportFillKey, type ImportLinkedDocument, type ImportReferences, type ImportShipmentAmounts } from "@/lib/import-shipments";
import { receivedPaymentSummary } from "@/lib/payment-records";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, ImportDocumentKind, ImportShipment, MailDocument, ReceivedInvoice, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;

export type ImportBoardDocument = ImportLinkedDocument & { displayName: string; references: ImportReferences };

const recordedAmountKeys = ["goodsValue", "dutyAmount", "importTaxNational", "importTaxLocal", "brokerFee", "otherCost"] as const;
export type ImportShipmentView = ImportShipment & ImportShipmentAmounts & {
  // The amounts above are normalized to 0 for totals; these are the figures as recorded, empty when nobody has entered them.
  recorded: Pick<ImportShipment, (typeof recordedAmountKeys)[number]>;
  month: string; projectName: string; brokerName: string; documents: ImportBoardDocument[];
  checklist: Array<Omit<ReturnType<typeof importChecklist>[number], "documents"> & { documents: ImportBoardDocument[] }>;
  missing: ImportDocumentKind[]; unpaidCount: number;
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

function mailDocumentView(company: CompanyScope, mail: MailDocument): ImportBoardDocument {
  const detected = detectImportDocument(mail.ocrText, mail.originalFileName);
  const title = mail.title || mail.originalFileName;
  return {
    key: `mail:${mail.id}`, source: "mail", id: mail.id, title, party: mail.senderName || "差出人不明",
    displayName: documentDisplayName(mail.ocrText, title), references: readImportReferences(mail.ocrText, mail.originalFileName),
    date: mail.folderMonth ? `${mail.folderMonth}-01` : mail.createdAt.slice(0, 10), kind: mail.importDocumentKind ?? detected?.kind ?? "OTHER",
    suggestedKind: mail.importDocumentKind ?? detected?.kind, evidence: detected?.evidence, href: `/mail-sorter?company=${company}`, updatedAt: mail.updatedAt,
  };
}

function receivedInvoiceView(data: AppData, company: CompanyScope, invoice: ReceivedInvoice, brokerVendorId?: string): ImportBoardDocument {
  const detected = detectImportDocument(invoice.ocrText, invoice.originalFileName);
  const fallback: ImportDocumentKind = brokerVendorId && invoice.vendorId === brokerVendorId ? "BROKER_INVOICE" : "SUPPLIER_INVOICE";
  const title = invoice.originalFileName || "受領請求書";
  return {
    key: `received:${invoice.id}`, source: "received", id: invoice.id, title, party: vendorName(data, invoice.vendorId),
    displayName: documentDisplayName(invoice.ocrText, title), references: readImportReferences(invoice.ocrText, invoice.originalFileName),
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
        ...row, ...importShipmentAmounts(row), recorded: Object.fromEntries(recordedAmountKeys.map((key) => [key, row[key]])), month: importShipmentMonth(row),
        projectName: data.projects.find((project) => project.id === row.projectId)?.name ?? "", brokerName: row.brokerVendorId ? vendorName(data, row.brokerVendorId) : "",
        documents, checklist: importChecklist(documents).map((entry) => ({ ...entry, documents: documents.filter((document) => document.kind === entry.kind) })),
        missing: missingImportDocuments(documents), unpaidCount: received.filter((document) => !document.paid).length,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month) || (b.permitDate || "").localeCompare(a.permitDate || "") || b.createdAt.localeCompare(a.createdAt));
}

// Documents that look like import paperwork and are not attached to any shipment yet.
export function unassignedImportDocuments(data: AppData, company: CompanyScope): ImportBoardDocument[] {
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

const referencePairs = [["declarationNumber", "permitNumber"], ["blNumber", "blNumber"], ["invoiceNumber", "invoiceNumber"]] as const;

function shipmentByReferences(shipments: ImportShipment[], references: ImportReferences) {
  for (const [referenceKey, shipmentKey] of referencePairs) {
    const normalized = normalizeReference(references[referenceKey] ?? "");
    if (!normalized) continue;
    const shipment = shipments.find((row) => !row.deletedAt && normalizeReference(row[shipmentKey] ?? "") === normalized);
    if (shipment) return shipment;
  }
}

export function findImportShipmentByReferences(data: AppData, company: CompanyScope, references: ImportReferences): ImportShipment | undefined {
  return shipmentByReferences((data.importShipments ?? []).filter((row) => companyFromParam(row.company) === company), references);
}

export function findImportShipmentByPermitNumber(data: AppData, company: CompanyScope, permitNumber: string) {
  return findImportShipmentByReferences(data, company, { declarationNumber: permitNumber });
}

export type ImportDocumentGroup = ImportReferences & {
  key: string; documents: ImportBoardDocument[]; latestDate: string; suggestedTitle: string;
  shipment?: { id: string; title: string }; hasPermit: boolean; weak: boolean;
};

function shipperKey(name = "") {
  // Strip corporate affixes, not matching letter sequences inside the actual name.
  const suffix = /(?:株式会社|有限会社|合同会社|CO,?LTD|LIMITED|LTD|INC|CORPORATION|CORP|COMPANY|GMBH|PTE|LLC|SA)$/;
  const normalized = normalizeReference(name).replace(/^(?:株式会社|有限会社|合同会社)/, "");
  let key = normalized, previous: string;
  do { previous = key; key = key.replace(suffix, "").replace(/[,、]+$/, ""); } while (key !== previous);
  return key.length >= 3 ? key : "";
}

const within45Days = (left: string, right: string) => Math.abs(Date.parse(left) - Date.parse(right)) <= 45 * 86400000;

// The caller supplies shipments from the same company as the document views.
const strongFamilies = [["declarationNumber", "D"], ["blNumber", "B"], ["invoiceNumber", "I"], ["containerNumber", "C"]] as const;
type DraftGroup = { documents: ImportBoardDocument[]; weak: boolean };
const groupFamilies = (group: DraftGroup) => new Set(group.documents.flatMap((document) => strongFamilies.filter(([key]) => document.references[key]).map(([, family]) => family)));
const groupShippers = (group: DraftGroup) => new Set(group.documents.map((document) => shipperKey(document.references.shipperName)).filter(Boolean));
const groupLatest = (group: DraftGroup) => group.documents.reduce((latest, document) => document.date > latest ? document.date : latest, "");

// A bill of lading knows its B/L number and the invoice and packing list know their invoice number; only the shipper ties them.
// They join when their numbers do not overlap and each is the other's only such partner, so a shipper with several open shipments
// is never merged by guesswork.
function joinComplementaryGroups(groups: DraftGroup[]) {
  const partners = (group: DraftGroup) => {
    const families = groupFamilies(group), shippers = groupShippers(group);
    if (!families.size || !shippers.size) return [];
    return groups.filter((other) => other !== group && [...groupFamilies(other)].length && ![...groupFamilies(other)].some((family) => families.has(family))
      && [...groupShippers(other)].some((shipper) => shippers.has(shipper)) && within45Days(groupLatest(group), groupLatest(other)));
  };
  for (let merged = true; merged;) {
    merged = false;
    for (const group of groups) {
      const [partner, ...rest] = partners(group);
      if (!partner || rest.length || partners(partner).length !== 1) continue;
      group.documents.push(...partner.documents); group.weak = true;
      groups.splice(groups.indexOf(partner), 1); merged = true; break;
    }
  }
  return groups;
}

export function groupImportDocuments(documents: ImportBoardDocument[], shipments: ImportShipment[]): ImportDocumentGroup[] {
  const parents = documents.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  };
  const strongKeys = documents.map((document) => strongFamilies.flatMap(([key, family]) => {
    const value = normalizeReference(document.references[key] ?? "");
    return value ? [`${family}:${value}`] : [];
  }));
  const owners = new Map<string, number>();
  strongKeys.forEach((keys, index) => keys.forEach((key) => {
    const owner = owners.get(key);
    if (owner === undefined) owners.set(key, index); else parents[root(index)] = root(owner);
  }));
  const strong = new Map<number, DraftGroup>();
  documents.forEach((document, index) => {
    if (!strongKeys[index].length) return;
    const id = root(index), group = strong.get(id) ?? { documents: [], weak: false };
    group.documents.push(document); strong.set(id, group);
  });
  const groups = [...strong.values()];
  // Stable date order keeps weak matches independent of the incoming list's sort order.
  const weakDocuments = documents.filter((_, index) => !strongKeys[index].length)
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  for (const document of weakDocuments) {
    const name = shipperKey(document.references.shipperName);
    const candidates = name ? groups.filter((group) => group.documents.some((other) => shipperKey(other.references.shipperName) === name && within45Days(document.date, other.date))) : [];
    if (candidates.length === 1) { candidates[0].documents.push(document); candidates[0].weak = true; }
    else groups.push({ documents: [document], weak: Boolean(name) });
  }
  joinComplementaryGroups(groups);
  return groups.map((group): ImportDocumentGroup => {
    const references: ImportReferences = {};
    for (const document of group.documents) {
      for (const key of ["declarationNumber", "blNumber", "invoiceNumber", "shipperName"] as const) references[key] ||= document.references[key];
    }
    const latestDate = group.documents.reduce((latest, document) => document.date > latest ? document.date : latest, "");
    let shipment = shipmentByReferences(shipments, references);
    let weak = group.weak;
    const name = shipperKey(references.shipperName);
    if (!shipment && name) {
      const candidates = shipments.filter((row) => !row.deletedAt && shipperKey(row.supplierName) === name && within45Days(latestDate, `${importShipmentMonth(row)}-01`));
      if (candidates.length === 1) { shipment = candidates[0]; weak = true; }
    }
    const sorted = [...group.documents].sort((a, b) => importDocumentKinds.indexOf(a.kind) - importDocumentKinds.indexOf(b.kind) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    return {
      ...references, key: sorted[0].key, documents: sorted, latestDate, weak,
      suggestedTitle: `${references.shipperName ?? "輸入便"} ${references.blNumber ? `B/L ${references.blNumber}` : references.invoiceNumber ? `INV ${references.invoiceNumber}` : latestDate}`.slice(0, 200),
      hasPermit: sorted.some((document) => document.kind === "IMPORT_PERMIT"),
      ...(shipment ? { shipment: { id: shipment.id, title: shipment.title } } : {}),
    };
  }).sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.key.localeCompare(b.key));
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
  blNumber: optionalText(100), invoiceNumber: optionalText(100),
  permitDate: isoDate, arrivalDate: isoDate, folderMonth: yearMonth, goodsValue: money, dutyAmount: money, importTaxNational: money, importTaxLocal: money,
  brokerFee: money, otherCost: money, status: z.enum(importShipmentStatuses).optional(), memo: optionalText(2000),
};
const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...fields }).strict(),
  z.object({ action: z.literal("update"), id: reference, version, ...fields }).strict(),
  z.object({ action: z.literal("delete"), id: reference, version }).strict(),
  z.object({ action: z.literal("assign"), shipmentId: reference.nullable(), source: z.enum(["mail", "received"]), documentId: reference, kind: z.enum(importDocumentKinds).optional(), fill: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal("group"), shipmentId: reference.nullable(), title: fields.title.optional(), projectId: optionalText(1000), documents: z.array(
    z.object({ source: z.enum(["mail", "received"]), documentId: reference, kind: z.enum(importDocumentKinds).optional() }).strict(),
  ).min(1, "書類を選んでください").max(50, "一度に付けられるのは50件までです") }).strict(),
  z.object({ action: z.literal("reread"), id: reference, version }).strict(),
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
  for (const key of ["supplierName", "permitNumber", "blNumber", "invoiceNumber", "permitDate", "arrivalDate", "folderMonth", "memo"] as const) {
    if (value[key]) row[key] = value[key]; else delete row[key];
  }
  for (const key of ["goodsValue", "dutyAmount", "importTaxNational", "importTaxLocal", "brokerFee", "otherCost"] as const) {
    if (value[key] === undefined) delete row[key]; else row[key] = value[key];
  }
  if (value.status) row.status = value.status;
}

const trustOrder: ImportDocumentKind[] = ["IMPORT_PERMIT", "TAX_PAYMENT", "BROKER_INVOICE", "SUPPLIER_INVOICE", "PACKING_LIST", "WAYBILL", "OTHER"];
const fillKeys = Object.keys(importFillLabels) as ImportFillKey[];

function assignmentTarget(data: AppData, company: CompanyScope, source: "mail" | "received", documentId: string): MailDocument | ReceivedInvoice {
  const target = source === "mail"
    ? data.mailDocuments.find((mail) => mail.id === documentId && !mail.deletedAt && companyFromParam(mail.company) === company)
    : data.receivedInvoices.find((invoice) => invoice.id === documentId && !invoice.deletedAt && scopedProjectIds(data, company).has(invoice.projectId));
  if (!target) throw new Error(source === "mail" ? "郵便物が見つかりません" : "受領請求書が見つかりません");
  return target;
}

function documentKind(target: MailDocument | ReceivedInvoice, kind?: ImportDocumentKind) {
  return kind ?? target.importDocumentKind ?? detectImportDocument(target.ocrText, target.originalFileName)?.kind;
}

// The placeholder the mail sorter uses for an unidentified payee is not a broker anyone wants on a shipment.
function brokerVendor(data: AppData, company: CompanyScope, target: MailDocument | ReceivedInvoice) {
  if (!("vendorId" in target) || target.vendorId.startsWith("ocr-review-vendor-")) return undefined;
  return data.vendors.find((row) => row.id === target.vendorId && !row.deletedAt && partnerMatchesCompany(row, company));
}

function assignDocument(data: AppData, company: CompanyScope, target: MailDocument | ReceivedInvoice, shipment: ImportShipment | null, kind: ImportDocumentKind | undefined, fill: boolean) {
  if (shipment) target.importShipmentId = shipment.id; else delete target.importShipmentId;
  if (kind) target.importDocumentKind = kind;
  let filled: ImportFillKey[] = [];
  if (shipment && fill && kind && kind !== "OTHER") {
    const candidates = extractImportShipmentFields(target.ocrText, target.originalFileName, kind);
    const vendor = brokerVendor(data, company, target);
    if (kind === "SUPPLIER_INVOICE" && vendor) candidates.supplierName ||= vendor.companyName;
    filled = fillImportShipment(shipment, { ...candidates, brokerVendorId: kind === "BROKER_INVOICE" ? vendor?.id : undefined }, importFillKeysByKind[kind]);
    if (filled.length) shipment.updatedAt = stamp(shipment.updatedAt);
  }
  target.updatedAt = stamp(target.updatedAt);
  return { id: target.id, action: "assign" as const, updatedAt: target.updatedAt, shipmentId: shipment?.id ?? null, kind: target.importDocumentKind, filled };
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
    const target = assignmentTarget(data, company, value.source, value.documentId);
    return assignDocument(data, company, target, shipment ?? null, documentKind(target, value.kind), value.fill);
  }
  if (value.action === "group") {
    let shipment = value.shipmentId ? liveShipment(value.shipmentId) : undefined;
    if (value.shipmentId && !shipment) throw new Error("輸入便が見つかりません");
    // Validate every target before linking anything, including when creating a new shipment.
    const documents = value.documents.map((document) => {
      const target = assignmentTarget(data, company, document.source, document.documentId);
      return { target, kind: documentKind(target, document.kind) ?? "OTHER" };
    }).sort((a, b) => trustOrder.indexOf(a.kind) - trustOrder.indexOf(b.kind));
    if (!shipment) {
      const title = required("便名").parse(value.title ?? ""), timestamp = stamp();
      shipment = { id: crypto.randomUUID(), company, title, status: "OPEN", createdById: actor.id, createdAt: timestamp, updatedAt: timestamp };
      applyShipmentFields(data, company, shipment, { title, projectId: value.projectId });
      rows.push(shipment);
    }
    const filled = new Set<ImportFillKey>();
    for (const { target, kind } of documents) {
      for (const key of assignDocument(data, company, target, shipment, kind, true).filled) filled.add(key);
    }
    return { id: shipment.id, action: value.action, updatedAt: shipment.updatedAt, created: value.shipmentId === null, count: documents.length, filled: fillKeys.filter((key) => filled.has(key)) };
  }
  const row = liveShipment(value.id);
  if (!row) throw new Error("輸入便が見つかりません");
  if (row.updatedAt !== value.version) throw new Error("輸入便が更新されています。再読込してください");
  if (value.action === "reread") {
    const documents = importShipmentViews(data, company).find((view) => view.id === row.id)!.documents
      .sort((a, b) => trustOrder.indexOf(a.kind) - trustOrder.indexOf(b.kind));
    const candidates: Partial<Pick<ImportShipment, ImportFillKey>> = {};
    for (const document of documents) {
      const target = assignmentTarget(data, company, document.source, document.id);
      const fields = extractImportShipmentFields(target.ocrText, target.originalFileName, document.kind);
      for (const key of importFillKeysByKind[document.kind]) {
        const next = key === "brokerVendorId"
          ? document.kind === "BROKER_INVOICE" && !row.brokerVendorId ? brokerVendor(data, company, target)?.id : undefined
          : fields[key];
        if (candidates[key] === undefined && next !== undefined && next !== "") Object.assign(candidates, { [key]: next });
      }
    }
    const changed: Array<{ key: ImportFillKey; before?: string | number; after?: string | number }> = [];
    for (const key of fillKeys) {
      const after = candidates[key];
      if (after === undefined || row[key] === after) continue;
      changed.push({ key, before: row[key], after });
      Object.assign(row, { [key]: after });
    }
    if (changed.length) row.updatedAt = stamp(row.updatedAt);
    return { id: row.id, action: value.action, updatedAt: row.updatedAt, changed };
  }
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
