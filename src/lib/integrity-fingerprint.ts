import { createHash } from "node:crypto";
import type { AppData, Payment } from "@/lib/types";
import type { BankTransaction, BankTransfer } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";
import type { IntegrityKind } from "@/lib/integrity-types";
import type { ReconciliationOverview } from "@/lib/bank-reconciliation";
import { activePaymentsFor, isLegacyStatusPayment } from "@/lib/payment-records";
import type { MailIntegrityIssue } from "@/lib/mail-links";

// Explicit projections, never entire records or timestamps. Sets are sorted by stable IDs.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value ?? null;
}
export const integrityFingerprint = (kind: IntegrityKind, values: unknown) => "v1:" + createHash("sha256").update(JSON.stringify(canonical([kind, values]))).digest("hex");
const sorted = <T extends { id: string }>(rows: T[]) => rows.slice().sort((a, b) => a.id.localeCompare(b.id));

export function createIntegrityEvidence(data: AppData, company: CompanyScope, overview: ReconciliationOverview) {
  const bankMap = new Map(data.bankTransactions.map((row) => [row.id, row]));
  const accounts = new Map(data.bankAccounts.map((row) => [row.id, row]));
  const projectMap = new Map(data.projects.map((row) => [row.id, row]));
  const invoices = new Map(overview.invoices.map((row) => [row.key, row]));
  const links = data.bankReconciliations.filter((row) => !row.deletedAt && row.company === company);
  const transfers = (data.bankTransfers || []).filter((row) => !row.deletedAt && row.company === company);
  const linkView = new Map(overview.links.map((row) => [row.id, row]));
  const linkMap = new Map(links.map((row) => [row.id, row]));
  const paymentMap = new Map(data.payments.map((row) => [row.id, row]));
  const issued = new Map(data.issuedInvoices.map((row) => [row.id, row]));
  const received = new Map(data.receivedInvoices.map((row) => [row.id, row]));
  const mailMap = new Map(data.mailDocuments.map((row) => [row.id, row]));
  const bank = (row?: BankTransaction) => row && [row.id, row.company, row.officeCode, row.bankAccountId, row.side, row.amount, row.transactionDate, row.content, Boolean(row.sourceMissing)];
  const account = (id: string) => {
    const row = accounts.get(id);
    return row && [row.id, row.company, row.officeCode, row.name, row.serviceName, row.overviewSettings?.kind, row.forecastSettings?.accountKind];
  };
  const project = (id: string) => { const row = projectMap.get(id); return row && [row.id, row.company, Boolean(row.deletedAt)]; };
  const payment = (row?: Payment) => row && [row.id, row.type, row.issuedInvoiceId, row.receivedInvoiceId, row.amount, row.paymentDate, Boolean(row.deletedAt), isLegacyStatusPayment(row)];
  const document = (kind: "issued" | "received", id: string) => {
    const row = kind === "issued" ? issued.get(id) : received.get(id);
    return row && [row.id, project(row.projectId), Boolean(row.deletedAt), row.status, row.total];
  };
  const linkValues = (id: string) => {
    const row = linkMap.get(id);
    return row && [row.id, row.transactionId, row.invoiceKind, row.invoiceId, row.paymentId, row.amount, row.fee?.amount, row.fee?.borneBy, row.bankEvidence, row.invoiceEvidence, row.paymentEvidence];
  };
  const transferRow = (row?: BankTransaction) => row && [bank(row), row.sourceId, row.sourceStatus, row.treatment, account(row.bankAccountId),
    row.bookkeeping?.hold && [row.bookkeeping.hold.reason, row.bookkeeping.hold.question], Boolean(row.bookkeeping?.splits?.length),
    sorted(transfers.filter((link) => link.outgoingId === row.id || link.incomingId === row.id)).map((link) => [link.id, link.outgoingId, link.incomingId]),
    sorted(links.filter((link) => link.transactionId === row.id)).map((link) => link.id)];
  const reconciliation = (id: string) => {
    const row = linkMap.get(id), source = row && bankMap.get(row.transactionId);
    return row && [linkValues(id), linkView.get(id)?.issue, linkView.get(id)?.reaffirmBlocker, source && [bank(source), source.sourceId, source.sourceStatus, source.treatment, account(source.bankAccountId)],
      document(row.invoiceKind, row.invoiceId), payment(paymentMap.get(row.paymentId)),
      source && sorted(transfers.filter((link) => link.outgoingId === source.id || link.incomingId === source.id)).map((link) => link.id)];
  };
  const invoice = (kind: "issued" | "received", id: string, purpose: "payment" | "mail" | "unmatched") => {
    const row = invoices.get(`${kind}:${id}`), source = kind === "received" ? received.get(id) : undefined;
    const payments = sorted(activePaymentsFor(data, kind, id)).map(payment);
    if (purpose === "mail") return [row?.eligible, row?.total, payments, Boolean(source?.mailProcessed), sorted(data.mailDocuments.filter((mail) => !mail.deletedAt && (mail.company || "JAPAN") === company && mail.relatedReceivedInvoiceId === id)).map((mail) => [mail.id, Boolean(mail.mailProcessed)])];
    return [row?.eligible, row?.status, row?.total, payments, purpose === "unmatched" ? [row?.matched, row?.recordedUnmatched, sorted(links.filter((link) => link.invoiceKind === kind && link.invoiceId === id)).map((link) => reconciliation(link.id))] : null];
  };
  const mail = (issue: MailIntegrityIssue) => {
    const row = issue.mailDocumentId ? mailMap.get(issue.mailDocumentId) : undefined;
    if (issue.kind === "BROKEN_LINK") {
      const target = row?.relatedReceivedInvoiceId && received.get(row.relatedReceivedInvoiceId);
      return [row?.company || "JAPAN", Boolean(row?.deletedAt), row?.relatedReceivedInvoiceId, target && [target.id, Boolean(target.deletedAt), project(target.projectId)]];
    }
    return row ? [row.company || "JAPAN", Boolean(row.deletedAt), row.fileUrl, false] : [received.get(issue.receivedInvoiceId!)?.fileUrl, false, project(received.get(issue.receivedInvoiceId!)?.projectId || "")];
  };
  const salesLinks = (id: string) => sorted(links.filter((link) => link.transactionId === id && link.invoiceKind === "issued" && issued.has(link.invoiceId) && !issued.get(link.invoiceId)!.deletedAt)).map((link) => [link.id, link.invoiceId]);
  return { bank, invoice, reconciliation, mail, salesLinks, transferRow,
    transfer: (link: BankTransfer) => [link.id, link.company, link.outgoingId, link.incomingId, link.outgoingEvidence, link.incomingEvidence, link.fee?.amount, transferRow(bankMap.get(link.outgoingId)), transferRow(bankMap.get(link.incomingId))] };
}
