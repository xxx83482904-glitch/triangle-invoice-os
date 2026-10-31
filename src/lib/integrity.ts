import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";
import type { BankTransaction } from "@/lib/banking-types";
import { bankReconciliationOverview, type ReconciliationOverview } from "@/lib/bank-reconciliation";
import { bankToday } from "@/lib/banking";
import { GUESS_ACKNOWLEDGED_PREFIX, isGuessClassification } from "@/lib/bank-classification";
import { createBankSalesSuggester } from "@/lib/bank-sales-suggestion";
import { mailIntegrityReport } from "@/lib/mail-links";
import { knownBankCardSettlement } from "@/lib/bank-card-settlement";
import { bankTransferIssue } from "@/lib/bank-transfers";
import { activePaymentsFor, isLegacyStatusPayment } from "@/lib/payment-records";

// Read-only rule checks over saved data. A hit is something to look at, not a confirmed error,
// and nothing here changes data: every fix happens on the screen the issue links to.
export const integrityKinds = {
  reconciliation_conflict: { label: "要再確認の照合", description: "照合後に請求書・支払記録・銀行明細のいずれかが変わった照合です。", action: "照合画面で内容を確認し、問題なければ「内容を確認して照合を維持」、違っていれば解除して再照合してください" },
  payment_mismatch: { label: "支払記録と請求額・状態の不整合", description: "支払記録の合計が請求額を超えている、または書類の状態と支払記録の完了状態が一致していません。", action: "書類の支払記録一覧で金額修正・取消を行い、状態を支払記録に合わせてください" },
  mail_link: { label: "郵便物の参照切れ・原本欠落", description: "郵便物が削除済みの受領請求書を参照している、または原本ファイルが見つかりません。", action: "郵便物フォルダーで「受領請求書を作り直す」か既存書類へ再連携し、原本は再アップロードしてください" },
  reviewed_guess: { label: "推測のまま確認済み", description: "根拠の弱い推測の科目が、内容確認の記録なしに確認済みになっています（確認ガード導入前のデータ）。", action: "未確認に戻して摘要と科目を見直すか、科目を選び直してから確認済みにしてください" },
  reviewed_undecided: { label: "確認済みだが記帳メモ未確定", description: "確認済みの明細で、請求書要否が「未確定」のまま、または保留が残っています。", action: "記帳詳細で請求書要否を決めるか、保留を解消してください" },
  reconciled_income_not_sales: { label: "照合済み入金が売上系以外の科目", description: "発行請求書と照合済みの入金の科目が未設定、または売上系以外です。前受金・立替精算など正当な場合もあります。", action: "口座・カード明細の提案から売上科目を採用するか、意図した科目であれば確認済みにしてください" },
  paid_without_bank: { label: "支払・入金記録あり・銀行未照合", description: "支払・入金記録があるのに銀行明細と照合されていません。現金・手入力の支払いもあり得ます。", action: "照合画面で既存の支払記録に銀行明細を紐づけてください。旧ステータス変更由来の記録は取消を検討してください" },
  category_spread: { label: "同じ摘要で科目が分散", description: "同じ事業者・方向・摘要の確認済み明細に複数の科目が使われています。", action: "摘要で絞り込んで科目をそろえるか、ルールを登録してください" },
  transfer_half: { label: "振替の片側のみ・資金移動の不整合", description: "振替扱いの明細に資金移動の相手がない、または資金移動の照合に不整合があります。カード精算など相手のない振替もあります。", action: "資金移動の照合を確認し、相手口座の明細と組にするか、扱いを見直してください" },
} as const;
export type IntegrityKind = keyof typeof integrityKinds;
export type IntegritySeverity = "ERROR" | "WARNING" | "INFO";
export const integritySeverityLabels: Record<IntegritySeverity, string> = { ERROR: "要対応", WARNING: "確認", INFO: "参考" };
export type IntegrityLink = { label: string; href: string };
export type IntegrityTarget = { type: "bankTransaction" | "receivedInvoice" | "issuedInvoice" | "mailDocument" | "reconciliation" | "transfer" | "group"; id: string };
export type IntegrityIssue = { id: string; kind: IntegrityKind; severity: IntegritySeverity; title: string; detail: string; action: string; date: string; links: IntegrityLink[]; target: IntegrityTarget };
export type IntegrityKindSummary = { kind: IntegrityKind; label: string; description: string; action: string; count: number };
export type IntegrityReport = {
  company: CompanyScope; today: string; generatedAt: string; total: number;
  counts: Record<IntegrityKind, number>; severity: Record<IntegritySeverity, number>;
  kinds: IntegrityKindSummary[]; truncated: IntegrityKind[]; issues: IntegrityIssue[];
};
export type IntegritySummary = Omit<IntegrityReport, "issues">;
export type IntegrityView = { kind: IntegrityKind | "all"; items: IntegrityIssue[]; page: number; pages: number; pageSize: number; filteredTotal: number };

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

