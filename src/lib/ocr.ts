import "server-only";

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { companyFromParam, matchesCompany, type CompanyScope } from "@/lib/company";
import { effectiveOcrConfig } from "@/lib/ocr-settings";
import type { AppData, MailDocumentCategory } from "@/lib/types";

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

export type MailDocumentClassification = {
  category: MailDocumentCategory;
  confidence: number;
  amountSummary?: string;
  contentSummary?: string;
  paymentDestination?: string;
  reason: string;
  senderName?: string;
};

type AiDocumentAnalysis = {
  amountSummary?: string;
  bankAccountHolder?: string;
  bankAccountNumber?: string;
  bankAccountType?: string;
  bankBranch?: string;
  bankName?: string;
  confidence?: number;
  contentSummary?: string;
  documentType?: string;
  dueDate?: string;
  issueDate?: string;
  memo?: string;
  paymentDestination?: string;
  projectHint?: string;
  reason?: string;
  registrationNumber?: string;
  senderName?: string;
  senderOrganization?: string;
  subtotal?: number;
  taxTotal?: number;
  total?: number;
  vendorName?: string;
  warnings?: string[];
};

type VisionAuth = {
  headers: Record<string, string>;
  suffix: string;
};

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

const supportedPdfLikeTypes = new Set(["application/pdf", "image/tiff", "image/gif"]);
const aiCategoryMap: Record<string, MailDocumentCategory> = {
  contract: "CONTRACT",
  delivery_note: "DELIVERY_NOTE",
  estimate: "ESTIMATE",
  invoice: "INVOICE",
  notice: "NOTICE",
  other: "OTHER",
  receipt: "RECEIPT",
};

const JP = {
  bank:
    "\\u9280\\u884c|\\u652f\\u5e97|\\u53e3\\u5ea7|\\u632f\\u8fbc|\\u53d7\\u53d6\\u4eba|\\u53e3\\u5ea7\\u540d\\u7fa9|\\u632f\\u8fbc\\u5148",
  contractAmount:
    "\\u5951\\u7d04\\u91d1\\u984d|\\u696d\\u52d9\\u59d4\\u8a17\\u6599|\\u59d4\\u8a17\\u6599|\\u5831\\u916c|\\u898b\\u7a4d\\u91d1\\u984d|\\u5236\\u4f5c\\u8cbb",
  dueDate:
    "\\u652f\\u6255\\u671f\\u9650|\\u304a\\u652f\\u6255\\u671f\\u9650|\\u632f\\u8fbc\\u671f\\u9650|\\u5165\\u91d1\\u671f\\u9650|due date|payment due",
  excludedNumber:
    "\\u53e3\\u5ea7|\\u9280\\u884c|\\u632f\\u8fbc|\\u652f\\u5e97|\\u90f5\\u4fbf|\\u4f4f\\u6240|\\u96fb\\u8a71|TEL|FAX|Email|No\\.|\\u756a\\u53f7|\\u767b\\u9332\\u756a\\u53f7|invoice\\s*no|registration|tax\\s*id",
  issueDate: "\\u8acb\\u6c42\\u65e5|\\u767a\\u884c\\u65e5|\\u53d6\\u5f15\\u5e74\\u6708\\u65e5|invoice date|issue date",
  subtotal: "\\u7a0e\\u629c|\\u7a0e\\u629c\\u5408\\u8a08|\\u5c0f\\u8a08|subtotal",
  tax: "\\u6d88\\u8cbb\\u7a0e|\\u7a0e\\u984d|\\u6d88\\u8cbb\\u7a0e\\u984d|tax",
  total:
    "\\u7a0e\\u8fbc\\u5408\\u8a08|\\u3054\\u8acb\\u6c42\\u91d1\\u984d|\\u8acb\\u6c42\\u91d1\\u984d|\\u8acb\\u6c42\\u984d|\\u5408\\u8a08\\u91d1\\u984d|\\u5408\\u8a08|\\u7dcf\\u984d|\\u304a\\u652f\\u6255\\u3044\\u91d1\\u984d|amount due|total amount|grand total|total",
};

