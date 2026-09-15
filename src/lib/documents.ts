import { companyFromParam, type CompanyScope } from "@/lib/company";
import { can } from "@/lib/rbac";
import type { AppData, IssuedInvoice, User } from "@/lib/types";

export type DocumentKind = "issued" | "received" | "mail" | "contract" | "attachment";
export type DocumentRow = {
  id: string;
  sourceId: string;
  kind: DocumentKind;
  title: string;
  category: string;
  counterpart: string;
  projectId?: string;
  projectName: string;
  month: string;
  date: string;
  dueDate?: string;
  total?: number;
  status: string;
  statusLabel: string;
  state: "review" | "open" | "done";
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  sourceHref: string;
  needsReview?: boolean;
  editable?: boolean;
  imported?: boolean;
  updatedAt: string;
};

export const documentKindLabels: Record<DocumentKind, string> = {
  issued: "発行請求書", received: "受領請求書", mail: "郵便物", contract: "契約書", attachment: "添付書類",
};
export const documentCategoryLabels: Record<string, string> = {
  INVOICE: "請求書", RECEIPT: "領収書", CONTRACT: "契約書", ESTIMATE: "見積書", DELIVERY_NOTE: "納品書", NOTICE: "通知書", OTHER: "その他",
};
export const issuedStatusLabels: Record<string, string> = {
  DRAFT: "下書き", ISSUED: "発行済み", SENT: "送付済み", WAITING_PAYMENT: "入金待ち", PARTIALLY_PAID: "一部入金",
  PAID: "入金済み", OVERDUE: "期限超過", CANCELED: "キャンセル", REISSUED: "再発行済み",
};
export const receivedStatusLabels: Record<string, string> = {
  RECEIVED: "受領済み", OCR_PENDING: "読み取り待ち", REVIEWING: "確認中", APPROVAL_PENDING: "承認待ち", SCHEDULED: "支払予定",
  PAID: "支払い済み", ON_HOLD: "保留", REJECTED: "差し戻し", ARCHIVED: "アーカイブ",
};

export function visibleProjects(data: AppData, user: Pick<User, "id" | "role">) {
  return data.projects.filter((p) => !p.deletedAt && (can(user, "view:all") || p.managerId === user.id || p.memberIds.includes(user.id)));
}

export function isBillableIssuedInvoice(invoice: IssuedInvoice) {
  return !invoice.deletedAt && !invoice.needsReview && invoice.status !== "DRAFT" && invoice.status !== "CANCELED";
}

