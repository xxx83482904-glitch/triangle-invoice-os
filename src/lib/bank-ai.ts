import "server-only";
import { createHash } from "node:crypto";
import { bankAiOutputSchema, bankAiScopeSchema, type BankAiPayload, type BankAiPreview, type BankAiResult, type BankAiScope } from "@/lib/bank-ai-types";
import { bankReconciliationOverview, reconciliationCandidates, type ReconciliationOverview } from "@/lib/bank-reconciliation";
import { assertBankAccess, bankToday } from "@/lib/banking";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";

export function authorizeBankAi(data: AppData, userId: string, company: CompanyScope) {
  const actor = data.users.find((row) => row.id === userId && isActiveUser(row));
  if (!actor) throw new Error("利用者の権限が変わっています");
  assertBankAccess(actor, company);
  return actor;
}

export function maskBankAiText(text: string, limit = 160) {
  return text.normalize("NFKC")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "[URL]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL]")
    .replace(/(?:sk-|mf_api_|bearer\s+)[\w-]+/gi, "[SECRET]")
    .replace(/[A-Z]{2}\d{2}[A-Z0-9 ]{10,32}/g, "[ACCOUNT]")
    .replace(/(?:\d[ -]?){7,}/g, "[NUMBER]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}
function excerpt(text?: string) {
  return maskBankAiText((text || "").split(/\r?\n/).filter((line) => /請求|領収|合計|金額|件名|御中|支払|振込|発行|invoice|total|payment|receipt/i.test(line)).slice(0, 6).join(" / "), 500);
}
const cents = (value: number) => Math.round(value * 100);
const bankHref = (company: CompanyScope, id: string) => `/banking/reconcile?company=${company}&transaction=${encodeURIComponent(id)}&status=all`;

export function prepareBankAi(data: AppData, company: CompanyScope, rawScope: BankAiScope, today = bankToday(), suppliedOverview?: ReconciliationOverview) {
  const scope = bankAiScopeSchema.parse(rawScope), overview = suppliedOverview || bankReconciliationOverview(data, company, today);
  if (scope.mode === "month" && scope.month > today.slice(0, 7)) throw new Error("未来の月は確認できません");
  const allBanks = overview.banks.filter((row) => row.state === "unmatched" && !row.issue && !row.conflict && row.remaining > 0 && (scope.mode === "transaction" ? row.id === scope.transactionId : row.date.startsWith(scope.month))).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const banks = allBanks.slice(0, 20), directions = new Set(banks.map((row) => row.side));
  const ranks = new Map<string, number>();
  for (const bank of banks) for (const candidate of reconciliationCandidates(bank, overview.invoices)) ranks.set(candidate.key, Math.max(ranks.get(candidate.key) || 0, candidate.score));
  const allInvoices = overview.invoices.filter((row) => row.eligible && !row.conflict && !row.overpaid && row.unmatched > 0 && directions.has(row.kind === "issued" ? "INCOME" : "EXPENSE"));
  const anchor = banks[0]?.date || today;
  const distance = (date: string) => Number.isFinite(Date.parse(date)) ? Math.abs(Date.parse(date) - Date.parse(anchor)) : Infinity;
  const invoices = allInvoices.sort((a, b) => (ranks.get(b.key) || 0) - (ranks.get(a.key) || 0) || distance(a.dueDate || a.date) - distance(b.dueDate || b.date) || a.key.localeCompare(b.key)).slice(0, 40);
  const invoiceRefs = new Map(invoices.map((row, i) => [row.key, `I${i + 1}`]));
  const projects = new Map(data.projects.map((row) => [row.id, row]));
  const receivedById = new Map(data.receivedInvoices.map((row) => [row.id, row]));
  const scopedReceived = new Map(overview.invoices.filter((row) => row.kind === "received").map((row) => [row.id, row]));
  const allMails = directions.has("EXPENSE") ? data.mailDocuments.filter((row) => {
    if (row.deletedAt || companyFromParam(row.company) !== company || !["INVOICE", "RECEIPT"].includes(row.category)) return false;
    const linked = row.relatedReceivedInvoiceId && receivedById.get(row.relatedReceivedInvoiceId);
    const project = linked && projects.get(linked.projectId);
    return !project || companyFromParam(project.company) === company;
  }) : [];
  const mailRank = (row: AppData["mailDocuments"][number]) => (invoiceRefs.has(`received:${row.relatedReceivedInvoiceId}`) ? 100 : 0) + ((row.folderMonth || row.createdAt.slice(0, 7)) === anchor.slice(0, 7) ? 30 : 0) + (!row.relatedReceivedInvoiceId ? 10 : 0);
  const mails = [...allMails].sort((a, b) => mailRank(b) - mailRank(a) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, 30);
  const issuedById = new Map(data.issuedInvoices.map((row) => [row.id, row]));
  const payload: BankAiPayload = {
    company,
    banks: banks.map((row, i) => ({ ref: `B${i + 1}`, side: row.side, date: row.date, content: maskBankAiText(row.content, 240), amount: row.amount, remaining: row.remaining })),
    invoices: invoices.map((row, i) => ({ ref: `I${i + 1}`, kind: row.kind, title: maskBankAiText(row.title), party: maskBankAiText(row.party), project: maskBankAiText(row.project), date: row.date, dueDate: row.dueDate, total: row.total, paid: row.paid, unmatched: row.unmatched, needsReview: row.needsReview, stateMismatch: row.stateMismatch, excerpt: excerpt((row.kind === "issued" ? issuedById.get(row.id) : receivedById.get(row.id))?.ocrText) })),
    mails: mails.map((row, i) => ({ ref: `M${i + 1}`, title: maskBankAiText(row.title), sender: maskBankAiText(row.senderName || ""), category: row.category, month: row.folderMonth || row.createdAt.slice(0, 7), processed: Boolean(row.mailProcessed), linked: Boolean(row.relatedReceivedInvoiceId && scopedReceived.has(row.relatedReceivedInvoiceId)), invoiceRef: invoiceRefs.get(`received:${row.relatedReceivedInvoiceId}`) || null, excerpt: excerpt(row.ocrText) })),
  };
  const totals = { banks: allBanks.length, invoices: allInvoices.length, mails: allMails.length };
  const revision = createHash("sha256").update(JSON.stringify({ scope, payload, totals, banks: banks.map((row) => [row.id, row.updatedAt]), invoices: invoices.map((row) => [row.key, row.updatedAt, row.payments]), mails: mails.map((row) => [row.id, row.updatedAt, row.relatedReceivedInvoiceId]) })).digest("hex");
  const preview: BankAiPreview = { scope, revision, payload, totals };
  const mailHrefs = mails.map((row) => scopedReceived.get(row.relatedReceivedInvoiceId || "")?.href || `/documents?company=${company}&document=${encodeURIComponent(`mail:${row.id}`)}`);
  return { preview, banks, invoices, mails, mailHrefs };
}
export type PreparedBankAi = ReturnType<typeof prepareBankAi>;

export function validateBankAiResult(prepared: PreparedBankAi, raw: unknown, model: string): BankAiResult {
  const output = bankAiOutputSchema.parse(raw), { payload } = prepared.preview;
  const sources = new Map([...payload.banks, ...payload.invoices, ...payload.mails].map((row) => [row.ref, Object.entries(row).filter(([key, value]) => !["ref", "invoiceRef"].includes(key) && (typeof value === "string" || typeof value === "number")).map(([, value]) => value).join(" ")]));
  const seen = new Set<string>();
  const suggestions = output.suggestions.map((group) => {
    const bankIndex = payload.banks.findIndex((row) => row.ref === group.bankRef), bank = prepared.banks[bankIndex];
    const invoiceIndexes = group.invoiceRefs.map((ref) => payload.invoices.findIndex((row) => row.ref === ref));
    const mailIndexes = group.mailRefs.map((ref) => payload.mails.findIndex((row) => row.ref === ref));
    const refs = [group.bankRef, ...group.invoiceRefs, ...group.mailRefs], signature = [...refs].sort().join(":");
    if (!bank || !group.invoiceRefs.length && !group.mailRefs.length || invoiceIndexes.includes(-1) || mailIndexes.includes(-1) || new Set(refs).size !== refs.length || seen.has(signature)) throw new Error("AIの参照先を検証できませんでした");
    seen.add(signature);
    const invoices = invoiceIndexes.map((index) => prepared.invoices[index]), mails = mailIndexes.map((index) => prepared.mails[index]);
    if (invoices.some((row) => (row.kind === "issued" ? "INCOME" : "EXPENSE") !== bank.side) || mails.length && bank.side !== "EXPENSE") throw new Error("AIの入出金方向を検証できませんでした");
    // Every suggested document must have a verbatim excerpt from this request, not an invented citation.
    if (refs.some((ref) => !group.evidence.some((row) => row.ref === ref)) || group.evidence.some((row) => !refs.includes(row.ref) || !sources.get(row.ref)?.includes(row.quote) || row.quote.includes("[NUMBER]") || row.quote.includes("[SECRET]"))) throw new Error("AIの根拠を検証できませんでした");
    const invoiceAmount = invoices.length ? invoices.reduce((sum, row) => sum + cents(row.unmatched), 0) / 100 : null;
    const difference = invoiceAmount === null ? null : (cents(bank.remaining) - cents(invoiceAmount)) / 100;
    const cautions = ["AIの推測です。原本・通貨・支払名義を確認してから照合してください。"];
    if (difference) cautions.push("差額があります。振込手数料・分割払いなどの理由は未確定です。");
    if (invoices.some((row) => row.needsReview || row.stateMismatch)) cautions.push("OCRまたは支払い状態に確認事項があります。");
    if (mailIndexes.some((index) => !payload.mails[index].linked)) cautions.push("受領請求書に未連携の郵便物です。金額と連携先を確認してください。");
    if (mails.some((row) => row.relatedReceivedInvoiceId && !invoices.some((invoice) => invoice.key === `received:${row.relatedReceivedInvoiceId}`))) cautions.push("郵便物の既存連携先が提案の請求書と一致していません。現在の連携を優先して確認してください。");
    return {
      bank: { id: bank.id, title: bank.content, date: bank.date, remaining: bank.remaining, href: bankHref(payload.company, bank.id) },
      invoices: invoices.map((row) => ({ key: row.key, title: `${row.title} / ${row.party}`, href: row.href, unmatched: row.unmatched })),
      mails: mails.map((row, i) => ({ id: row.id, title: row.title || row.originalFileName, linked: payload.mails[mailIndexes[i]].linked, href: prepared.mailHrefs[mailIndexes[i]] })),
      explanation: group.explanation, evidence: group.evidence.map((row) => ({ label: row.ref, quote: row.quote })), invoiceAmount, difference, cautions,
    };
  });
  return { revision: prepared.preview.revision, model, generatedAt: new Date().toISOString(), suggestions };
}

export function reserveBankAiUsage(data: AppData, company: CompanyScope, now = new Date()) {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now), usage = data.bankAiUsage?.[company];
  const count = usage?.day === day ? usage.count : 0;
  if (count >= 50) throw new Error("本日のAI実行上限（会社ごとに50回）に達しました");
  if (usage && now.getTime() - Date.parse(usage.lastRequestedAt) < 15000) throw new Error("AIの連続実行を防ぐため、15秒ほど待ってください");
  data.bankAiUsage ||= {};
  data.bankAiUsage[company] = { day, count: count + 1, lastRequestedAt: now.toISOString() };
  return count + 1;
}