const CN = {
  bank: "\\u6536\\u6b3e\\u65b9|\\u5f00\\u6237\\u884c|\\u94f6\\u884c\\u8d26\\u53f7|\\u8d26\\u6237|\\u6536\\u6b3e\\u4eba",
  issueDate: "\\u5f00\\u7968\\u65e5\\u671f|\\u53d1\\u7968\\u65e5\\u671f|\\u65e5\\u671f",
  total: "\\u4ef7\\u7a0e\\u5408\\u8ba1|\\u5408\\u8ba1\\u91d1\\u989d|\\u542b\\u7a0e\\u91d1\\u989d|\\u603b\\u91d1\\u989d",
};

const AI_SYSTEM_PROMPT =
  "You classify Japanese and Chinese business documents and extract business fields. Return JSON only. " +
  "documentType must be one of invoice, contract, estimate, delivery_note, receipt, notice, other. " +
  "Required fields: senderName, contentSummary, amountSummary, paymentDestination, confidence, reason, warnings. " +
  "senderName: aggressively find the company or organization that sent, issued, billed, sold, mailed, or requests payment. Never use the recipient, bill-to company, client, delivery destination, project owner, or file name as senderName. " +
  "For Japanese documents prefer labels meaning sender, issuer, biller, seller, payee, transfer destination, receipt issuer. For Chinese documents prefer seller, invoice issuer, payee, account holder, supplier. " +
  "contentSummary: summarize the document in one short Japanese sentence and include item, service, contract, project, or notice topic when visible. " +
  "amountSummary: extract the actual billed, payable, contract, or tax-included amount and tax if visible. " +
  "paymentDestination: strongly search transfer/payment destination: bank name, branch, account type, account number, account holder. If absent, return an empty string. " +
  "For invoices, vendorName should normally be the sender or issuer. Extract issueDate from invoice date or issue date labels. Extract dueDate from payment due or transfer deadline labels. Extract total from amount due, tax-included total, grand total, or Chinese tax-included total labels. " +
  "Never use bank account numbers, phone numbers, postal codes, registration numbers, invoice numbers, project numbers, or delivery numbers as money values. Dates must be YYYY-MM-DD. Money values must be integer JPY or CNY values without commas. Include bankName, bankBranch, bankAccountType, bankAccountNumber, bankAccountHolder when visible.";

let cachedGoogleToken: { accessToken: string; expiresAt: number } | null = null;

function parseAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== "string") return 0;
  const amount = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function optionalNumberFromAi(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string" && value.trim()) return parseAmount(value);
  return undefined;
}

function numberFromAi(value: unknown) {
  return optionalNumberFromAi(value) ?? 0;
}

function textFromAi(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function warningsFromAi(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s.,_\-()[\]{}・･/\\]/g, "")
    .replace(/株式会社|有限会社|合同会社|股份有限公司|有限公司|会社|公司|co\.?ltd\.?|inc\.?|llc/gi, "");
}