export function documentRows(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope): DocumentRow[] {
  const projects = visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const clients = new Map(data.clients.filter((p) => !p.deletedAt).map((p) => [p.id, p.companyName]));
  const vendors = new Map(data.vendors.filter((p) => !p.deletedAt).map((p) => [p.id, p.companyName]));
  const rows: DocumentRow[] = [];
  const linkedReceived = new Map(data.mailDocuments.filter((m) => !m.deletedAt && m.relatedReceivedInvoiceId).map((m) => [m.relatedReceivedInvoiceId!, m]));
  const receivedIds = new Set<string>();
  const month = (date: string) => /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "undated";
  if (can(user, "view:issuedInvoices")) for (const i of data.issuedInvoices) {
    if (i.deletedAt || !projectMap.has(i.projectId)) continue;
    rows.push({ id: `issued:${i.id}`, sourceId: i.id, kind: "issued", title: i.invoiceNumber, category: "INVOICE",
      counterpart: clients.get(i.clientId) ?? "請求先未設定", projectId: i.projectId, projectName: projectMap.get(i.projectId)!.name,
      month: month(i.issueDate), date: i.issueDate, dueDate: i.dueDate, total: i.total, status: i.status,
      statusLabel: i.needsReview ? "OCR要確認" : issuedStatusLabels[i.status] ?? i.status,
      state: i.needsReview || i.status === "DRAFT" ? "review" : ["PAID", "CANCELED"].includes(i.status) ? "done" : "open",
      fileUrl: i.fileUrl || i.pdfUrl || `/api/issued-invoices/${i.id}/pdf`, fileName: i.originalFileName || `${i.invoiceNumber}.pdf`, mimeType: i.mimeType || "application/pdf",
      sourceHref: `/issued-invoices?company=${company}&document=${encodeURIComponent(`issued:${i.id}`)}`,
      needsReview: i.needsReview, imported: Boolean(i.fileUrl), editable: can(user, "manage:issuedInvoices"), updatedAt: i.updatedAt });
  }
  if (can(user, "view:receivedInvoices")) for (const i of data.receivedInvoices) {
    if (i.deletedAt || !projectMap.has(i.projectId)) continue;
    receivedIds.add(i.id);
    const mail = linkedReceived.get(i.id);
    rows.push({ id: `received:${i.id}`, sourceId: i.id, kind: "received", title: i.originalFileName || mail?.title || "受領請求書",
      category: mail?.category || "INVOICE", counterpart: vendors.get(i.vendorId) ?? "支払先未設定", projectId: i.projectId, projectName: projectMap.get(i.projectId)!.name,
      month: month(i.folderMonth || mail?.folderMonth || i.issueDate), date: i.issueDate, dueDate: i.dueDate, total: i.total,
      status: i.status, statusLabel: receivedStatusLabels[i.status] ?? i.status,
      state: ["PAID", "ARCHIVED"].includes(i.status) ? "done" : ["REVIEWING", "OCR_PENDING", "APPROVAL_PENDING", "REJECTED"].includes(i.status) ? "review" : "open",
      fileUrl: i.fileUrl || mail?.fileUrl, fileName: i.originalFileName || mail?.originalFileName, mimeType: i.mimeType || mail?.mimeType,
      sourceHref: `/received-invoices?company=${company}&document=${encodeURIComponent(i.id)}`, updatedAt: i.updatedAt });
  }
  if (can(user, "view:mailSorter") && company === "JAPAN") for (const m of data.mailDocuments) {
    if (m.deletedAt || companyFromParam(m.company) !== company || (m.relatedReceivedInvoiceId && receivedIds.has(m.relatedReceivedInvoiceId))) continue;
    const invoice = data.receivedInvoices.find((i) => i.id === m.relatedReceivedInvoiceId && !i.deletedAt);
    rows.push({ id: `mail:${m.id}`, sourceId: m.id, kind: "mail", title: m.title || m.originalFileName, category: m.category,
      counterpart: m.senderName || "発送元未設定", projectName: "", month: month(m.folderMonth || invoice?.folderMonth || invoice?.issueDate || m.createdAt),
      date: invoice?.issueDate || m.createdAt.slice(0, 10), status: m.mailProcessed ? "PROCESSED" : "UNPROCESSED",
      statusLabel: m.mailProcessed ? "処理済み" : "未処理", state: m.mailProcessed ? "done" : "open",
      fileUrl: m.fileUrl, fileName: m.originalFileName, mimeType: m.mimeType, sourceHref: "/mail-sorter?company=JAPAN", updatedAt: m.updatedAt });
  }
  // Mail staff also handle direct uploads shown in the Japan mail folder.
  if (user.role === "MAIL_EDITOR" && company === "JAPAN") for (const i of data.receivedInvoices) {
    const project = data.projects.find((p) => p.id === i.projectId && !p.deletedAt);
    if (i.deletedAt || linkedReceived.has(i.id) || !project || companyFromParam(project.company) !== company) continue;
    const processed = i.mailProcessed ?? i.status === "PAID";
    rows.push({ id: `received:${i.id}`, sourceId: i.id, kind: "received", title: i.originalFileName || "受領請求書", category: "INVOICE",
      counterpart: vendors.get(i.vendorId) ?? "支払先未設定", projectName: "", month: month(i.folderMonth || i.issueDate), date: i.issueDate,
      status: processed ? "PROCESSED" : "UNPROCESSED", statusLabel: processed ? "処理済み" : "未処理", state: processed ? "done" : "open",
      fileUrl: i.fileUrl, fileName: i.originalFileName, mimeType: i.mimeType, sourceHref: "/mail-sorter?company=JAPAN", updatedAt: i.updatedAt });
  }
  if (can(user, "view:projects")) for (const p of projects) {
    if (!p.contractFileUrl) continue;
    rows.push({ id: `contract:${p.id}`, sourceId: p.id, kind: "contract", title: p.contractOriginalFileName || `${p.name} 契約書`, category: "CONTRACT",
      counterpart: clients.get(p.clientId) ?? "", projectId: p.id, projectName: p.name, month: month(p.contractUploadedAt || p.createdAt),
      date: (p.contractUploadedAt || p.createdAt).slice(0, 10), status: "STORED", statusLabel: "保管済み", state: "done",
      fileUrl: p.contractFileUrl, fileName: p.contractOriginalFileName, mimeType: p.contractMimeType,
      sourceHref: `/projects/${p.id}?company=${company}`, updatedAt: p.updatedAt });
  }
  // Attachments already represented by an invoice or the current contract stay in a single row.
  const files = new Set(rows.map((r) => r.fileUrl).filter(Boolean));
  for (const a of data.attachments) {
    if (a.deletedAt || files.has(a.fileUrl)) continue;
    const linkedInvoiceId = a.relatedType === "MailDocument" ? data.mailDocuments.find((m) => m.id === a.relatedId && !m.deletedAt)?.relatedReceivedInvoiceId : undefined;
    const parent = rows.find((r) => (linkedInvoiceId && r.kind === "received" && r.sourceId === linkedInvoiceId) || (r.sourceId === a.relatedId && (
      (a.relatedType === "IssuedInvoice" && r.kind === "issued") ||
      (a.relatedType === "ReceivedInvoice" && r.kind === "received") ||
      (a.relatedType === "MailDocument" && r.kind === "mail") ||
      (a.relatedType === "ProjectContract" && r.kind === "contract"))));
    if (!parent) continue;
    rows.push({ ...parent, id: `attachment:${a.id}`, sourceId: a.id, kind: "attachment", title: a.fileName, fileUrl: a.fileUrl,
      fileName: a.fileName, mimeType: a.mimeType, date: a.createdAt.slice(0, 10), month: month(a.createdAt), status: "STORED",
      statusLabel: "保管済み", state: "done", total: undefined, editable: false, needsReview: false, updatedAt: a.createdAt });
    files.add(a.fileUrl);
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

export function documentOcrText(data: AppData, row: DocumentRow) {
  if (row.kind === "issued") return data.issuedInvoices.find((i) => i.id === row.sourceId)?.ocrText || "";
  if (row.kind === "received") return data.receivedInvoices.find((i) => i.id === row.sourceId)?.ocrText || "";
  if (row.kind === "mail") return data.mailDocuments.find((i) => i.id === row.sourceId)?.ocrText || "";
  if (row.kind === "contract") return data.projects.find((i) => i.id === row.sourceId)?.contractOcrText || "";
  return "";
}
