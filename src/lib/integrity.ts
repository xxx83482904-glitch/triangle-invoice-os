import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";
import type { BankTransaction } from "@/lib/banking-types";
import { bankReconciliationOverview, type ReconciliationOverview } from "@/lib/bank-reconciliation";
import { bankToday } from "@/lib/banking";
import { GUESS_ACKNOWLEDGED_PREFIX, isGuessClassification } from "@/lib/bank-classification";
import { createBankSalesSuggester } from "@/lib/bank-sales-suggestion";
import { mailIntegrityReport } from "@/lib/mail-links";
import { integrityBankCardSettlement } from "@/lib/bank-card-settlement";
import { bankTransferIssue } from "@/lib/bank-transfers";
import { activePaymentsFor, isLegacyStatusPayment } from "@/lib/payment-records";

import { integrityKinds, type IntegrityKind, type IntegrityIssue, type IntegrityTarget, type IntegritySeverity, type IntegrityReport, type IntegritySummary, type IntegrityView } from "@/lib/integrity-types";
import { integrityFingerprint, createIntegrityEvidence } from "@/lib/integrity-fingerprint";
export * from "@/lib/integrity-types";

export const INTEGRITY_KIND_LIMIT = 500;
const kindOrder = Object.keys(integrityKinds) as IntegrityKind[];
const severityRank: Record<IntegritySeverity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };
const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
const genericContent = /^(振込|振替|入金|出金|送金|振込入金|振込出金|カード|利用|口座振替|デビット|手数料)$/;
const sideLabel = (side: BankTransaction["side"]) => side === "INCOME" ? "入金" : "出金";
const bankTitle = (row: BankTransaction) => `${row.transactionDate} / ${row.content || "摘要なし"} / ${row.side === "INCOME" ? "+" : "-"}${money(row.amount)}`;
function bankHref(company: CompanyScope, row: Pick<BankTransaction, "transactionDate" | "content">) {
  const params = new URLSearchParams({ company, month: row.transactionDate.slice(0, 7) });
  if (row.content) { params.set("q", row.content); params.set("queryMode", "exact"); }
  return `/banking?${params}`;
}
const reconcileHref = (company: CompanyScope, transactionId: string) => `/banking/reconcile?company=${company}&transaction=${encodeURIComponent(transactionId)}&status=all`;

