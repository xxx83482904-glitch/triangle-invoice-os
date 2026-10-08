import { bankReconciliationOverview, type ReconciliationOverview } from "@/lib/bank-reconciliation";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { isBankDate } from "@/lib/banking";
import type { AppData } from "@/lib/types";

export const reviewKinds = {
  inconsistent: "状態・金額の不整合", duplicate: "重複候補", unlinked_mail: "郵便物の未連携",
  recorded: "支払い登録済み・銀行未照合", bank_unmatched: "出金の書類確認",
} as const;
export type BankReviewKind = keyof typeof reviewKinds;
export type BankReviewIssue = { id: string; kind: BankReviewKind; title: string; detail: string; links: Array<{ label: string; href: string }> };
const money = (value: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);

export function bankDocumentReview(data: AppData, company: CompanyScope, overview: ReconciliationOverview = bankReconciliationOverview(data, company), filter = "all", pageNumber = 1) {
  const issues: BankReviewIssue[] = [], invoices = new Map(overview.invoices.map((row) => [row.key, row]));
  for (const row of overview.invoices) {
    if (row.stateMismatch || row.overpaid > 0 || row.conflict) issues.push({ id: `state:${row.key}`, kind: "inconsistent", title: `${row.title} / ${row.party}`, detail: [row.stateMismatch ? "支払い記録と請求書・郵便物の完了状態が一致していません。" : "", row.overpaid > 0 ? `請求額を超える支払い記録が ${money(row.overpaid)} あります。` : "", row.conflict ? "照合後に元データが変更されています。照合内容を見直してください。" : ""].filter(Boolean).join(" "), links: [{ label: "請求書", href: row.href }, { label: "照合記録", href: `/banking/reconcile?company=${company}&invoice=${encodeURIComponent(row.key)}&status=all` }] });
    if (row.eligible && row.recordedUnmatched > 0) issues.push({ id: `recorded:${row.key}`, kind: "recorded", title: `${row.title} / ${row.party}`, detail: `支払い登録済みのうち ${money(row.recordedUnmatched)} が銀行未照合です。新しい支払いを追加せず、既存記録への紐づけを確認してください。`, links: [{ label: "請求書", href: row.href }, { label: "銀行候補", href: `/banking/reconcile?company=${company}&invoice=${encodeURIComponent(row.key)}&status=all` }] });
  }
  for (const row of overview.banks) if (row.side === "EXPENSE" && row.state === "unmatched") issues.push({ id: `bank:${row.id}`, kind: "bank_unmatched", title: `${row.date} / ${row.content || "摘要なし"}`, detail: `出金のうち ${money(row.remaining)} が書類と未照合です。書類不足とは限りません。給与・税金など、請求書を伴わない出金もあります。`, links: [{ label: "銀行・書類を確認", href: `/banking/reconcile?company=${company}&transaction=${encodeURIComponent(row.id)}&status=all` }] });
  const mails = data.mailDocuments.filter((row) => !row.deletedAt && companyFromParam(row.company) === company && ["INVOICE", "RECEIPT"].includes(row.category));
  const mailLink = (row: typeof mails[number]) => invoices.get(`received:${row.relatedReceivedInvoiceId}`)?.href || `/documents?company=${company}&document=${encodeURIComponent(`mail:${row.id}`)}`;
  for (const mail of mails) if (!invoices.has(`received:${mail.relatedReceivedInvoiceId}`)) issues.push({ id: `mail:${mail.id}`, kind: "unlinked_mail", title: mail.title || mail.originalFileName, detail: "郵便物が有効な受領請求書と連携していません。分類・金額・連携先を確認してください。", links: [{ label: "書類", href: mailLink(mail) }, { label: "郵便物", href: `/mail-sorter?company=${company}` }] });
  const groups = new Map<string, Array<{ key: string; title: string; href: string }>>();
  const add = (key: string, row: { key: string; title: string; href: string }) => { const rows = groups.get(key) || []; rows.push(row); groups.set(key, rows); };
  for (const row of overview.invoices) {
    if (!row.eligible || !isBankDate(row.date) || row.party === "取引先未設定") continue;
    add(`invoice:${row.kind}:${row.party.normalize("NFKC")}:${row.date}:${row.total}`, { key: row.key, title: `${row.title} / ${row.party}`, href: row.href });
  }
  for (const row of mails) if (row.fileHash) add(`mail:${row.fileHash}`, { key: row.relatedReceivedInvoiceId && invoices.has(`received:${row.relatedReceivedInvoiceId}`) ? `received:${row.relatedReceivedInvoiceId}` : `mail:${row.id}`, title: row.title || row.originalFileName, href: mailLink(row) });
  for (const [key, rows] of groups) {
    const distinct = [...new Map(rows.map((row) => [row.key, row])).values()];
    if (distinct.length < 2) continue;
    issues.push({ id: `duplicate:${distinct[0].key}:${key.startsWith("mail:") ? "hash" : "fields"}`, kind: "duplicate", title: `${distinct[0].title} ほか${distinct.length - 1}件`, detail: key.startsWith("mail:") ? "同一ファイルの郵便物が別の書類として登録されています。自動削除はしません。" : "同じ取引先・発行日・金額の請求書があります。別件の可能性もあるため原本で確認してください。", links: distinct.slice(0, 5).map((row) => ({ label: row.title, href: row.href })) });
  }
  const order = Object.keys(reviewKinds), counts = Object.fromEntries(order.map((kind) => [kind, 0])) as Record<BankReviewKind, number>;
  for (const row of issues) counts[row.kind]++;
  issues.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.id.localeCompare(b.id));
  const kind = Object.hasOwn(reviewKinds, filter) ? filter : "all", filtered = issues.filter((row) => kind === "all" || row.kind === kind);
  const page = Math.min(Math.max(1, Number.isFinite(pageNumber) ? Math.floor(pageNumber) : 1), Math.max(1, Math.ceil(filtered.length / 30)));
  return { items: filtered.slice((page - 1) * 30, page * 30), total: issues.length, filteredTotal: filtered.length, counts, kind, page, categories: order.map((value) => ({ value, label: reviewKinds[value as BankReviewKind], count: counts[value as BankReviewKind] })) };
}
export type BankDocumentReview = ReturnType<typeof bankDocumentReview>;
