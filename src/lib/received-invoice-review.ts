// Optional fields keep legacy invoices readable without rewriting stored records.
export type ReceivedInvoiceAmounts = {
  subtotal: number;
  taxTotal: number;
  total: number;
  grossAmount?: number;
  withholdingAmount?: number;
};

const issuerLabel = /(?:請求元|発行者|発行元|販売者|事業者名|issuer|seller|供应商|销售方)\s*[:：]?\s*/i;
const bankLabel = /銀行|信用金庫|信用組合|开户行|銀行口座|口座|振込先|振込銀行|bank|account|remittance/i;
const issueLabel = /請求日|発行日|請求書発行日|invoice date|issue date|开票日期|发票日期/i;
const dueLabel = /支払(?:い)?期限|支払期日|振込期限|振込期日|入金期限|お支払日|due date|payment due/i;
const netLabel = /差引(?:支払|請求)?(?:額|金額)|振込(?:額|金額)|net payable|amount due/i;
const amountLabels = {
  subtotal: /税抜(?:合計)?|小計|報酬額|subtotal/i,
  taxTotal: /消費税(?:額)?|consumption tax/i,
  grossAmount: /税込(?:合計|金額)?|総額|grand total|gross(?: total)?/i,
  withholdingAmount: /源泉(?:徴収)?(?:所得)?税(?:額)?|withholding(?: tax)?/i,
  total: /差引(?:支払|請求)?(?:額|金額)|振込(?:額|金額)|お支払(?:い)?金額|ご請求金額|請求金額|net payable|amount due/i,
};

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function receivedInvoiceEvidence(text: string) {
  const lines = text.normalize("NFKC").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const snippets: Partial<Record<"issuer" | "bank" | "issueDate" | "dueDate" | keyof ReceivedInvoiceAmounts, string>> = {};
  const date = (label: RegExp, key: "issueDate" | "dueDate") => {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(label);
      if (!match) continue;
      const tail = lines[i].slice(match.index! + match[0].length);
      // Never let one field borrow the date belonging to the next label.
      const source = tail.trim() ? tail : lines[i + 1] ?? "";
      const dateSource = source.split(new RegExp(`${issueLabel.source}|${dueLabel.source}`, "i"))[0];
      const found = dateSource.match(/(20\d{2})[年./-]\s*(\d{1,2})[月./-]\s*(\d{1,2})日?/);
      if (!found) continue;
      const value = `${found[1]}-${found[2].padStart(2, "0")}-${found[3].padStart(2, "0")}`;
      if (!validDate(value)) continue;
      snippets[key] = `${lines[i]}${tail.trim() ? "" : ` ${source}`}`;
      return value;
    }
    return "";
  };
  const issueDate = date(issueLabel, "issueDate"), dueDate = date(dueLabel, "dueDate");
  const issuerLine = lines.find((line) => issuerLabel.test(line));
  const issuer = issuerLine?.replace(/^.*?(?:請求元|発行者|発行元|販売者|事業者名|issuer|seller|供应商|销售方)\s*[:：]?\s*/i, "").trim() || "";
  if (issuerLine) snippets.issuer = issuerLine;
  const bankLines = lines.filter((line) => bankLabel.test(line) && !issuerLabel.test(line));
  if (bankLines.length) snippets.bank = bankLines.join(" / ");
  const amounts: Partial<ReceivedInvoiceAmounts> = {};
  for (const [key, label] of Object.entries(amountLabels) as Array<[keyof ReceivedInvoiceAmounts, RegExp]>) {
    const indexes = lines.map((_, index) => index);
    if (key === "total") indexes.sort((a, b) => Number(netLabel.test(lines[b])) - Number(netLabel.test(lines[a])));
    for (const i of indexes) {
      const match = lines[i].match(label);
      if (!match) continue;
      const tail = lines[i].slice(match.index! + match[0].length);
      const source = tail.trim() ? tail : lines[i + 1] ?? "";
      // Skip rates in parentheses, but do not cross another field label.
      const cleaned = source.replace(/\([^)]*%[^)]*\)/g, "");
      const found = cleaned.match(/^\s*[:：]?\s*[¥￥]?\s*[-△▲]?\s*(\d[\d,]*)(?![\d,.%])/);
      if (!found) continue;
      const amount = Number(found[1].replaceAll(",", ""));
      if (!Number.isSafeInteger(amount)) continue;
      amounts[key] = amount;
      snippets[key] = `${lines[i]}${tail.trim() ? "" : ` ${source}`}`;
      break;
    }
  }
  return { issuer, issueDate, dueDate, amounts, snippets,
    issuerText: lines.filter((line) => !bankLabel.test(line) && !/御中|様\s*$|bill to|customer|宛先|請求先/i.test(line)).join("\n") };
}

