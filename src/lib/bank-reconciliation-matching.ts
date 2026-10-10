import type { ReconciliationBank, ReconciliationInvoice } from "@/lib/bank-reconciliation";

const cents = (value: number) => Math.round(value * 100);
const dayDistance = (a: string, b: string) => {
  const value = Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
  return Number.isFinite(value) ? value : undefined;
};

export function normalizeReconciliationName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja")
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .replace(/株式会社|有限会社|合同会社|(?:^|[\s（(])(?:カ|ユ|ド)[）)]|[（(](?:カ|ユ|ド)(?=$|\s)/g, "")
    .replace(/[\s()（）・.,，．\-]/g, "");
}

export function reconciliationPaymentOptions(bank: ReconciliationBank, invoice: ReconciliationInvoice) {
  return invoice.payments.filter((row) => row.available > 0).toSorted((a, b) =>
    Number(cents(b.available) === cents(bank.remaining)) - Number(cents(a.available) === cents(bank.remaining)) ||
    (dayDistance(a.date, bank.date) ?? Infinity) - (dayDistance(b.date, bank.date) ?? Infinity) || a.id.localeCompare(b.id));
}

export function reconciliationCandidates(bank: ReconciliationBank, invoices: ReconciliationInvoice[], limit = 8) {
  const description = normalizeReconciliationName(bank.content);
  if (bank.issue || bank.conflict || bank.remaining <= 0) return [];
  const candidates = invoices.filter((row) => row.eligible && !row.conflict && (row.outstanding > 0 || row.payments.some((payment) => payment.available > 0)) && (bank.side === "INCOME" ? row.kind === "issued" : row.kind === "received")).map((row) => {
    const reasons: string[] = [], warnings: string[] = [];
    const available = reconciliationPaymentOptions(bank, row);
    const amounts = [row.outstanding, ...available.map((payment) => payment.available)].filter((amount) => amount > 0);
    const target = amounts.toSorted((a, b) => Math.abs(cents(a) - cents(bank.remaining)) - Math.abs(cents(b) - cents(bank.remaining)))[0];
    const exact = cents(target) === cents(bank.remaining);
    const party = normalizeReconciliationName(row.party), holder = normalizeReconciliationName(row.accountHolder);
    const nameMatch = row.party !== "取引先未設定" && party.length >= 3 && description.includes(party);
    const holderMatch = holder.length >= 3 && description.includes(holder);
    const historyMatch = row.confirmedNames.some((name) => name.accountId === bank.accountId && name.content === description);
    const number = row.title.normalize("NFKC").toLocaleLowerCase("ja").trim();
    const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const numberMatch = row.kind === "issued" && number.length >= 4 && new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(bank.content.normalize("NFKC").toLocaleLowerCase("ja"));
    const identity = nameMatch || holderMatch || historyMatch || numberMatch;
    const matchingPayments = available.filter((payment) => cents(payment.available) === cents(bank.remaining));
    const dates = [...matchingPayments.map((payment) => payment.date), row.dueDate || row.date];
    const distances = dates.map((date) => dayDistance(date, bank.date)).filter((value): value is number => value !== undefined);
    const distance = distances.length ? Math.min(...distances) : undefined;
    let score = exact ? 40 : 0;
    if (exact) reasons.push(matchingPayments.length ? "登録済みの支払い額と一致" : "未入金・未払い額と一致");
    if (numberMatch) { reasons.push("請求書番号が摘要に一致"); score += 65; }
    // Alternative evidence of the same counterparty is counted once, not three times.
    if (nameMatch || holderMatch || historyMatch) score += 40;
    if (nameMatch) reasons.push("取引先名が摘要に一致");
    if (holderMatch) reasons.push("振込口座名義が摘要に一致");
    if (historyMatch) reasons.push("同じ口座・摘要の確定済み照合と一致");
    if (distance !== undefined && distance <= 14) { reasons.push("期日・記録日と14日以内"); score += 15; }
    else if (distance !== undefined && distance <= 45) score += 5;
    else if (distance !== undefined && distance > 90) { warnings.push("期日・記録日から90日超"); score -= 25; }
    if (distance === undefined) warnings.push("日付の根拠なし");
    if (!identity) warnings.push("金額のみ一致・名義を確認");
    if (!exact) warnings.push("差額あり・一部入金や合算を確認");
    const difference = (cents(bank.remaining) - cents(target)) / 100;
    return { key: row.key, score, reasons, warnings, difference, distance, numberMatch,
      confidence: identity && exact && distance !== undefined && distance <= 45 ? "strong" as const : "review" as const,
      relevant: identity || (exact && (distance === undefined || distance <= 90)) };
  }).filter((row) => row.relevant);
  const numbered = candidates.some((row) => row.numberMatch);
  const strongScores = new Map<number, number>();
  for (const row of candidates) if (row.confidence === "strong") strongScores.set(row.score, (strongScores.get(row.score) || 0) + 1);
  for (const row of candidates) {
    if (numbered && !row.numberMatch) { row.confidence = "review"; row.score -= 30; row.warnings.push("別の請求書番号が摘要に一致"); }
    else if (row.confidence === "strong" && (strongScores.get(row.score) || 0) > 1) { row.confidence = "review"; row.warnings.push("同条件の請求書が複数"); }
  }
  return candidates.sort((a, b) => b.score - a.score || (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.key.localeCompare(b.key)).slice(0, limit);
}

export type ReconciliationCandidate = ReturnType<typeof reconciliationCandidates>[number];
