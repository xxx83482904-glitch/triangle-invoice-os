import type { AppData, ManualObligation, ObligationExclusion, Vendor } from "@/lib/types";
import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { isPayableReceivedInvoice } from "@/lib/debt-groups";
import { isBankDate } from "@/lib/banking";
import { receivedPaymentSummary } from "@/lib/payment-records";
import { resolveMailLink } from "@/lib/mail-links";
import { classifyObligationParty, normalizeObligationParty, type ObligationClassification } from "@/lib/obligation-classification";

export type ObligationSource = "received" | "mail" | "manual";
export type Obligation = {
  id: string; source: ObligationSource; title: string; party: string; amount?: number; paid: number; outstanding?: number;
  dueDate: string; issueDate: string; status: string; overdue: boolean; dueSoon: boolean; href: string; note: string;
  classification: ObligationClassification | { basis: "MANUAL" }; version: string;
};
export type ObligationExclusionView = ObligationExclusion & { actorName: string; current?: Obligation };
export type ObligationSummary = {
  items: Obligation[]; outstandingTotal: number; overdue: number; dueSoon: number; unpriced: number;
  paidRecently: Array<{ id: string; title: string; paidAt: string; amount: number }>;
  excluded: ObligationExclusionView[]; manualInactive: ManualObligation[];
};

function mailClassification(name: string, vendors: Vendor[]) {
  const matches = vendors.filter((row) => normalizeObligationParty(row.companyName) === normalizeObligationParty(name));
  // Never choose the first of several same-name vendors with conflicting settings.
  if (matches.length > 1 && new Set(matches.map((row) => row.obligationKind || "UNSET")).size > 1) return;
  return classifyObligationParty(name, matches[0]);
}

export function taxObligations(data: AppData, company: CompanyScope, today: string): ObligationSummary {
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
  const projects = new Set(data.projects.filter((row) => !row.deletedAt && companyFromParam(row.company) === company).map((row) => row.id));
  const vendors = data.vendors.filter((row) => !row.deletedAt && partnerMatchesCompany(row, company));
  const vendorById = new Map(vendors.map((row) => [row.id, row]));
  const candidates: Obligation[] = [], paidRecently: ObligationSummary["paidRecently"] = [];
  const timing = (dueDate: string) => ({ overdue: isBankDate(dueDate) && dueDate < today, dueSoon: isBankDate(dueDate) && dueDate >= today && dueDate <= soon });
  const add = (row: Omit<Obligation, "version" | "overdue" | "dueSoon">, updatedAt: string, vendorUpdatedAt?: string) => {
    // Stable across midnight, but changes when displayed evidence, payment totals or source versions change.
    candidates.push({ ...row, ...timing(row.dueDate), version: row.source === "manual" ? updatedAt : JSON.stringify([updatedAt, vendorUpdatedAt || "", row]) });
  };
  const activeExclusions = (data.obligationExclusions || []).filter((row) => row.company === company && !row.restoredAt);
  const excludedIds = new Set(activeExclusions.map((row) => row.targetId));
  for (const invoice of data.receivedInvoices) {
    if (invoice.deletedAt || !projects.has(invoice.projectId) || ["REJECTED", "ARCHIVED"].includes(invoice.status) || !isPayableReceivedInvoice(data, invoice)) continue;
    const vendor = vendorById.get(invoice.vendorId);
    const classification = vendor && classifyObligationParty(vendor.companyName, vendor);
    if (!classification) continue;
    const payment = receivedPaymentSummary(data, invoice), title = invoice.originalFileName || "受領請求書";
    if (payment.complete) {
      if (!excludedIds.has(`received:${invoice.id}`)) paidRecently.push({ id: invoice.id, title, paidAt: payment.paidAt || "", amount: invoice.total });
      continue;
    }
    add({ id: `received:${invoice.id}`, source: "received", title, party: vendor!.companyName, amount: invoice.total, paid: payment.paid, outstanding: payment.outstanding,
      dueDate: invoice.dueDate, issueDate: invoice.issueDate, status: invoice.status, classification,
      href: `/received-invoices?company=${company}&document=${encodeURIComponent(invoice.id)}`, note: payment.paid > 0 ? "一部支払済み" : "支払記録なし" }, invoice.updatedAt, vendor?.updatedAt);
  }
  for (const mail of data.mailDocuments) {
    if (mail.deletedAt || companyFromParam(mail.company) !== company || mail.mailProcessed || !["INVOICE", "NOTICE", "OTHER"].includes(mail.category)) continue;
    if (resolveMailLink(data, company, mail).invoice) continue;
    const classification = mailClassification(mail.senderName || "", vendors);
    if (!classification) continue;
    const month = mail.folderMonth || mail.createdAt.slice(0, 7);
    add({ id: `mail:${mail.id}`, source: "mail", title: mail.title || mail.originalFileName, party: mail.senderName || "差出人不明", paid: 0, dueDate: "", issueDate: `${month}-01`,
      status: mail.category === "NOTICE" ? "通知" : mail.category === "INVOICE" ? "請求書（郵便物）" : "その他", classification,
      href: `/mail-sorter?company=${company}`, note: "郵便物のみ。金額・期日は受領請求書として登録すると追跡できます" }, mail.updatedAt);
  }
  for (const row of data.manualObligations || []) {
    if (row.company !== company || row.status !== "OPEN") continue;
    add({ id: `manual:${row.id}`, source: "manual", title: row.title, party: row.party, amount: row.amount, paid: 0, outstanding: row.amount, dueDate: row.dueDate,
      issueDate: row.createdAt.slice(0, 10), status: "未払い（手入力）", classification: { basis: "MANUAL" }, href: "", note: row.memo }, row.updatedAt);
  }
  const items = candidates.filter((row) => !excludedIds.has(row.id));
  items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.dueSoon) - Number(a.dueSoon) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.title.localeCompare(b.title, "ja"));
  paidRecently.sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const excluded = activeExclusions.map((row) => ({ ...row, actorName: data.users.find((user) => user.id === row.createdById)?.name || row.createdById, current: candidates.find((item) => item.id === row.targetId) }));
  return { items, excluded, manualInactive: (data.manualObligations || []).filter((row) => row.company === company && row.status !== "OPEN" && !excludedIds.has(`manual:${row.id}`)),
    outstandingTotal: Math.round(items.reduce((sum, row) => sum + (row.outstanding || 0), 0) * 100) / 100,
    overdue: items.filter((row) => row.overdue).length, dueSoon: items.filter((row) => row.dueSoon).length, unpriced: items.filter((row) => row.amount === undefined).length, paidRecently: paidRecently.slice(0, 20) };
}