export function receivedInvoiceWarnings(row: ReceivedInvoiceAmounts & { vendorName: string; issueDate: string; dueDate: string; ocrText?: string }) {
  const evidence = receivedInvoiceEvidence(row.ocrText ?? "");
  const warnings: string[] = [];
  if (bankLabel.test(row.vendorName) && evidence.issuer !== row.vendorName) warnings.push("請求元が振込先銀行の可能性があります。原本の発行者を確認してください。");
  if (evidence.issuer && !row.vendorName.normalize("NFKC").includes(evidence.issuer)) warnings.push(`原本の請求元候補「${evidence.issuer}」と登録先が異なります。`);
  if (evidence.issueDate && evidence.issueDate !== row.issueDate) warnings.push(`原本の請求日 ${evidence.issueDate} と登録日が異なります。`);
  if (evidence.dueDate && evidence.dueDate !== row.dueDate) warnings.push(`原本の支払期限 ${evidence.dueDate} と登録日が異なります。`);
  if (!row.issueDate) warnings.push("請求日が未確認です。");
  if (!row.dueDate) warnings.push("支払期限が未確認です。");
  if (row.issueDate && row.dueDate && row.dueDate < row.issueDate) warnings.push("支払期限が請求日より前です。");
  if (row.issueDate && row.issueDate === row.dueDate) warnings.push("請求日と支払期限が同日です。日付の取り違えがないか確認してください。");
  const gross = row.grossAmount ?? row.subtotal + row.taxTotal;
  if (gross - (row.withholdingAmount ?? 0) !== row.total) warnings.push("税込総額 − 源泉徴収税額 と差引支払額が一致しません。");
  if ((evidence.amounts.withholdingAmount ?? 0) > 0 && row.withholdingAmount === undefined) warnings.push("原本に源泉徴収税額があります。内訳が未確認です。");
  return warnings;
}

export function validateReceivedAmounts(amounts: ReceivedInvoiceAmounts) {
  for (const value of [amounts.subtotal, amounts.taxTotal, amounts.total, amounts.grossAmount, amounts.withholdingAmount]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error("金額は0以上の整数で入力してください。");
  }
  const gross = amounts.grossAmount ?? amounts.subtotal + amounts.taxTotal;
  if (amounts.withholdingAmount !== undefined || amounts.grossAmount !== undefined) {
    if (gross !== amounts.subtotal + amounts.taxTotal) throw new Error("税込総額は税抜額と消費税額の合計にしてください。");
    if (gross - (amounts.withholdingAmount ?? 0) !== amounts.total) throw new Error("差引支払額は税込総額から源泉徴収税額を引いた金額にしてください。");
  }
  return amounts;
}

export function receivedAmountsFromForm(form: FormData, previous?: ReceivedInvoiceAmounts) {
  const number = (key: keyof ReceivedInvoiceAmounts, fallback = 0) => {
    if (!form.has(key)) return fallback;
    const value = String(form.get(key) ?? "").trim().replaceAll(",", "");
    return value ? Number(value) : NaN;
  };
  const optionalNumber = (key: "grossAmount" | "withholdingAmount") => {
    const value = String(form.get(key) ?? "").trim().replaceAll(",", "");
    return value ? Number(value) : previous?.[key];
  };
  const amounts: ReceivedInvoiceAmounts = {
    subtotal: number("subtotal", previous?.subtotal), taxTotal: number("taxTotal", previous?.taxTotal), total: number("total", previous?.total),
    ...(optionalNumber("grossAmount") !== undefined ? { grossAmount: optionalNumber("grossAmount") } : {}),
    ...(optionalNumber("withholdingAmount") !== undefined ? { withholdingAmount: optionalNumber("withholdingAmount") } : {}),
  };
  // A memo-only edit must not turn legacy, unknown tax breakdowns into asserted amounts.
  if (previous && previous.grossAmount === undefined && previous.withholdingAmount === undefined &&
    amounts.subtotal === previous.subtotal && amounts.taxTotal === previous.taxTotal && amounts.total === previous.total &&
    (amounts.withholdingAmount ?? 0) === 0 && (amounts.grossAmount ?? amounts.total) === amounts.total) {
    delete amounts.grossAmount;
    delete amounts.withholdingAmount;
  }
  return validateReceivedAmounts(amounts);
}

export function validateReceivedDates(issueDate: string, dueDate: string) {
  if ((issueDate && !validDate(issueDate)) || (dueDate && !validDate(dueDate))) throw new Error("日付を入力する場合は実在する日付にしてください。");
}
