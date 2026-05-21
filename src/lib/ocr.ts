import "server-only";

import { companyFromParam, matchesCompany, type CompanyScope } from "@/lib/company";
import type { AppData } from "@/lib/types";

export type ExtractedText = {
  confidence?: number;
  engine: string;
  text: string;
  warnings: string[];
};

type InferredInvoice = {
  confidence: number;
  dueDate: string;
  issueDate: string;
  memo: string;
  projectId: string;
  projectName: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  vendorId: string;
  vendorName: string;
  warnings: string[];
};

export type InferredContractBilling = {
  billingCount: number;
  confidence: number;
  memo: string;
  total: number;
  warnings: string[];
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s　株式会社有限会社.,・_\-()（）]/g, "");
}

function parseAmount(value: string) {
  const amount = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function parseJapaneseNumber(value: string) {
  const numeric = Number(value.replace(/[^\d]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === "十") return 10;
  const tenMatch = value.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (tenMatch) return (digits[tenMatch[1]] || 1) * 10 + (digits[tenMatch[2]] || 0);
  return digits[value] || 0;
}

function toIsoDate(year: string, month: string, day: string) {
  return `${year.padStart(4, "20")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function extractDates(text: string) {
  const dates = Array.from(
    text.matchAll(/(20\d{2})[./\-年]\s*(\d{1,2})[./\-月]\s*(\d{1,2})日?/g),
    (match) => toIsoDate(match[1], match[2], match[3]),
  );
  return Array.from(new Set(dates)).sort();
}

function amountNear(text: string, labels: string[]) {
  const normalizedText = text.replace(/\s+/g, " ");
  for (const label of labels) {
    const pattern = new RegExp(`${label}[^0-9]{0,16}([0-9][0-9,]{2,})`, "i");
    const match = normalizedText.match(pattern);
    if (match) return parseAmount(match[1]);
  }
  return 0;
}

function extractAmounts(text: string) {
  const total =
    amountNear(text, ["税込合計", "請求金額", "ご請求額", "合計金額", "お支払金額", "合計"]) ||
    Math.max(0, ...Array.from(text.matchAll(/[¥￥]?\s*([0-9][0-9,]{3,})/g), (match) => parseAmount(match[1])));
  const taxTotal = amountNear(text, ["消費税額", "消費税", "税額"]);
  const subtotal = amountNear(text, ["税抜合計", "小計", "税抜"]);

  if (subtotal && taxTotal) return { subtotal, taxTotal, total: total || subtotal + taxTotal };
  if (total && taxTotal) return { subtotal: Math.max(total - taxTotal, 0), taxTotal, total };
  if (total) {
    const inferredTax = Math.round(total / 11);
    return { subtotal: total - inferredTax, taxTotal: inferredTax, total };
  }
  return { subtotal: 0, taxTotal: 0, total: 0 };
}

function extractContractAmount(text: string) {
  return (
    amountNear(text, [
      "契約金額",
      "契約総額",
      "業務委託料",
      "委託料",
      "請負金額",
      "報酬額",
      "報酬",
      "制作費",
      "総額",
      "税込合計",
      "合計金額",
      "合計",
    ]) || extractAmounts(text).total
  );
}

function extractBillingCount(text: string) {
  const normalizedText = text.replace(/\s+/g, " ");
  const explicit = normalizedText.match(
    /(?:請求回数|支払回数|支払い回数|分割回数|分割|全)[^0-9一二三四五六七八九十]{0,12}([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*回/,
  );
  if (explicit) return parseJapaneseNumber(explicit[1]);

  const rounds = Array.from(
    normalizedText.matchAll(/第\s*([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*回/g),
    (match) => parseJapaneseNumber(match[1]),
  ).filter((round) => round > 0);
  if (rounds.length) return Math.max(...rounds);

  const milestoneCount = ["着手金", "中間金", "完了金", "最終金", "納品時", "検収後"].filter((label) =>
    normalizedText.includes(label),
  ).length;
  if (milestoneCount >= 2) return milestoneCount;

  return 1;
}

function bestMatch<T extends { id: string }>(
  text: string,
  items: T[],
  names: (item: T) => Array<string | undefined>,
) {
  const haystack = normalize(text);
  let best: { item: T; score: number } | null = null;

  for (const item of items) {
    const score = names(item).reduce((sum, name) => {
      if (!name) return sum;
      const normalizedName = normalize(name);
      if (!normalizedName) return sum;
      if (haystack.includes(normalizedName)) return sum + 8;
      const parts = normalizedName.match(/[a-z0-9]{3,}|[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}]{2,}/gu) ?? [];
      return sum + parts.filter((part) => haystack.includes(part)).length;
    }, 0);
    if (!best || score > best.score) best = { item, score };
  }

  return best && best.score > 0 ? best : null;
}

export async function extractDocumentText(fileName: string, mimeType: string, buffer: Buffer): Promise<ExtractedText> {
  const warnings: string[] = [];
  const parts = [fileName];
  let engine = "filename";
  let confidence: number | undefined;

  if (mimeType === "application/pdf") {
    try {
      const pdfModule = (await import("pdf-parse")) as unknown as {
        default?: (input: Buffer) => Promise<{ text?: string }>;
      } & ((input: Buffer) => Promise<{ text?: string }>);
      const parsePdf = pdfModule.default ?? pdfModule;
      const parsed = await parsePdf(buffer);
      if (parsed.text) {
        parts.push(parsed.text);
        engine = "pdf-text";
      } else {
        warnings.push("PDF内のテキストを抽出できませんでした。スキャンPDFは画像として再アップロードするとOCRできます。");
      }
    } catch {
      warnings.push("PDFテキスト抽出に失敗しました。ファイル名から推定します。");
    }
  }

  if (mimeType.startsWith("image/")) {
    try {
      const { recognize } = await import("tesseract.js");
      const result = await recognize(buffer, "jpn+eng");
      parts.push(result.data.text);
      confidence = result.data.confidence;
      engine = "tesseract-jpn-eng";
    } catch {
      warnings.push("画像OCRに失敗しました。ファイル名から推定します。");
    }
  }

  return { confidence, engine, text: parts.join("\n").slice(0, 12000), warnings };
}

export function inferReceivedInvoice(data: AppData, extracted: ExtractedText, company?: CompanyScope): InferredInvoice {
  const scope = companyFromParam(company);
  const activeVendors = data.vendors.filter((vendor) => !vendor.deletedAt && companyFromParam(vendor.company) === scope);
  const activeProjects = data.projects.filter((project) => !project.deletedAt && matchesCompany(project, scope));
  const activeClients = data.clients.filter((client) => !client.deletedAt);

  const vendorMatch = bestMatch(extracted.text, activeVendors, (vendor) => [
    vendor.companyName,
    vendor.contactName,
    vendor.invoiceRegistrationNumber,
  ]);
  const projectMatch = bestMatch(extracted.text, activeProjects, (project) => {
    const client = activeClients.find((item) => item.id === project.clientId);
    return [project.name, client?.companyName];
  });

  const dates = extractDates(extracted.text);
  const amounts = extractAmounts(extracted.text);
  const issueDate = dates[0] ?? new Date().toISOString().slice(0, 10);
  const dueDate = dates.find((date) => date > issueDate) ?? addDays(issueDate, 30);
  const vendor = vendorMatch?.item ?? activeVendors[0];
  const project = projectMatch?.item ?? activeProjects[0];
  const warnings = [...extracted.warnings];

  if (!vendorMatch) warnings.push("支払先を自動特定できなかったため、候補の先頭を仮設定しました。");
  if (!projectMatch) warnings.push("案件を自動特定できなかったため、候補の先頭を仮設定しました。");
  if (!amounts.total) warnings.push("金額を読み取れませんでした。確認画面で修正してください。");
  if (!dates.length) warnings.push("請求日を読み取れませんでした。今日の日付を仮設定しました。");

  const confidence = Math.min(
    100,
    Math.round((vendorMatch?.score ?? 0) * 8 + (projectMatch?.score ?? 0) * 8 + (amounts.total ? 20 : 0) + (dates.length ? 15 : 0)),
  );

  return {
    confidence,
    dueDate,
    issueDate,
    memo: `OCR仕分け: ${extracted.engine}${extracted.confidence ? ` / OCR信頼度 ${Math.round(extracted.confidence)}%` : ""}`,
    projectId: project?.id ?? "",
    projectName: project?.name ?? "未設定",
    subtotal: amounts.subtotal,
    taxTotal: amounts.taxTotal,
    total: amounts.total,
    vendorId: vendor?.id ?? "",
    vendorName: vendor?.companyName ?? "未設定",
    warnings,
  };
}

export function inferContractBilling(extracted: ExtractedText): InferredContractBilling {
  const total = extractContractAmount(extracted.text);
  const billingCount = Math.max(1, Math.min(12, extractBillingCount(extracted.text) || 1));
  const warnings = [...extracted.warnings];

  if (!total) warnings.push("契約金額を読み取れませんでした。案件一覧で確認してください。");
  if (billingCount === 1) warnings.push("請求回数を明確に読み取れなかったため、1回請求として仮設定しました。");

  const confidence = Math.min(100, Math.round((total ? 50 : 0) + (billingCount > 1 ? 30 : 10) + (extracted.confidence ? 10 : 0)));

  return {
    billingCount,
    confidence,
    memo: `契約書読取: ${extracted.engine}${extracted.confidence ? ` / OCR信頼度 ${Math.round(extracted.confidence)}%` : ""}`,
    total,
    warnings,
  };
}