export function integrityReport(data: AppData, company: CompanyScope, options: { today?: string; fileExists?: (fileUrl?: string) => boolean | undefined; overview?: ReconciliationOverview } = {}): IntegrityReport {
  const today = options.today || bankToday();
  const overview = options.overview || bankReconciliationOverview(data, company, today);
  const issues: IntegrityIssue[] = [];
  const push = (issue: Omit<IntegrityIssue, "action">) => issues.push({ ...issue, action: integrityKinds[issue.kind].action });
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
      date: bank?.date || "", links: [{ label: "照合記録", href: reconcileHref(company, link.transactionId) }, ...(invoice ? [{ label: "書類", href: invoice.href }] : [])], target: { type: "reconciliation", id: link.id } });
  }
  for (const invoice of overview.invoices) {
    if (!invoice.eligible) continue;
    const target: IntegrityTarget = { type: invoice.kind === "issued" ? "issuedInvoice" : "receivedInvoice", id: invoice.id };
    const links = [{ label: invoice.kind === "issued" ? "発行請求書" : "受領請求書", href: invoice.href }, { label: "照合記録", href: `/banking/reconcile?company=${company}&invoice=${encodeURIComponent(invoice.key)}&status=all` }];
    if (invoice.overpaid > 0 || invoice.stateMismatch) push({ id: `payment_mismatch:${invoice.key}`, kind: "payment_mismatch", severity: invoice.overpaid > 0 ? "ERROR" : "WARNING", title: `${invoice.title} / ${invoice.party}`,
      detail: [invoice.overpaid > 0 ? `支払記録の合計が請求額を ${money(invoice.overpaid)} 超えています` : "", invoice.stateMismatch ? `書類の状態「${invoice.status}」と支払記録の完了状態（記録 ${money(invoice.paid)} / 請求額 ${money(invoice.total)}）が一致しません` : ""].filter(Boolean).join("。"),
      date: invoice.date, links, target });
    if (invoice.recordedUnmatched > 0) {
      const legacy = activePaymentsFor(data, invoice.kind, invoice.id).filter(isLegacyStatusPayment).length;
      push({ id: `paid_without_bank:${invoice.key}`, kind: "paid_without_bank", severity: legacy ? "WARNING" : "INFO", title: `${invoice.title} / ${invoice.party}`,
        detail: `支払・入金記録 ${money(invoice.paid)} のうち ${money(invoice.recordedUnmatched)} が銀行未照合です${legacy ? `。旧ステータス変更由来の記録が ${legacy}件あり、実際の支払いの裏付けを確認してください` : ""}`,
        date: invoice.date, links, target });
    }
  }
  for (const issue of mailIntegrityReport(data, company, options.fileExists).issues) {
    const mail = Boolean(issue.mailDocumentId);
    push({ id: `mail_link:${issue.kind}:${issue.mailDocumentId || issue.receivedInvoiceId}`, kind: "mail_link", severity: issue.kind === "BROKEN_LINK" ? "ERROR" : "WARNING", title: issue.title, detail: issue.detail, date: issue.folderMonth,
      links: mail ? [{ label: "郵便物", href: `/mail-sorter?company=${company}` }] : [{ label: "受領請求書", href: `/received-invoices?company=${company}&document=${encodeURIComponent(issue.receivedInvoiceId!)}` }],
      target: mail ? { type: "mailDocument", id: issue.mailDocumentId! } : { type: "receivedInvoice", id: issue.receivedInvoiceId! } });
  }

  const suggestSales = createBankSalesSuggester(data);
  const transfers = (data.bankTransfers || []).filter((link) => !link.deletedAt && link.company === company);
  const transferLinked = new Set(transfers.flatMap((link) => [link.outgoingId, link.incomingId]));
  const groups = new Map<string, { content: string; side: BankTransaction["side"]; rows: BankTransaction[]; selections: Map<string, number> }>();
  for (const row of data.bankTransactions) {
    if (row.company !== company || row.sourceMissing) continue;
    const links = [{ label: "明細", href: bankHref(company, row) }];
    const target: IntegrityTarget = { type: "bankTransaction", id: row.id };
    if (row.reviewed && row.treatment === "NORMAL" && (row.bookkeeping?.hold || row.bookkeeping?.invoiceRequirement === "UNDECIDED")) push({ id: `reviewed_undecided:${row.id}`, kind: "reviewed_undecided", severity: row.bookkeeping?.hold ? "ERROR" : "INFO", title: bankTitle(row),
      detail: row.bookkeeping?.hold ? `確認済みなのに保留が残っています: ${row.bookkeeping.hold.question}` : "確認済みですが請求書要否が「未確定」のままです", date: row.transactionDate, links, target });
    if (row.reviewed && isGuessClassification(row) && !(row.classificationReason || "").startsWith(GUESS_ACKNOWLEDGED_PREFIX)) push({ id: `reviewed_guess:${row.id}`, kind: "reviewed_guess", severity: "WARNING", title: bankTitle(row),
      detail: `科目「${categoryName(row.categoryId)}」は推測候補のまま確認済みです${row.classificationReason ? `（根拠: ${row.classificationReason}）` : ""}`, date: row.transactionDate, links, target });
    const sales = suggestSales(row);
    if (sales) push({ id: `reconciled_income_not_sales:${row.id}`, kind: "reconciled_income_not_sales", severity: "INFO", title: bankTitle(row), detail: sales.reason, date: row.transactionDate, links: [...links, { label: "照合記録", href: reconcileHref(company, row.id) }], target });
    if (row.treatment === "TRANSFER" && !transferLinked.has(row.id) && !knownBankCardSettlement(data, row)) push({ id: `transfer_half:${row.id}`, kind: "transfer_half", severity: "INFO", title: bankTitle(row),
      detail: "振替・カード精算の扱いですが、資金移動の相手明細と照合されていません", date: row.transactionDate, links: [...links, { label: "照合記録", href: reconcileHref(company, row.id) }], target });
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
      links: [{ label: "照合記録", href: reconcileHref(company, link.outgoingId) }], target: { type: "transfer", id: link.id } });
  }
  for (const [key, group] of groups) {
    if (group.selections.size < 2) continue;
    const latest = group.rows.map((row) => row.transactionDate).sort().at(-1) || "";
    const breakdown = [...group.selections.entries()].sort((a, b) => b[1] - a[1]).map(([selection, count]) => { const [categoryId, subCategoryId] = selection.split("|"); return `${categoryName(categoryId)}${subCategoryId ? ` / ${categoryName(subCategoryId)}` : ""} ${count}件`; }).join(" / ");
    push({ id: `category_spread:${key}`, kind: "category_spread", severity: "INFO", title: `${group.content}（${sideLabel(group.side)}）`, detail: `確認済み ${group.rows.length}件で科目が ${group.selections.size}種類に分かれています: ${breakdown}`, date: latest,
      links: [{ label: "該当明細", href: `/banking?${new URLSearchParams({ company, q: group.content, queryMode: "exact", status: "reviewed" })}` }], target: { type: "group", id: key } });
  }

  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(kindOrder.map((kind) => [kind, 0])) as Record<IntegrityKind, number>;
  const severity: Record<IntegritySeverity, number> = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const issue of issues) { counts[issue.kind]++; severity[issue.severity]++; }
  const kept = Object.fromEntries(kindOrder.map((kind) => [kind, 0])) as Record<IntegrityKind, number>;
  const limited = issues.filter((issue) => ++kept[issue.kind] <= INTEGRITY_KIND_LIMIT);
  return { company, today, generatedAt: new Date().toISOString(), total: issues.length, counts, severity, truncated: kindOrder.filter((kind) => counts[kind] > INTEGRITY_KIND_LIMIT),
    kinds: kindOrder.map((kind) => ({ kind, ...integrityKinds[kind], count: counts[kind] })), issues: limited };
}

export function summarizeIntegrity(report: IntegrityReport): IntegritySummary {
  return { company: report.company, today: report.today, generatedAt: report.generatedAt, total: report.total, counts: report.counts, severity: report.severity, kinds: report.kinds, truncated: report.truncated };
}

export function filterIntegrityReport(report: IntegrityReport, kind?: string, pageNumber = 1, pageSize = 50): IntegrityView {
  const selected: IntegrityKind | "all" = kind && Object.hasOwn(integrityKinds, kind) ? kind as IntegrityKind : "all";
  const filtered = selected === "all" ? report.issues : report.issues.filter((issue) => issue.kind === selected);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, Number.isFinite(pageNumber) ? Math.floor(pageNumber) : 1), pages);
  return { kind: selected, items: filtered.slice((page - 1) * pageSize, page * pageSize), page, pages, pageSize, filteredTotal: filtered.length };
}