function compactInline(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toIsoDate(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${String(y).padStart(4, "20")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function extractDates(text: string) {
  const normalizedText = text.normalize("NFKC");
  const datePattern = /(20\d{2})[./\-\u5e74]\s*(\d{1,2})[./\-\u6708]\s*(\d{1,2})\u65e5?/g;
  const dates = Array.from(normalizedText.matchAll(datePattern), (match) => toIsoDate(match[1], match[2], match[3])).filter(Boolean);
  return Array.from(new Set(dates)).sort();
}

function dateNear(text: string, labels: string[]) {
  const normalizedText = text.replace(/\s+/g, " ").normalize("NFKC");
  for (const label of labels) {
    const pattern = new RegExp(`(?:${label}).{0,56}(20\\d{2})[./\\-\\u5e74]\\s*(\\d{1,2})[./\\-\\u6708]\\s*(\\d{1,2})\\u65e5?`, "i");
    const match = normalizedText.match(pattern);
    if (match) return toIsoDate(match[1], match[2], match[3]);
  }
  return "";
}

function amountNear(text: string, labels: string[]) {
  const normalizedText = text.replace(/\s+/g, " ").normalize("NFKC");
  for (const label of labels) {
    const pattern = new RegExp(`(?:${label})[^0-9]{0,56}(?:JPY|CNY|RMB|¥|￥|円|元)?\\s*([0-9][0-9,]{2,})`, "i");
    const match = normalizedText.match(pattern);
    if (match) return parseAmount(match[1]);
  }
  return 0;
}

function extractAmounts(text: string) {
  const normalizedText = text.normalize("NFKC");
  const excludedLinePattern = new RegExp(`(?:${JP.excludedNumber})`, "i");
  const moneyPattern = /(?:JPY|CNY|RMB|¥|￥|円|元)?\s*([0-9][0-9,]{3,})(?:\s*(?:円|元|税込|税抜))?/gi;
  const candidates = normalizedText
    .split(/\r?\n/)
    .filter((line) => !excludedLinePattern.test(line))
    .flatMap((line) => Array.from(line.matchAll(moneyPattern), (match) => parseAmount(match[1])))
    .filter((amount) => amount > 0 && amount < 100_000_000);
  const total = amountNear(normalizedText, [JP.total, CN.total]) || Math.max(0, ...candidates);
  const taxTotal = amountNear(normalizedText, [JP.tax]);
  const subtotal = amountNear(normalizedText, [JP.subtotal]);

  if (subtotal && taxTotal) return { subtotal, taxTotal, total: total || subtotal + taxTotal };
  if (total && taxTotal) return { subtotal: Math.max(total - taxTotal, 0), taxTotal, total };
  if (total) {
    const inferredTax = Math.round(total / 11);
    return { subtotal: total - inferredTax, taxTotal: inferredTax, total };
  }
  return { subtotal: 0, taxTotal: 0, total: 0 };
}

function parseJapaneseNumber(value: string) {
  const numeric = Number(value.replace(/[^\d]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const digits: Record<string, number> = {
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9,
    "\u5341": 10,
  };
  const tenMatch = value.match(/^([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d])?\u5341([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d])?$/);
  if (tenMatch) return (digits[tenMatch[1]] || 1) * 10 + (digits[tenMatch[2]] || 0);
  return digits[value] || 0;
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function formatAmountSummary(amounts: { subtotal?: number; taxTotal?: number; total?: number }) {
  const parts = [];
  if (amounts.total) parts.push(`合計 ${amounts.total.toLocaleString("ja-JP")}円`);
  if (amounts.subtotal) parts.push(`税抜 ${amounts.subtotal.toLocaleString("ja-JP")}円`);
  if (amounts.taxTotal) parts.push(`消費税 ${amounts.taxTotal.toLocaleString("ja-JP")}円`);
  return parts.join(" / ");
}

function buildAmountSummary(text: string, analysis: AiDocumentAnalysis | null) {
  const aiSummary = formatAmountSummary({
    subtotal: optionalNumberFromAi(analysis?.subtotal),
    taxTotal: optionalNumberFromAi(analysis?.taxTotal),
    total: optionalNumberFromAi(analysis?.total),
  });
  return aiSummary || formatAmountSummary(extractAmounts(text));
}

function buildPaymentDestinationFromAi(analysis: AiDocumentAnalysis | null) {
  const parts = [
    textFromAi(analysis?.paymentDestination),
    textFromAi(analysis?.bankName),
    textFromAi(analysis?.bankBranch),
    textFromAi(analysis?.bankAccountType),
    textFromAi(analysis?.bankAccountNumber),
    textFromAi(analysis?.bankAccountHolder),
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(" / ");
}

function extractPaymentDestination(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => compactInline(line.replace(/\u0000/g, "")))
    .filter(Boolean);
  const labelPattern = new RegExp(`(?:${JP.bank}|${CN.bank}|account|bank|transfer)`, "i");
  const noisePattern = new RegExp(`(?:${JP.excludedNumber}|invoice\\s*no)`, "i");
  const candidates: string[] = [];

  lines.forEach((line, index) => {
    if (!labelPattern.test(line)) return;
    for (const nearby of lines.slice(index, index + 5)) {
      if (noisePattern.test(nearby) && !labelPattern.test(nearby)) continue;
      if (nearby.length < 2 || nearby.length > 120) continue;
      candidates.push(nearby);
    }
  });

  return Array.from(new Set(candidates)).slice(0, 5).join(" / ");
}

function inferContentSummary(text: string, category: MailDocumentCategory) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => compactInline(line.replace(/\u0000/g, "")))
    .filter((line) => line.length >= 4 && line.length <= 100);
  const titlePattern = /\u8acb\u6c42\u66f8|\u898b\u7a4d\u66f8|\u7d0d\u54c1\u66f8|\u9818\u53ce\u66f8|\u5951\u7d04\u66f8|\u901a\u77e5\u66f8|invoice|estimate|quotation|receipt|contract|notice/i;
  const detailPattern = /\u4ef6\u540d|\u5185\u5bb9|\u54c1\u540d|\u9805\u76ee|\u696d\u52d9|\u5236\u4f5c|\u65bd\u5de5|\u8a2d\u8a08|\u6848\u4ef6|project|description|service/i;
  const title = lines.find((line) => titlePattern.test(line));
  const detail = lines.find((line) => detailPattern.test(line) && !new RegExp(`(?:${JP.bank}|TEL|FAX|Email)`, "i").test(line));
  const categoryLabel: Record<MailDocumentCategory, string> = {
    CONTRACT: "契約書",
    DELIVERY_NOTE: "納品書",
    ESTIMATE: "見積書",
    INVOICE: "請求書",
    NOTICE: "通知書",
    OTHER: "その他書類",
    RECEIPT: "領収書",
  };
  return [categoryLabel[category], title, detail].filter(Boolean).slice(0, 3).join(" / ");
}

function categoryFromAi(value: unknown): MailDocumentCategory | null {
  const normalized = textFromAi(value).toLowerCase().replace(/[^a-z_]/g, "");
  return aiCategoryMap[normalized] ?? null;
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function visionFeature() {
  return { type: "DOCUMENT_TEXT_DETECTION" };
}

async function loadServiceAccount(): Promise<GoogleServiceAccount | null> {
  const inline = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.GOOGLE_CLOUD_CREDENTIALS_JSON;
  if (inline) return JSON.parse(inline) as GoogleServiceAccount;

  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!filePath) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as GoogleServiceAccount;
}

async function getGoogleAccessToken() {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) return cachedGoogleToken.accessToken;

  const account = await loadServiceAccount();
  if (!account?.client_email || !account.private_key) return "";

  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      aud: tokenUri,
      exp: now + 3600,
      iat: now,
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(tokenUri, {
    body: new URLSearchParams({
      assertion,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Google OAuth failed: ${response.status}`);

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google OAuth did not return an access token");
  cachedGoogleToken = { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

async function getVisionAuth(): Promise<VisionAuth | null> {
  const { googleVisionApiKey: key } = await effectiveOcrConfig();
  if (key) return { headers: {}, suffix: `?key=${encodeURIComponent(key)}` };

  const token = await getGoogleAccessToken();
  if (!token) return null;
  return { headers: { Authorization: `Bearer ${token}` }, suffix: "" };
}

function parseVisionResponses(json: unknown) {
  type AnnotateResponse = { fullTextAnnotation?: { pages?: Array<{ confidence?: number }>; text?: string } };
  const root = json as {
    responses?: Array<AnnotateResponse | { responses?: AnnotateResponse[] }>;
  };
  const responses =
    root.responses?.flatMap((response) => ("responses" in response && Array.isArray(response.responses) ? response.responses : [response as AnnotateResponse])) ?? [];
  const texts = responses.map((response) => response.fullTextAnnotation?.text ?? "").filter(Boolean);
  const confidences =
    responses
      .flatMap((response) => response.fullTextAnnotation?.pages?.map((page) => page.confidence).filter(Boolean) ?? [])
      .filter((value): value is number => typeof value === "number");
  return {
    confidence: confidences.length ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) : undefined,
    text: texts.join("\n\n"),
  };
}

async function extractWithGoogleVision(fileName: string, mimeType: string, buffer: Buffer): Promise<ExtractedText | null> {
  const auth = await getVisionAuth();
  if (!auth) return null;

  const content = buffer.toString("base64");
  const isFileRequest = supportedPdfLikeTypes.has(mimeType);
  const url = `https://vision.googleapis.com/v1/${isFileRequest ? "files" : "images"}:annotate${auth.suffix}`;
  const body = isFileRequest
    ? {
        requests: [
          {
            features: [visionFeature()],
            inputConfig: { content, mimeType },
            pages: [1, 2, 3, 4, 5],
          },
        ],
      }
    : {
        requests: [
          {
            features: [visionFeature()],
            image: { content },
          },
        ],
      };

  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...auth.headers },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Google Vision OCR failed for ${fileName}: ${response.status}`);

  const parsed = parseVisionResponses(await response.json());
  if (!parsed.text.trim()) return null;

  return {
    confidence: parsed.confidence,
    engine: isFileRequest ? "google-vision-files" : "google-vision-image",
    text: [fileName, parsed.text].join("\n").slice(0, 20000),
    warnings: isFileRequest ? ["Google Vision sync OCR reads up to the first 5 pages in MVP."] : [],
  };
}

async function extractWithLocalFallback(fileName: string, mimeType: string, buffer: Buffer): Promise<ExtractedText> {
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
      if (parsed.text?.trim()) {
        parts.push(parsed.text);
        engine = "pdf-text";
      } else {
        warnings.push("PDF text was empty. Enable Google Vision OCR for scanned PDFs.");
      }
    } catch {
      warnings.push("PDF text extraction failed. Enable Google Vision OCR for scanned PDFs.");
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
      warnings.push("Local image OCR failed. Enable Google Vision OCR for higher accuracy.");
    }
  }

  return { confidence, engine, text: parts.join("\n").slice(0, 12000), warnings };
}

async function analyzeWithAi(extracted: ExtractedText): Promise<AiDocumentAnalysis | null> {
  const { openAiApiKey: apiKey, ocrAiModel: model } = await effectiveOcrConfig();
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    body: JSON.stringify({
      messages: [
        {
          content: AI_SYSTEM_PROMPT,
          role: "system",
        },
        {
          content: `OCR engine: ${extracted.engine}\nOCR warnings: ${extracted.warnings.join(" | ")}\n\nText:\n${extracted.text.slice(0, 14000)}`,
          role: "user",
        },
      ],
      model,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`AI classification failed: ${response.status}`);

  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;
  return JSON.parse(content) as AiDocumentAnalysis;
}

function extractContractAmount(text: string) {
  return amountNear(text, [JP.contractAmount, JP.total, CN.total, "contract amount|amount"]) || extractAmounts(text).total;
}

function extractBillingCount(text: string) {
  const normalizedText = text.replace(/\s+/g, " ").normalize("NFKC");
  const explicit = normalizedText.match(
    /(?:\u8acb\u6c42\u56de\u6570|\u652f\u6255\u56de\u6570|\u652f\u6255\u3044\u56de\u6570|\u5206\u5272\u56de\u6570|\u5206\u5272)[^0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]{0,16}([0-9]{1,2}|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]{1,3})\s*\u56de/,
  );
  if (explicit) return parseJapaneseNumber(explicit[1]);

  const rounds = Array.from(
    normalizedText.matchAll(/\u7b2c\s*([0-9]{1,2}|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]{1,3})\s*\u56de/g),
    (match) => parseJapaneseNumber(match[1]),
  ).filter((round) => round > 0);
  if (rounds.length) return Math.max(...rounds);

  const milestoneCount = ["着手金", "中間金", "完了金", "最終金", "納品時", "検収後"].filter((label) => normalizedText.includes(label)).length;
  if (milestoneCount >= 2) return milestoneCount;

  return 1;
}

function bestMatch<T extends { id: string }>(text: string, items: T[], names: (item: T) => Array<string | undefined>) {
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

function inferReceivedInvoiceFromAnalysis(data: AppData, extracted: ExtractedText, company: CompanyScope | undefined, analysis: AiDocumentAnalysis | null): InferredInvoice {
  const scope = companyFromParam(company);
  const activeVendors = data.vendors.filter((vendor) => !vendor.deletedAt && companyFromParam(vendor.company) === scope);
  const activeProjects = data.projects.filter((project) => !project.deletedAt && matchesCompany(project, scope));
  const activeClients = data.clients.filter((client) => !client.deletedAt);

  const aiSenderName = textFromAi(analysis?.senderName) || textFromAi(analysis?.senderOrganization);
  const aiVendorName = textFromAi(analysis?.vendorName) || aiSenderName;
  const aiProjectHint = textFromAi(analysis?.projectHint);
  const matchingText = [extracted.text, aiSenderName, aiVendorName, aiProjectHint, textFromAi(analysis?.registrationNumber)].filter(Boolean).join("\n");

  const vendorMatch = bestMatch(matchingText, activeVendors, (vendor) => [vendor.companyName, vendor.contactName, vendor.invoiceRegistrationNumber]);
  const projectMatch = bestMatch(matchingText, activeProjects, (project) => {
    const client = activeClients.find((item) => item.id === project.clientId);
    return [project.name, client?.companyName];
  });

  const fallbackDates = extractDates(extracted.text);
  const fallbackAmounts = extractAmounts(extracted.text);
  const issueDate =
    (isIsoDate(analysis?.issueDate) ? analysis.issueDate : "") ||
    dateNear(extracted.text, [JP.issueDate, CN.issueDate]) ||
    fallbackDates[0] ||
    new Date().toISOString().slice(0, 10);
  const dueDate =
    (isIsoDate(analysis?.dueDate) ? analysis.dueDate : "") ||
    dateNear(extracted.text, [JP.dueDate]) ||
    fallbackDates.find((date) => date > issueDate) ||
    addDays(issueDate, 30);
  const aiSubtotal = optionalNumberFromAi(analysis?.subtotal);
  const aiTaxTotal = optionalNumberFromAi(analysis?.taxTotal);
  const aiTotal = optionalNumberFromAi(analysis?.total);
  let subtotal = aiSubtotal ?? fallbackAmounts.subtotal;
  let taxTotal = aiTaxTotal ?? fallbackAmounts.taxTotal;
  let total = aiTotal ?? fallbackAmounts.total;
  if (!total && subtotal + taxTotal > 0) total = subtotal + taxTotal;
  if (total && !subtotal && taxTotal) subtotal = Math.max(total - taxTotal, 0);
  if (total && !taxTotal && aiTaxTotal === undefined) {
    taxTotal = Math.round(total / 11);
    subtotal = subtotal || total - taxTotal;
  }
  if (total && subtotal + taxTotal > 0 && Math.abs(subtotal + taxTotal - total) > Math.max(10, Math.round(total * 0.05))) {
    taxTotal = Math.round(total / 11);
    subtotal = total - taxTotal;
  }

  const vendor = vendorMatch?.item;
  const project = projectMatch?.item;
  const warnings = [...extracted.warnings, ...warningsFromAi(analysis?.warnings)];
  if (!vendorMatch) warnings.push("支払先は既存リストと一致しませんでした。発送元名で自動登録、または確認待ちになります。");
  if (!projectMatch) warnings.push("案件は既存リストと一致しませんでした。確認待ち案件に入ります。");
  if (!total) warnings.push("金額を抽出できませんでした。内容を確認してください。");
  if (!fallbackDates.length && !isIsoDate(analysis?.issueDate)) warnings.push("請求日を抽出できませんでした。今日の日付を仮入力しました。");

  const confidence = Math.min(
    100,
    Math.round(
      (numberFromAi(analysis?.confidence) || 0) * 0.45 +
        (vendorMatch?.score ?? 0) * 8 +
        (projectMatch?.score ?? 0) * 8 +
        (total ? 20 : 0) +
        (issueDate ? 10 : 0),
    ),
  );

  return {
    confidence,
    dueDate,
    issueDate,
    memo: [
      `OCR engine: ${extracted.engine}`,
      analysis ? `AI model: ${process.env.OCR_AI_MODEL || "gpt-5.4-mini"}` : "AI analysis: fallback rules",
      textFromAi(analysis?.memo),
    ]
      .filter(Boolean)
      .join("\n"),
    projectId: project?.id ?? "",
    projectName: project?.name ?? aiProjectHint ?? "案件確認待ち",
    subtotal,
    taxTotal,
    total,
    vendorId: vendor?.id ?? "",
    vendorName: vendor?.companyName ?? aiVendorName ?? "支払先確認待ち",
    warnings,
  };
}

function classifyFromAnalysis(extracted: ExtractedText, analysis: AiDocumentAnalysis | null): MailDocumentClassification | null {
  const category = categoryFromAi(analysis?.documentType);
  if (!category) return null;
  const senderName = textFromAi(analysis?.senderName) || textFromAi(analysis?.senderOrganization) || textFromAi(analysis?.vendorName);
  const contentSummary = textFromAi(analysis?.contentSummary) || textFromAi(analysis?.memo) || inferContentSummary(extracted.text, category);
  const amountSummary = textFromAi(analysis?.amountSummary) || buildAmountSummary(extracted.text, analysis);
  const paymentDestination = buildPaymentDestinationFromAi(analysis) || extractPaymentDestination(extracted.text);
  return {
    category,
    confidence: Math.min(100, numberFromAi(analysis?.confidence) || 60),
    amountSummary: amountSummary || undefined,
    contentSummary: contentSummary || undefined,
    paymentDestination: paymentDestination || undefined,
    reason: textFromAi(analysis?.reason) || "Classified by AI from OCR text.",
    senderName: senderName || undefined,
  };
}

export async function extractDocumentText(fileName: string, mimeType: string, buffer: Buffer): Promise<ExtractedText> {
  try {
    const googleResult = await extractWithGoogleVision(fileName, mimeType, buffer);
    if (googleResult) return googleResult;
  } catch (error) {
    const fallback = await extractWithLocalFallback(fileName, mimeType, buffer);
    return {
      ...fallback,
      warnings: [...fallback.warnings, error instanceof Error ? error.message : "Google Vision OCR failed."],
    };
  }

  return extractWithLocalFallback(fileName, mimeType, buffer);
}

export function classifyMailDocument(extracted: ExtractedText): MailDocumentClassification {
  const text = extracted.text;
  const invoicePatterns = [
    /\u8acb\u6c42\u66f8|\u5fa1\u8acb\u6c42\u66f8|invoice|tax invoice/i,
    /\u652f\u6255\u671f\u9650|\u632f\u8fbc\u5148|\u8acb\u6c42\u91d1\u984d|\u6d88\u8cbb\u7a0e|\u9069\u683c\u8acb\u6c42\u66f8/i,
    /amount due|payment due|bank transfer/i,
  ];
  const categoryPatterns: Array<[MailDocumentCategory, RegExp[]]> = [
    ["CONTRACT", [/\u5951\u7d04\u66f8|\u696d\u52d9\u59d4\u8a17\u5951\u7d04|agreement|contract/i]],
    ["ESTIMATE", [/\u898b\u7a4d\u66f8|\u5fa1\u898b\u7a4d|quotation|estimate/i]],
    ["DELIVERY_NOTE", [/\u7d0d\u54c1\u66f8|delivery note|delivered/i]],
    ["RECEIPT", [/\u9818\u53ce\u66f8|receipt/i]],
    ["NOTICE", [/\u901a\u77e5|\u6848\u5185|\u304a\u77e5\u3089\u305b|notice|information/i]],
  ];
  const dates = extractDates(text);
  const amounts = extractAmounts(text);
  const invoiceSignal = includesAny(text, invoicePatterns);

  if (invoiceSignal && amounts.total > 0) {
    return {
      category: "INVOICE",
      confidence: Math.min(100, 60 + (dates.length ? 15 : 0) + (extracted.confidence ? 10 : 0)),
      amountSummary: buildAmountSummary(text, null),
      contentSummary: inferContentSummary(text, "INVOICE"),
      paymentDestination: extractPaymentDestination(text) || undefined,
      reason: "Invoice keywords and amount were detected.",
    };
  }

  for (const [category, patterns] of categoryPatterns) {
    if (includesAny(text, patterns)) {
      return {
        category,
        confidence: Math.min(100, 55 + (dates.length ? 10 : 0) + (amounts.total ? 10 : 0)),
        amountSummary: buildAmountSummary(text, null) || undefined,
        contentSummary: inferContentSummary(text, category),
        paymentDestination: extractPaymentDestination(text) || undefined,
        reason: "Document category keyword was detected.",
      };
    }
  }

  if (invoiceSignal) {
    return {
      category: "OTHER",
      confidence: 45,
      amountSummary: buildAmountSummary(text, null) || undefined,
      contentSummary: inferContentSummary(text, "OTHER"),
      paymentDestination: extractPaymentDestination(text) || undefined,
      reason: "Invoice-like keywords were detected, but the amount was unclear.",
    };
  }

  return {
    category: "OTHER",
    confidence: extracted.confidence ? Math.min(70, Math.round(extracted.confidence)) : 30,
    amountSummary: buildAmountSummary(text, null) || undefined,
    contentSummary: inferContentSummary(text, "OTHER"),
    paymentDestination: extractPaymentDestination(text) || undefined,
    reason: "Could not confidently classify this as an invoice.",
  };
}

export async function analyzeMailDocument(data: AppData, extracted: ExtractedText, company?: CompanyScope) {
  let aiAnalysis: AiDocumentAnalysis | null = null;
  try {
    aiAnalysis = await analyzeWithAi(extracted);
  } catch (error) {
    extracted.warnings.push(error instanceof Error ? error.message : "AI classification failed.");
  }

  const classification = classifyFromAnalysis(extracted, aiAnalysis) ?? classifyMailDocument(extracted);
  const invoice = classification.category === "INVOICE" ? inferReceivedInvoiceFromAnalysis(data, extracted, company, aiAnalysis) : null;

  return { aiAnalysis, classification, invoice };
}

export function inferReceivedInvoice(data: AppData, extracted: ExtractedText, company?: CompanyScope): InferredInvoice {
  return inferReceivedInvoiceFromAnalysis(data, extracted, company, null);
}

export async function inferReceivedInvoiceWithAi(data: AppData, extracted: ExtractedText, company?: CompanyScope): Promise<InferredInvoice> {
  let aiAnalysis: AiDocumentAnalysis | null = null;
  try {
    aiAnalysis = await analyzeWithAi(extracted);
  } catch (error) {
    extracted.warnings.push(error instanceof Error ? error.message : "AI invoice extraction failed.");
  }
  return inferReceivedInvoiceFromAnalysis(data, extracted, company, aiAnalysis);
}

export function inferContractBilling(extracted: ExtractedText): InferredContractBilling {
  const total = extractContractAmount(extracted.text);
  const billingCount = Math.max(1, Math.min(12, extractBillingCount(extracted.text) || 1));
  const warnings = [...extracted.warnings];

  if (!total) warnings.push("Contract amount was not extracted. Please confirm it on the project list.");
  if (billingCount === 1) warnings.push("Billing count was not clearly extracted. It was set to 1.");

  const confidence = Math.min(100, Math.round((total ? 50 : 0) + (billingCount > 1 ? 30 : 10) + (extracted.confidence ? 10 : 0)));

  return {
    billingCount,
    confidence,
    memo: `Contract OCR: ${extracted.engine}${extracted.confidence ? ` / confidence ${Math.round(extracted.confidence)}%` : ""}`,
    total,
    warnings,
  };
}
