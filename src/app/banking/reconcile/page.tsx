import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { BankReconciliationWorkspace } from "@/components/app/bank-reconciliation-workspace";
import { getCurrentUser } from "@/lib/auth";
import { bankReconciliationOverview, reconciliationCandidates } from "@/lib/bank-reconciliation";
import { companyFromParam } from "@/lib/company";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";
import { prepareBankAi } from "@/lib/bank-ai";
import { bankDocumentReview } from "@/lib/bank-review";
import { bankToday } from "@/lib/banking";
import { effectiveOcrConfig } from "@/lib/ocr-settings";

export default async function BankReconciliationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:banking")) redirect(defaultPathForRole(user.role));
  const params = await searchParams, company = companyFromParam(params.company), data = await readDataForRequest();
  const overview = bankReconciliationOverview(data, company);
  const filters = { account: params.account || "", month: /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month || "") ? params.month! : "", status: ["all", "matched", "conflict", "excluded"].includes(params.status || "") ? params.status! : "unmatched", query: (params.q || "").slice(0, 200), invoice: params.invoice || "" };
  const focus = overview.invoices.find((row) => row.key === filters.invoice);
  const linkedBankIds = new Set(overview.links.filter((row) => row.invoiceKey === focus?.key).map((row) => row.transactionId));
  const query = filters.query.normalize("NFKC").toLocaleLowerCase("ja");
  const bankRows = overview.banks.filter((row) => (!filters.account || row.accountId === filters.account) && (!filters.month || row.date.startsWith(filters.month)) && (filters.status === "all" || row.state === filters.status) && (!query || `${row.content} ${row.amount}`.normalize("NFKC").toLocaleLowerCase("ja").includes(query)) && (!filters.invoice || (focus && (linkedBankIds.has(row.id) || reconciliationCandidates(row, [focus]).length > 0)))).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const page = Math.min(Math.max(1, Math.floor(Number(params.page) || 1)), Math.max(1, Math.ceil(bankRows.length / 50)));
  const rows = bankRows.slice((page - 1) * 50, page * 50);
  const selected = params.transaction ? overview.banks.find((row) => row.id === params.transaction) : rows[0];
  const candidates = selected ? reconciliationCandidates(selected, overview.invoices) : [];
  const view = params.view === "checks" ? "checks" : params.view === "invoices" ? "invoices" : "bank";
  const today = bankToday(), month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.checkMonth || "") && params.checkMonth! <= today.slice(0, 7) ? params.checkMonth! : today.slice(0, 7);
  const aiPreview = view === "checks" ? prepareBankAi(data, company, { mode: "month", month }, today, overview).preview : view === "bank" && selected ? prepareBankAi(data, company, { mode: "transaction", transactionId: selected.id }, today, overview).preview : undefined;
  const review = view === "checks" ? bankDocumentReview(data, company, overview, params.checkKind, Number(params.checkPage) || 1) : undefined;
  const aiConfig = await effectiveOcrConfig();
  return <AppShell><BankReconciliationWorkspace key={`${company}:${filters.query}:${params.view || "bank"}`} company={company} filters={filters} rows={rows} selected={selected} candidates={candidates}
    invoices={overview.invoices} links={overview.links} accounts={data.bankAccounts.filter((row) => row.company === company).map((row) => ({ id: row.id, name: row.name }))}
    page={page} total={bankRows.length} initialView={view} unlinkedMailCount={overview.unlinkedMailCount}
    aiPreview={aiPreview} aiConfigured={Boolean(aiConfig.openAiApiKey)} aiModel={aiConfig.ocrAiModel} review={review}
    aiSettings={can(user, "manage:settings") ? { keyFromEnv: aiConfig.openAiSource === "env", modelFromEnv: aiConfig.ocrAiModelSource === "env" } : undefined}
    counts={{ unmatched: overview.banks.filter((row) => row.state === "unmatched").length, recorded: overview.invoices.filter((row) => row.eligible && row.recordedUnmatched > 0).length, overdue: overview.invoices.filter((row) => row.overdue).length, conflicts: overview.links.filter((row) => row.issue).length + overview.invoices.filter((row) => row.stateMismatch || row.overpaid).length }} /></AppShell>;
}
