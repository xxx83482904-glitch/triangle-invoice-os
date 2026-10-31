import type { AppData, MailDocument, ReceivedInvoice } from "@/lib/types";
import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { isPayableReceivedInvoice } from "@/lib/debt-groups";
import { isBankDate } from "@/lib/banking";

// 未払い税金・社会保険一覧: documents from tax offices, municipalities and insurance bodies that are not yet paid.
// Matching is by name, so the list is a prompt to check, not a tax ledger.
export const obligationPattern = /税務署|国税|都税|県税|府税|市税|区役所|市役所|町役場|役場|年金事務所|年金|健康保険|社会保険|厚生年金|労働保険|雇用保険|労災|国民健康保険|住民税|法人税|消費税|固定資産税|自動車税|事業税|源泉所得税|納付書|納税|日本年金機構|協会けんぽ|ハローワーク/;
export type ObligationSource = "received" | "mail";
export type Obligation = { id: string; source: ObligationSource; title: string; party: string; amount?: number; paid: number; outstanding?: number; dueDate: string; issueDate: string; status: string; overdue: boolean; dueSoon: boolean; href: string; note: string };
export type ObligationSummary = { items: Obligation[]; outstandingTotal: number; overdue: number; dueSoon: number; unpriced: number; paidRecently: Array<{ id: string; title: string; paidAt: string; amount: number }> };

const normalize = (value?: string) => (value || "").normalize("NFKC");
const text = (invoice: ReceivedInvoice, vendor?: string) => `${vendor || ""} ${invoice.originalFileName || ""} ${invoice.memo || ""} ${(invoice.ocrText || "").slice(0, 400)}`;

export function taxObligations(data: AppData, company: CompanyScope, today: string): ObligationSummary {
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
  const projects = new Set(data.projects.filter((row) => !row.deletedAt && companyFromParam(row.company) === company).map((row) => row.id));
  const vendors = new Map(data.vendors.filter((row) => !row.deletedAt && partnerMatchesCompany(row, company)).map((row) => [row.id, row.companyName]));
  const items: Obligation[] = [], paidRecently: ObligationSummary["paidRecently"] = [];
  const timing = (dueDate: string) => ({ overdue: isBankDate(dueDate) && dueDate < today, dueSoon: isBankDate(dueDate) && dueDate >= today && dueDate <= soon });
  for (const invoice of data.receivedInvoices) {
    if (invoice.deletedAt || !projects.has(invoice.projectId) || ["REJECTED", "ARCHIVED"].includes(invoice.status)) continue;
    const vendor = vendors.get(invoice.vendorId);
    if (!obligationPattern.test(normalize(text(invoice, vendor)))) continue;
    if (!isPayableReceivedInvoice(data, invoice)) continue;
    const paid = data.payments.filter((row) => !row.deletedAt && row.type === "EXPENSE" && row.receivedInvoiceId === invoice.id).reduce((sum, row) => sum + row.amount, 0);
    const outstanding = Math.max(0, invoice.total - paid);
    const title = invoice.originalFileName || "受領請求書";
    if (outstanding <= 0 && invoice.total > 0) { if (invoice.paidAt || invoice.status === "PAID") paidRecently.push({ id: invoice.id, title, paidAt: invoice.paidAt || invoice.updatedAt.slice(0, 10), amount: invoice.total }); continue; }
    items.push({ id: `received:${invoice.id}`, source: "received", title, party: vendor || "支払先未設定", amount: invoice.total, paid, outstanding, dueDate: invoice.dueDate, issueDate: invoice.issueDate, status: invoice.status, ...timing(invoice.dueDate),
      href: `/received-invoices?company=${company}&document=${encodeURIComponent(invoice.id)}`, note: paid > 0 ? "一部支払済み" : "支払記録なし" });
  }
  const linked = new Set(data.mailDocuments.filter((row) => !row.deletedAt && row.relatedReceivedInvoiceId).map((row) => row.relatedReceivedInvoiceId));
  void linked;
  for (const mail of data.mailDocuments) {
    if (mail.deletedAt || companyFromParam(mail.company) !== company || mail.relatedReceivedInvoiceId || mail.mailProcessed) continue;
    if (!["INVOICE", "NOTICE", "OTHER"].includes(mail.category)) continue;
    if (!obligationPattern.test(normalize(`${mail.title} ${mail.senderName || ""} ${mail.originalFileName} ${(mail.ocrText || "").slice(0, 400)}`))) continue;
    const month = mail.folderMonth || mail.createdAt.slice(0, 7);
    items.push({ id: `mail:${mail.id}`, source: "mail", title: mail.title || mail.originalFileName, party: mail.senderName || "差出人不明", paid: 0, dueDate: "", issueDate: `${month}-01`, status: mailLabel(mail), overdue: false, dueSoon: false,
      href: `/mail-sorter?company=${company}`, note: "郵便物のみ。金額・期日は受領請求書として登録すると追跡できます" });
  }
  items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.dueSoon) - Number(a.dueSoon) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.title.localeCompare(b.title, "ja"));
  paidRecently.sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  return { items, outstandingTotal: items.reduce((sum, row) => sum + (row.outstanding || 0), 0), overdue: items.filter((row) => row.overdue).length, dueSoon: items.filter((row) => row.dueSoon).length, unpriced: items.filter((row) => row.amount === undefined).length, paidRecently: paidRecently.slice(0, 20) };
}
const mailLabel = (mail: MailDocument) => mail.category === "NOTICE" ? "通知" : mail.category === "INVOICE" ? "請求書（郵便物）" : "その他";
