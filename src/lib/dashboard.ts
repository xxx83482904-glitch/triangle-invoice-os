import { outstandingAmount } from "@/lib/accounting-summary";
import { bankAccountOverview, bankFiscalYear } from "@/lib/bank-account-overview";
import { isBankDate } from "@/lib/banking";
import { matchesCompany, type CompanyScope } from "@/lib/company";
import { isBillableIssuedInvoice, visibleProjects } from "@/lib/documents";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

export type DashboardDocument = {
  id: string; kind: "issued" | "received"; title: string; partner: string; project: string;
  href: string; dueDate: string; amount: number; remaining: number; reasons: string[];
  timing: "overdue" | "soon" | "later" | "undated"; paymentMismatch: boolean;
};

export function dashboardSummary(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, today: string, requestedYear?: string) {
  assertCan(user, "view:dashboard");
  assertCompanyAccess(user, company);
  if (!isBankDate(today)) throw new Error("基準日が不正です");
  const currentYear = bankFiscalYear(today);
  const year = requestedYear && /^\d{4}$/.test(requestedYear) && Number(requestedYear) >= 1901 && Number(requestedYear) <= currentYear ? Number(requestedYear) : currentYear;
  const overview = bankAccountOverview(data, company, undefined, today, String(year));
  const period = overview.period;
  const through = period.end < today ? period.end : today;
  const projects = visibleProjects(data, user).filter((row) => matchesCompany(row, company));
  const projectById = new Map(projects.map((row) => [row.id, row]));
  const clients = new Map(data.clients.map((row) => [row.id, row.companyName]));
  const vendors = new Map(data.vendors.map((row) => [row.id, row.companyName]));
  const issued = data.issuedInvoices.filter((row) => !row.deletedAt && projectById.has(row.projectId) && row.status !== "CANCELED");
  const received = data.receivedInvoices.filter((row) => !row.deletedAt && projectById.has(row.projectId) && !["REJECTED", "ARCHIVED"].includes(row.status));
  const issuedIds = new Set(issued.map((row) => row.id)), receivedIds = new Set(received.map((row) => row.id));
  const paid = new Map<string, number>();
  // Reconciliation-generated payments count once. Bank rows are never added to invoice payments.
  for (const payment of data.payments) {
    if (payment.deletedAt || !Number.isFinite(payment.amount)) continue;
    const key = payment.type === "INCOME" && payment.issuedInvoiceId && issuedIds.has(payment.issuedInvoiceId) ? `issued:${payment.issuedInvoiceId}`
      : payment.type === "EXPENSE" && payment.receivedInvoiceId && receivedIds.has(payment.receivedInvoiceId) ? `received:${payment.receivedInvoiceId}` : undefined;
    if (key) paid.set(key, (paid.get(key) || 0) + payment.amount);
  }
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const timing = (date: string): DashboardDocument["timing"] => !isBankDate(date) ? "undated" : date < today ? "overdue" : date <= soon ? "soon" : "later";
  const documents: DashboardDocument[] = [];
  for (const kind of ["issued", "received"] as const) {
    for (const invoice of kind === "issued" ? issued : received) {
      const id = `${kind}:${invoice.id}`;
      const isDraft = kind === "issued" && invoice.status === "DRAFT";
      const amount = Number.isFinite(invoice.total) ? Math.max(0, invoice.total) : 0;
      const remaining = isDraft ? 0 : outstandingAmount(amount, paid.get(id) || 0);
      const paymentMismatch = invoice.status === "PAID" && remaining > 0;
      const reasons = [
        ...(isDraft ? ["下書き"] : []),
        ...("needsReview" in invoice && invoice.needsReview || ["OCR_PENDING", "REVIEWING", "APPROVAL_PENDING"].includes(invoice.status) ? ["内容確認"] : []),
        ...(!isBankDate(invoice.issueDate) ? ["発行日未設定"] : []),
        ...(!isBankDate(invoice.dueDate) && remaining > 0 ? ["期限未設定"] : []),
        ...(!amount ? ["金額未設定"] : []),
        ...(paymentMismatch ? [kind === "issued" ? "入金記録要確認" : "支払記録要確認"] : []),
      ];
      documents.push({ id, kind, title: "invoiceNumber" in invoice ? invoice.invoiceNumber : invoice.originalFileName || "受領請求書",
        partner: "clientId" in invoice ? clients.get(invoice.clientId) || "請求先未設定" : vendors.get(invoice.vendorId) || "支払先未設定",
        project: projectById.get(invoice.projectId)!.name, amount, remaining, dueDate: isBankDate(invoice.dueDate) ? invoice.dueDate : "",
        href: kind === "issued" ? `/issued-invoices?company=${company}&document=${encodeURIComponent(id)}` : `/received-invoices?company=${company}&document=${encodeURIComponent(invoice.id)}`,
        timing: timing(invoice.dueDate), paymentMismatch, reasons });
    }
  }
  const priority = { overdue: 0, soon: 1, undated: 2, later: 3 };
  documents.sort((a, b) => priority[a.timing] - priority[b.timing] || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const receivables = documents.filter((row) => row.kind === "issued" && row.remaining > 0);
  const payables = documents.filter((row) => row.kind === "received" && row.remaining > 0);
  const review = documents.filter((row) => row.reasons.length > 0);
  const totals = (rows: DashboardDocument[]) => ({ amount: rows.reduce((sum, row) => sum + row.remaining, 0), count: rows.length,
    overdue: rows.filter((row) => row.timing === "overdue" && !row.paymentMismatch).length,
    soon: rows.filter((row) => row.timing === "soon" && !row.paymentMismatch).length });
  const banks = overview.rows.filter((row) => row.kind === "BANK" && !row.unspecified);
  const registered = banks.filter((row) => row.balanceCalculation);
  const inPeriod = (date: string) => isBankDate(date) && date >= period.start && date <= through;
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${index < 4 ? year - 1 : year}-${String((index + 8) % 12 + 1).padStart(2, "0")}`;
    const bankPoints = banks.map((row) => row.history[index]);
    const issuedTotal = issued.filter((row) => isBillableIssuedInvoice(row) && inPeriod(row.issueDate) && row.issueDate.startsWith(month)).reduce((sum, row) => sum + row.total, 0);
    const receivedTotal = received.filter((row) => Number.isFinite(row.total) && row.total > 0 && inPeriod(row.issueDate) && row.issueDate.startsWith(month)).reduce((sum, row) => sum + row.total, 0);
    return { month, income: bankPoints.reduce((sum, point) => sum + point.income, 0), expense: bankPoints.reduce((sum, point) => sum + point.expense, 0),
      count: bankPoints.reduce((sum, point) => sum + point.count, 0), covered: banks.length > 0 && bankPoints.every((point) => point.covered), future: `${month}-01` > today, issued: issuedTotal, received: receivedTotal };
  });
  const visibleReceived = new Map(received.map((row) => [row.id, row]));
  const mailInvoiceIds = new Set<string>();
  let pendingMail = 0;
  if (company === "JAPAN") {
    for (const mail of data.mailDocuments) {
      if (mail.deletedAt || mail.company === "CHINA") continue;
      const invoice = mail.relatedReceivedInvoiceId ? visibleReceived.get(mail.relatedReceivedInvoiceId) : undefined;
      if (invoice) {
        if (mailInvoiceIds.has(invoice.id)) continue;
        mailInvoiceIds.add(invoice.id);
        if (!(invoice.mailProcessed ?? invoice.status === "PAID")) pendingMail++;
      } else if (!(mail.mailProcessed ?? Boolean(mail.relatedReceivedInvoiceId))) pendingMail++;
    }
    pendingMail += received.filter((row) => !mailInvoiceIds.has(row.id) && !(row.mailProcessed ?? row.status === "PAID")).length;
  }
  const transactions = data.bankTransactions.filter((row) => row.company === company);
  const sync = data.bankSyncStates.filter((row) => row.company === company);
  const availableYears = [...new Set([currentYear, currentYear - 1, year, ...overview.fiscalYears,
    ...[...issued, ...received].filter((row) => isBankDate(row.issueDate) && row.issueDate <= today && row.issueDate >= "1900-09-01").map((row) => bankFiscalYear(row.issueDate))])].sort((a, b) => b - a);
  return { company, today, period, through, availableYears, months, receivables, payables, review,
    incoming: totals(receivables), outgoing: totals(payables), pendingMail,
    projectCount: projects.filter((row) => !["COMPLETED", "ARCHIVED"].includes(row.status)).length,
    cash: { amount: registered.length ? registered.reduce((sum, row) => sum + row.balanceCalculation!.amount, 0) : null,
      registered: registered.length, missing: banks.length - registered.length, provisional: registered.filter((row) => !row.balanceCalculation!.complete).length,
      unknownAccounts: overview.rows.filter((row) => !["BANK", "CARD"].includes(row.kind)).length },
    accounts: banks.map(({ id, name, balance, balanceCalculation, kind, unspecified }) => ({ id, name, balance, balanceCalculation, kind, unspecified })),
    banking: { unreviewed: transactions.filter((row) => !row.reviewed).length, missing: transactions.filter((row) => row.sourceMissing).length,
      syncErrors: sync.filter((row) => row.status === "ERROR").length, syncing: sync.some((row) => row.status === "RUNNING"),
      lastSyncAt: sync.map((row) => row.lastSuccessAt).filter((value): value is string => Boolean(value)).sort().at(-1),
      latestDate: transactions.filter((row) => !row.sourceMissing && isBankDate(row.transactionDate) && row.transactionDate <= today).map((row) => row.transactionDate).sort().at(-1) },
  };
}

export type DashboardSummary = ReturnType<typeof dashboardSummary>;
