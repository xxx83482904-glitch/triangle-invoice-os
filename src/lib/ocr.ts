import "server-only";

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { companyFromParam, matchesCompany, type CompanyScope } from "@/lib/company";
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
  reason: string;
};

type AiDocumentAnalysis = {
  confidence?: number;
  documentType?: string;
  dueDate?: string;
  issueDate?: string;
  memo?: string;
  projectHint?: string;
  reason?: string;
  registrationNumber?: string;
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

let cachedGoogleToken: { accessToken: string; expiresAt: number } | null = null;

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s.,_\-()（）・　]/g, "")
    .replace(/株式会社|有限会社|合同会社|股份有限公司|有限公司|co\.?ltd\.?|inc\.?/gi, "");
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

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
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
    const pattern = new RegExp(`${label}[^0-9]{0,24}([0-9][0-9,]{2,})`, "i");
    const match = normalizedText.match(pattern);
    if (match) return parseAmount(match[1]);
  }
  return 0;
}

function extractAmounts(text: string) {
  const total =
    amountNear(text, [
      "税込合計",
      "御請求金額",
      "ご請求額",
      "請求金額",
      "合計金額",
      "お支払金額",
      "amount due",
      "total amount",
      "total",
    ]) || Math.max(0, ...Array.from(text.matchAll(/[¥￥]?\s*([0-9][0-9,]{3,})/g), (match) => parseAmount(match[1])));
  const taxTotal = amountNear(text, ["消費税額", "消費税", "税額", "tax"]);
  const subtotal = amountNear(text, ["税抜合計", "小計", "税抜", "subtotal"]);

  if (subtotal && taxTotal) return { subtotal, taxTotal, total: total || subtotal + taxTotal };
  if (total && taxTotal) return { subtotal: Math.max(total - taxTotal, 0), taxTotal, total };
  if (total) {
    const inferredTax = Math.round(total / 11);
    return { subtotal: total - inferredTax, taxTotal: inferredTax, total };
  }
  return { subtotal: 0, taxTotal: 0, total: 0 };
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function numberFromAi(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") return parseAmount(value);
  return 0;
}

function textFromAi(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function warningsFromAi(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function categoryFromAi(value: unknown): MailDocumentCategory | null {
  const normalized = textFromAi(value).toLowerCase().replace(/[^a-z_]/g, "");
  return aiCategoryMap[normalized] ?? null;
}

function visionFeature() {
  return { type: "DOCUMENT_TEXT_DETECTION" };
}

function getVisionApiKey() {
  return process.env.GOOGLE_CLOUD_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY || "";
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
  const key = getVisionApiKey();
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
      ?.flatMap((response) => response.fullTextAnnotation?.pages?.map((page) => page.confidence).filter(Boolean) ?? [])
      .filter((value): value is number => typeof value === "number") ?? [];
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OCR_AI_MODEL || "gpt-4.1-nano";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    body: JSON.stringify({
      messages: [
        {
          content:
            "You classify Japanese/Chinese business documents and extract invoice fields. Return JSON only. documentType must be one of invoice, contract, estimate, delivery_note, receipt, notice, other. Dates must be YYYY-MM-DD. Money values must be integer JPY/CNY values without commas. Include confidence 0-100, reason, warnings array.",
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
  return (
    amountNear(text, [
      "契約金額",
      "契約料金",
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
  const explicit = normalizedText.match(/(?:請求回数|支払回数|支払い回数|分割回数|分割)[^0-9一二三四五六七八九十]{0,12}([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*回/);
  if (explicit) return parseJapaneseNumber(explicit[1]);

  const rounds = Array.from(
    normalizedText.matchAll(/第\s*([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*回/g),
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

  const aiVendorName = textFromAi(analysis?.vendorName);
  const aiProjectHint = textFromAi(analysis?.projectHint);
  const matchingText = [extracted.text, aiVendorName, aiProjectHint, textFromAi(analysis?.registrationNumber)].filter(Boolean).join("\n");

  const vendorMatch = bestMatch(matchingText, activeVendors, (vendor) => [vendor.companyName, vendor.contactName, vendor.invoiceRegistrationNumber]);
  const projectMatch = bestMatch(matchingText, activeProjects, (project) => {
    const client = activeClients.find((item) => item.id === project.clientId);
    return [project.name, client?.companyName];
  });

  const fallbackDates = extractDates(extracted.text);
  const fallbackAmounts = extractAmounts(extracted.text);
  const issueDate = isIsoDate(analysis?.issueDate) ? analysis.issueDate : fallbackDates[0] ?? new Date().toISOString().slice(0, 10);
  const dueDate = isIsoDate(analysis?.dueDate) ? analysis.dueDate : fallbackDates.find((date) => date > issueDate) ?? addDays(issueDate, 30);
  const subtotal = numberFromAi(analysis?.subtotal) || fallbackAmounts.subtotal;
  const taxTotal = numberFromAi(analysis?.taxTotal) || fallbackAmounts.taxTotal;
  const total = numberFromAi(analysis?.total) || fallbackAmounts.total || subtotal + taxTotal;
  const vendor = vendorMatch?.item ?? activeVendors[0];
  const project = projectMatch?.item ?? activeProjects[0];
  const warnings = [...extracted.warnings, ...warningsFromAi(analysis?.warnings)];

  if (!vendorMatch) warnings.push("Vendor was not matched automatically. Please confirm it.");
  if (!projectMatch) warnings.push("Project was not matched automatically. Please confirm it.");
  if (!total) warnings.push("Amount was not extracted. Please confirm it.");
  if (!fallbackDates.length && !isIsoDate(analysis?.issueDate)) warnings.push("Issue date was not extracted. Today's date was used.");

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
      analysis ? `AI model: ${process.env.OCR_AI_MODEL || "gpt-4.1-nano"}` : "AI analysis: fallback rules",
      textFromAi(analysis?.memo),
    ]
      .filter(Boolean)
      .join("\n"),
    projectId: project?.id ?? "",
    projectName: project?.name ?? "Unassigned",
    subtotal,
    taxTotal,
    total,
    vendorId: vendor?.id ?? "",
    vendorName: vendor?.companyName ?? "Unassigned",
    warnings,
  };
}

function classifyFromAnalysis(extracted: ExtractedText, analysis: AiDocumentAnalysis | null): MailDocumentClassification | null {
  const category = categoryFromAi(analysis?.documentType);
  if (!category) return null;
  return {
    category,
    confidence: Math.min(100, numberFromAi(analysis?.confidence) || 60),
    reason: textFromAi(analysis?.reason) || "Classified by AI from OCR text.",
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
    /請求書|御請求|ご請求|invoice|tax invoice/i,
    /支払期限|お支払期限|振込先|請求金額|消費税|適格請求書|登録番号/i,
    /amount due|payment due|bank transfer/i,
  ];
  const categoryPatterns: Array<[MailDocumentCategory, RegExp[]]> = [
    ["CONTRACT", [/契約書|業務委託契約|覚書|agreement|contract/i]],
    ["ESTIMATE", [/見積書|御見積|quotation|estimate/i]],
    ["DELIVERY_NOTE", [/納品書|delivery note|delivered/i]],
    ["RECEIPT", [/領収書|receipt/i]],
    ["NOTICE", [/通知|案内|お知らせ|notice|information/i]],
  ];
  const dates = extractDates(text);
  const amounts = extractAmounts(text);
  const invoiceSignal = includesAny(text, invoicePatterns);

  if (invoiceSignal && amounts.total > 0) {
    return {
      category: "INVOICE",
      confidence: Math.min(100, 60 + (dates.length ? 15 : 0) + (extracted.confidence ? 10 : 0)),
      reason: "Invoice keywords and amount were detected.",
    };
  }

  for (const [category, patterns] of categoryPatterns) {
    if (includesAny(text, patterns)) {
      return {
        category,
        confidence: Math.min(100, 55 + (dates.length ? 10 : 0) + (amounts.total ? 10 : 0)),
        reason: "Document category keyword was detected.",
      };
    }
  }

  if (invoiceSignal) {
    return {
      category: "OTHER",
      confidence: 45,
      reason: "Invoice-like keywords were detected, but the amount was unclear.",
    };
  }

  return {
    category: "OTHER",
    confidence: extracted.confidence ? Math.min(70, Math.round(extracted.confidence)) : 30,
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