export function integrityReport(data: AppData, company: CompanyScope, options: { today?: string; fileExists?: (fileUrl?: string) => boolean | undefined; overview?: ReconciliationOverview; includeKnown?: boolean } = {}): IntegrityReport {
  const today = options.today || bankToday();
  const overview = options.overview || bankReconciliationOverview(data, company, today);
  const issues: IntegrityIssue[] = [];
  const evidence = createIntegrityEvidence(data, company, overview);
  const push = (issue: Omit<IntegrityIssue, "action" | "fingerprint" | "known">, values: unknown) => issues.push({ ...issue, fingerprint: integrityFingerprint(issue.kind, values), action: integrityKinds[issue.kind].action });
  const categories = new Map(data.accountingCategories.map((row) => [row.id, row.name]));
  const categoryName = (id?: string) => (id && categories.get(id)) || (id ? `不明な科目 (${id})` : "未設定");

  const banks = new Map(overview.banks.map((row) => [row.id, row]));
  const invoices = new Map(overview.invoices.map((row) => [row.key, row]));
  for (const link of overview.links) {
    if (!link.issue) continue;
    const bank = banks.get(link.transactionId), invoice = invoices.get(link.invoiceKey);
    push({ id: `reconciliation_conflict:${link.id}`, kind: "reconciliation_conflict", severity: "ERROR",
      title: `${bank ? `${bank.date} / ${bank.content || "摘要なし"}` : link.transactionId} ↔ ${invoice ? `${invoice.title} / ${invoice.party}` : link.invoiceKey}`,
      detail: `${link.issue}${link.reaffirmable ? "。内容が正しければ照合を維持できます" : link.reaffirmBlocker ? `。${link.reaffirmBlocker}` : ""}`,
      date: bank?.date || "", links: [{ label: "照合記録", href: reconcileHref(company, link.transactionId) }, ...(invoice ? [{ label: "書類", href: invoice.href }] : [])], target: { type: "reconciliation", id: link.id } }, evidence.reconciliation(link.id));
  }
  for (const invoice of overview.invoices) {
    if (!invoice.eligible) continue;
    const target: IntegrityTarget = { type: invoice.kind === "issued" ? "issuedInvoice" : "receivedInvoice", id: invoice.id };
    const links = [{ label: invoice.kind === "issued" ? "発行請求書" : "受領請求書", href: invoice.href }, { label: "照合記録", href: `/banking/reconcile?company=${company}&invoice=${encodeURIComponent(invoice.key)}&status=all` }];
    if (invoice.overpaid > 0 || invoice.stateMismatch) push({ id: `payment_mismatch:${invoice.key}`, kind: "payment_mismatch", severity: invoice.overpaid > 0 ? "ERROR" : "WARNING", title: `${invoice.title} / ${invoice.party}`,
      detail: [invoice.overpaid > 0 ? `支払記録の合計が請求額を ${money(invoice.overpaid)} 超えています` : "", invoice.stateMismatch ? `書類の状態「${invoice.status}」と支払記録の完了状態（記録 ${money(invoice.paid)} / 請求額 ${money(invoice.total)}）が一致しません` : ""].filter(Boolean).join("。"),
      date: invoice.date, links, target }, evidence.invoice(invoice.kind, invoice.id, "payment"));
    if (invoice.mailProcessingMismatch) push({ id: `mail_processing_mismatch:${invoice.key}`, kind: "mail_processing_mismatch", severity: "INFO", title: `${invoice.title} / ${invoice.party}`,
      detail: `受領請求書または連携郵便物の処理状態と、支払記録の完了状態（記録 ${money(invoice.paid)} / 請求額 ${money(invoice.total)}）が異なります。書類整理と支払いは独立した状態のため、この差だけでは支払記録・請求書の状態の不整合ではありません`,
      date: invoice.date, links: [{ label: "郵便物", href: `/mail-sorter?company=${company}` }, { label: "受領請求書", href: invoice.href }], target }, evidence.invoice(invoice.kind, invoice.id, "mail"));
    if (invoice.recordedUnmatched > 0) {
      const legacy = activePaymentsFor(data, invoice.kind, invoice.id).filter(isLegacyStatusPayment).length;
      push({ id: `paid_without_bank:${invoice.key}`, kind: "paid_without_bank", severity: legacy ? "WARNING" : "INFO", title: `${invoice.title} / ${invoice.party}`,
        detail: `支払・入金記録 ${money(invoice.paid)} のうち ${money(invoice.recordedUnmatched)} が銀行未照合です${legacy ? `。旧ステータス変更由来の記録が ${legacy}件あり、実際の支払いの裏付けを確認してください` : ""}`,
        date: invoice.date, links, target }, evidence.invoice(invoice.kind, invoice.id, "unmatched"));
    }
  }
  for (const issue of mailIntegrityReport(data, company, options.fileExists).issues) {
    const mail = Boolean(issue.mailDocumentId);
    push({ id: `mail_link:${issue.kind}:${issue.mailDocumentId || issue.receivedInvoiceId}`, kind: "mail_link", severity: issue.kind === "BROKEN_LINK" ? "ERROR" : "WARNING", title: issue.title, detail: issue.detail, date: issue.folderMonth,
      links: mail ? [{ label: "郵便物", href: `/mail-sorter?company=${company}` }] : [{ label: "受領請求書", href: `/received-invoices?company=${company}&document=${encodeURIComponent(issue.receivedInvoiceId!)}` }],
      target: mail ? { type: "mailDocument", id: issue.mailDocumentId! } : { type: "receivedInvoice", id: issue.receivedInvoiceId! } }, evidence.mail(issue));
  }

  const settlements = new Map<string, { provider: string; label: string; count: number }>();
  const suggestSales = createBankSalesSuggester(data);
  const transfers = (data.bankTransfers || []).filter((link) => !link.deletedAt && link.company === company);
  const transferLinked = new Set(transfers.flatMap((link) => [link.outgoingId, link.incomingId]));
  const groups = new Map<string, { content: string; side: BankTransaction["side"]; rows: BankTransaction[]; selections: Map<string, number> }>();
  for (const row of data.bankTransactions) {
    if (row.company !== company || row.sourceMissing) continue;
    const links = [{ label: "明細", href: bankHref(company, row) }];
    const target: IntegrityTarget = { type: "bankTransaction", id: row.id };
    if (row.reviewed && row.treatment === "NORMAL" && (row.bookkeeping?.hold || row.bookkeeping?.invoiceRequirement === "UNDECIDED")) push({ id: `reviewed_undecided:${row.id}`, kind: "reviewed_undecided", severity: row.bookkeeping?.hold ? "ERROR" : "INFO", title: bankTitle(row),
      detail: row.bookkeeping?.hold ? `確認済みなのに保留が残っています: ${row.bookkeeping.hold.question}` : "確認済みですが請求書要否が「未確定」のままです", date: row.transactionDate, links, target }, [evidence.bank(row), row.reviewed, row.treatment, row.bookkeeping?.invoiceRequirement, row.bookkeeping?.hold && { reason: row.bookkeeping.hold.reason, question: row.bookkeeping.hold.question }]);
    if (row.reviewed && isGuessClassification(row) && !(row.classificationReason || "").startsWith(GUESS_ACKNOWLEDGED_PREFIX)) push({ id: `reviewed_guess:${row.id}`, kind: "reviewed_guess", severity: "WARNING", title: bankTitle(row),
      detail: `科目「${categoryName(row.categoryId)}」は推測候補のまま確認済みです${row.classificationReason ? `（根拠: ${row.classificationReason}）` : ""}`, date: row.transactionDate, links, target }, [evidence.bank(row), row.categoryId, row.subCategoryId, row.classificationConfidence, row.classificationSource, row.reviewed, row.classificationReason, row.treatment]);
    const sales = suggestSales(row);
    if (sales) push({ id: `reconciled_income_not_sales:${row.id}`, kind: "reconciled_income_not_sales", severity: "INFO", title: bankTitle(row), detail: sales.reason, date: row.transactionDate, links: [...links, { label: "照合記録", href: reconcileHref(company, row.id) }], target }, [evidence.bank(row), row.categoryId, row.treatment, sales.acceptedIds.slice().sort(), evidence.salesLinks(row.id)]);
    const settlement = row.treatment === "TRANSFER" && !transferLinked.has(row.id) ? integrityBankCardSettlement(data, row) : undefined;
    if (settlement) {
      const entry = settlements.get(settlement.provider) || { provider: settlement.provider, label: settlement.label, count: 0 };
      entry.count++; settlements.set(entry.provider, entry);
    }
    if (row.treatment === "TRANSFER" && !transferLinked.has(row.id) && !settlement) push({ id: `transfer_half:${row.id}`, kind: "transfer_half", severity: "INFO", title: bankTitle(row),
      detail: "振替・カード精算の扱いですが、資金移動の相手明細と照合されていません", date: row.transactionDate, links: [...links, { label: "照合記録", href: reconcileHref(company, row.id) }], target }, evidence.transferRow(row));
    if (row.reviewed && row.treatment === "NORMAL" && row.categoryId && !row.bookkeeping?.splits?.length) {
      const content = normalize(row.content);
      if (content.length < 3 || /^\d+$/.test(content) || genericContent.test(content)) continue;
      const key = JSON.stringify([row.officeCode, row.side, content]);
      const group = groups.get(key) || { content: row.content, side: row.side, rows: [], selections: new Map<string, number>() };
      const selection = `${row.categoryId}|${row.subCategoryId || ""}`;
      group.rows.push(row); group.selections.set(selection, (group.selections.get(selection) || 0) + 1); groups.set(key, group);
    }
  }
  for (const link of transfers) {
    const issue = bankTransferIssue(data, link, today);
    if (!issue) continue;
    const from = data.bankTransactions.find((row) => row.id === link.outgoingId), to = data.bankTransactions.find((row) => row.id === link.incomingId);
    push({ id: `transfer_half:link:${link.id}`, kind: "transfer_half", severity: "WARNING", title: `${from ? bankTitle(from) : link.outgoingId} ↔ ${to ? bankTitle(to) : link.incomingId}`, detail: issue, date: from?.transactionDate || to?.transactionDate || "",
      links: [{ label: "照合記録", href: reconcileHref(company, link.outgoingId) }], target: { type: "transfer", id: link.id } }, evidence.transfer(link));
  }
  for (const [key, group] of groups) {
    if (group.selections.size < 2) continue;
    const latest = group.rows.map((row) => row.transactionDate).sort().at(-1) || "";
    const breakdown = [...group.selections.entries()].sort((a, b) => b[1] - a[1]).map(([selection, count]) => { const [categoryId, subCategoryId] = selection.split("|"); return `${categoryName(categoryId)}${subCategoryId ? ` / ${categoryName(subCategoryId)}` : ""} ${count}件`; }).join(" / ");
    push({ id: `category_spread:${key}`, kind: "category_spread", severity: "INFO", title: `${group.content}（${sideLabel(group.side)}）`, detail: `確認済み ${group.rows.length}件で科目が ${group.selections.size}種類に分かれています: ${breakdown}`, date: latest,
      links: [{ label: "該当明細", href: `/banking?${new URLSearchParams({ company, q: group.content, queryMode: "exact", status: "reviewed" })}` }], target: { type: "group", id: key } }, group.rows.map((row) => [row.id, row.categoryId, row.subCategoryId || ""]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
  }

  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  // Newest registration wins, including a revoked registration: older entries must never revive.
  const latest = new Map<string, NonNullable<AppData["integrityAcknowledgements"]>[number]>();
  for (const ack of data.integrityAcknowledgements || []) if (ack.company === company && !latest.has(ack.issueId)) latest.set(ack.issueId, ack);
  for (const issue of issues) {
    const ack = latest.get(issue.id);
    if (ack && !ack.revokedAt && ack.kind === issue.kind && ack.fingerprint === issue.fingerprint) issue.known = {
      id: ack.id, reason: ack.reason, createdAt: ack.createdAt, createdById: ack.createdById, createdByName: ack.createdByName, updatedAt: ack.updatedAt, batchId: ack.batchId,
    };
  }
  const emptyCounts = () => Object.fromEntries(kindOrder.map((kind) => [kind, 0])) as Record<IntegrityKind, number>;
  const counts = emptyCounts(), knownCounts = emptyCounts(), kept = emptyCounts(), knownKept = emptyCounts();
  const severity: Record<IntegritySeverity, number> = { ERROR: 0, WARNING: 0, INFO: 0 };
  let knownTotal = 0;
  for (const issue of issues) {
    if (issue.known) { knownCounts[issue.kind]++; knownTotal++; }
    else { counts[issue.kind]++; severity[issue.severity]++; }
  }
  const limited = issues.filter((issue) => issue.known ? Boolean(options.includeKnown) && ++knownKept[issue.kind] <= INTEGRITY_KIND_LIMIT : ++kept[issue.kind] <= INTEGRITY_KIND_LIMIT);
  return { company, today, cardSettlements: [...settlements.values()], generatedAt: new Date().toISOString(), total: issues.length - knownTotal, knownTotal, totalIncludingKnown: issues.length, counts, knownCounts, severity,
    truncated: kindOrder.filter((kind) => counts[kind] > INTEGRITY_KIND_LIMIT), knownTruncated: kindOrder.filter((kind) => knownCounts[kind] > INTEGRITY_KIND_LIMIT),
    kinds: kindOrder.map((kind) => ({ kind, ...integrityKinds[kind], count: counts[kind], knownCount: knownCounts[kind] })), issues: limited };
}

export function summarizeIntegrity(report: IntegrityReport): IntegritySummary {
  const { issues: _issues, ...summary } = report;
  void _issues;
  return summary;
}

export function filterIntegrityReport(report: IntegrityReport, kind?: string, pageNumber = 1, pageSize = 50, knownOnly = false): IntegrityView {
  const selected: IntegrityKind | "all" = kind && Object.hasOwn(integrityKinds, kind) ? kind as IntegrityKind : "all";
  const filtered = report.issues.filter((issue) => Boolean(issue.known) === knownOnly && (selected === "all" || issue.kind === selected));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, Number.isFinite(pageNumber) ? Math.floor(pageNumber) : 1), pages);
  return { kind: selected, items: filtered.slice((page - 1) * pageSize, page * pageSize), page, pages, pageSize, filteredTotal: filtered.length, knownOnly,
    batches: knownOnly ? [] : kindOrder.filter((kind) => filtered.some((issue) => issue.kind === kind)).map((kind) => ({ kind, targets: filtered.filter((issue) => issue.kind === kind).map(({ id, fingerprint }) => ({ id, fingerprint })) })) };
}
