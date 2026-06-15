import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { mailSorterCompany } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize, readableUploadFileName, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { analyzeMailDocument, extractDocumentText } from "@/lib/ocr";
import { can } from "@/lib/rbac";
import { mutateData, newId, readData } from "@/lib/store";
import type { MailDocumentClassification } from "@/lib/ocr";
import type { AppData, Client, MailDocument, MailDocumentCategory, Project, ReceivedInvoice, Vendor } from "@/lib/types";

type SortResult = {
  category?: MailDocumentCategory;
  confidence?: number;
  duplicate?: boolean;
  error?: string;
  fileName: string;
  invoice?: {
    dueDate: string;
    issueDate: string;
    projectName: string;
    total: number;
    vendorName: string;
  };
  reason?: string;
  savedAs?: "received-invoice" | "other-document";
  warnings?: string[];
};

const organizationPattern =
  /(株式会社|有限会社|合同会社|一般社団法人|学校法人|医療法人|行政書士法人|税理士法人|弁護士法人|股份有限公司|有限公司|公司|集团|集團|事务所|事務所|工作室|设计院|設計|建築|印刷|施工|工務店|製作所|協会|協會|协会|財団|大学|学校|病院|Inc\.?|Co\.?\s*Ltd\.?|Corporation|Limited|Company|LLC|Studio|Design|Architects?|Partners?)/i;
const senderCuePattern = /(発送元|差出人|送信者|発行者|請求者|販売者|支払先|振込先|発件人|发件人|寄件人|開票方|开票方|銷售方|销售方|供應商|供应商|出票人|收款方|From)/i;
const recipientCuePattern = /(御中|様|殿|宛|宛先|請求先|納品先|送付先|送付先|送った相手|受取人|收件人|收货方|收貨方|购买方|購買方|客户|客戶|付款方|Bill\s*To|Ship\s*To|To:)/i;
const nonCompanyPattern = /(請求書|見積書|納品書|領収書|契約書|通知書|件名|日付|発行日|請求日|支払期限|合計|小計|消費税|税抜|税込|数量|単価|銀行|口座|登録番号|郵便番号|住所|電話|TEL|FAX|Email|メール|http|www\.)/i;
const placeholderSenderPattern = /^(Unassigned|支払先未設定|支払先確認待ち|発送元確認待ち|OCR未確認支払先|未設定|-)?$/i;

function cleanSenderCandidate(value: string) {
  return value
    .replace(/^[\s:：・\-–—|/\\［\]【】()[\]{}]+/, "")
    .replace(senderCuePattern, "")
    .replace(/^[\s:：・\-–—|/\\［\]【】()[\]{}]+/, "")
    .replace(/\s*(御中|様|殿)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsableSenderName(value?: string) {
  const cleaned = cleanSenderCandidate(value ?? "");
  return cleaned.length >= 2 && !placeholderSenderPattern.test(cleaned);
}

function inferSenderName(text: string) {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u0000/g, "").trim())
    .filter(Boolean);

  const candidates: Array<{ name: string; score: number }> = [];
  rawLines.forEach((line, index) => {
    const withNext = rawLines[index + 1] ? `${line} ${rawLines[index + 1]}` : line;
    for (const candidateLine of [line, withNext]) {
      const name = cleanSenderCandidate(candidateLine);
      if (name.length < 2 || name.length > 80) continue;

      let score = 0;
      if (organizationPattern.test(name)) score += 70;
      if (senderCuePattern.test(candidateLine) || senderCuePattern.test(rawLines[index - 1] ?? "")) score += 60;
      if (/[一-龯ぁ-んァ-ヶA-Za-z]{2,}/.test(name)) score += 12;
      if (index < 20) score += 22 - index;
      if (recipientCuePattern.test(candidateLine) || recipientCuePattern.test(rawLines[index - 1] ?? "")) score -= 85;
      if (nonCompanyPattern.test(name) && !organizationPattern.test(name)) score -= 45;
      if ((name.match(/[0-9]/g)?.length ?? 0) > name.length / 2) score -= 30;
      if (name.includes("TRIANGLE") || name.includes("トライアングル")) score -= 25;
      if (score > 0) candidates.push({ name, score });
    }
  });

  const best = candidates.sort((a, b) => b.score - a.score || a.name.length - b.name.length)[0];
  if (best) return best.name;

  const fallback = rawLines
    .map(cleanSenderCandidate)
    .find((line) => line.length >= 2 && line.length <= 60 && !recipientCuePattern.test(line) && !nonCompanyPattern.test(line));
  return fallback || "発送元確認待ち";
}

function buildMailSummaryMemo({
  classification,
  duplicate,
  invoice,
  senderName,
}: {
  classification: MailDocumentClassification;
  duplicate?: boolean;
  invoice?: {
    dueDate?: string;
    issueDate?: string;
    memo?: string;
    subtotal?: number;
    taxTotal?: number;
    total?: number;
  } | null;
  senderName: string;
}) {
  const amountSummary =
    classification.amountSummary ||
    (invoice?.total
      ? [
          `合計 ${invoice.total.toLocaleString("ja-JP")}円`,
          invoice.subtotal ? `税抜 ${invoice.subtotal.toLocaleString("ja-JP")}円` : "",
          invoice.taxTotal ? `消費税 ${invoice.taxTotal.toLocaleString("ja-JP")}円` : "",
        ]
          .filter(Boolean)
          .join(" / ")
      : "");
  return [
    `発送元: ${senderName}`,
    classification.contentSummary ? `内容: ${classification.contentSummary}` : "",
    amountSummary ? `金額: ${amountSummary}` : "",
    classification.paymentDestination ? `振込先: ${classification.paymentDestination}` : "",
    invoice?.issueDate ? `請求日: ${invoice.issueDate}` : "",
    invoice?.dueDate ? `支払期限: ${invoice.dueDate}` : "",
    duplicate ? "判定: 重複候補のため既存の受領請求書に紐づけました" : `判定: ${classification.reason}`,
    invoice?.memo,
  ]
    .filter(Boolean)
    .join("\n");
}

function companyLabel(company: "CHINA" | "JAPAN") {
  return company === "CHINA" ? "中国" : "日本";
}

function ensureReviewClient(data: AppData, company: "CHINA" | "JAPAN", timestamp: string): Client {
  const existing =
    data.clients.find((client) => !client.deletedAt && client.company === company) ??
    data.clients.find((client) => !client.deletedAt);
  if (existing) return existing;

  const client: Client = {
    id: `ocr-review-client-${company.toLowerCase()}`,
    company,
    companyName: `${companyLabel(company)} OCR未確認クライアント`,
    contactName: "OCR確認待ち",
    memo: "OCRで請求書を取り込むための仮クライアントです。",
    sortOrder: data.clients.length + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  data.clients.unshift(client);
  return client;
}

function ensureReviewVendor(data: AppData, company: "CHINA" | "JAPAN", timestamp: string): Vendor {
  const id = `ocr-review-vendor-${company.toLowerCase()}`;
  const existing = data.vendors.find((vendor) => !vendor.deletedAt && vendor.id === id);
  if (existing) return existing;

  const vendor: Vendor = {
    id,
    company,
    companyName: `${companyLabel(company)} OCR未確認支払先`,
    contactName: "OCR確認待ち",
    memo: "OCRで支払先を特定できなかった請求書の仮支払先です。",
    sortOrder: data.vendors.filter((vendorItem) => vendorItem.company === company).length + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  data.vendors.unshift(vendor);
  return vendor;
}

function ensureVendorByName(data: AppData, company: "CHINA" | "JAPAN", companyName: string, timestamp: string): Vendor {
  const normalized = companyName.trim().toLowerCase();
  const existing = data.vendors.find(
    (vendor) => !vendor.deletedAt && vendor.company === company && vendor.companyName.trim().toLowerCase() === normalized,
  );
  if (existing) return existing;

  const vendor: Vendor = {
    id: newId(),
    company,
    companyName: companyName.trim(),
    contactName: "OCR自動登録",
    memo: "OCRで発送元として読み取った会社・組織を支払先として自動登録しました。",
    sortOrder: data.vendors.filter((vendorItem) => vendorItem.company === company).length + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  data.vendors.unshift(vendor);
  return vendor;
}

function ensureReviewProject(data: AppData, company: "CHINA" | "JAPAN", timestamp: string): Project {
  const id = `ocr-review-project-${company.toLowerCase()}`;
  const existing = data.projects.find((project) => !project.deletedAt && project.id === id);
  if (existing) return existing;

  const client = ensureReviewClient(data, company, timestamp);
  const project: Project = {
    id,
    name: `${companyLabel(company)} OCR未確認案件`,
    clientId: client.id,
    company,
    managerId: "usr-admin",
    memberIds: ["usr-admin"],
    status: "WAITING",
    stage: "確認待ち",
    contractAmount: 0,
    billingCount: 1,
    memo: "OCRで案件を特定できなかった受領請求書の仮案件です。",
    sortOrder: data.projects.filter((projectItem) => projectItem.company === company).length + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  data.projects.unshift(project);
  return project;
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!can(user, "manage:mailSorter") && !can(user, "manage:receivedInvoices") && !can(user, "upload:receivedInvoices")) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const formData = await request.formData();
  const company = mailSorterCompany;
  const files = formData.getAll("files").filter((file): file is File => file instanceof File);
  if (!files.length) return NextResponse.json({ error: "ファイルをドロップしてください" }, { status: 400 });

  const results: SortResult[] = [];

  for (const file of files) {
    const extension = allowedUploadTypes.get(file.type);
    if (!extension) {
      results.push({ error: "PDF、JPEG、PNGのみ対応しています", fileName: file.name });
      continue;
    }
    if (file.size > maxUploadSize) {
      results.push({ error: "10MBを超えるファイルは登録できません", fileName: file.name });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const data = await readData();
    const extracted = await extractDocumentText(file.name, file.type, buffer);
    const { classification, invoice: inferred } = await analyzeMailDocument(data, extracted, company);
    const senderName = isUsableSenderName(classification.senderName)
      ? cleanSenderCandidate(classification.senderName ?? "")
      : isUsableSenderName(inferred?.vendorName)
        ? cleanSenderCandidate(inferred?.vendorName ?? "")
        : inferSenderName(extracted.text);
    const id = newId();
    const timestamp = new Date().toISOString();
    const safeName = readableUploadFileName({ date: timestamp.slice(0, 10), extension, id, senderName });
    await saveReceivedInvoiceFile(safeName, buffer, file.type);
    const fileUrl = receivedInvoiceFileUrl(safeName);

    if (classification.category === "INVOICE" && inferred) {
      const fallbackWarnings = [...inferred.warnings];
      let invoiceId = id;
      let duplicate = false;
      let projectName = inferred.projectName;
      let vendorName = inferred.vendorName;

      const mailDocument: MailDocument = {
        id: newId(),
        company,
        category: "INVOICE",
        title: safeName,
        senderName,
        fileUrl,
        originalFileName: safeName,
        mimeType: file.type,
        ocrText: extracted.text,
        confidence: classification.confidence,
        relatedReceivedInvoiceId: invoiceId,
        memo: buildMailSummaryMemo({ classification, invoice: inferred, senderName }),
        uploadedById: user.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await mutateData(user.id, "SORT_MAIL_DOCUMENT", "MailDocument", mailDocument.id, (draft) => {
        const vendor = inferred.vendorId
          ? draft.vendors.find((item) => item.id === inferred.vendorId && !item.deletedAt) ?? ensureReviewVendor(draft, company, timestamp)
          : senderName !== "発送元確認待ち"
            ? ensureVendorByName(draft, company, senderName, timestamp)
            : ensureReviewVendor(draft, company, timestamp);
        const project = inferred.projectId
          ? draft.projects.find((item) => item.id === inferred.projectId && !item.deletedAt) ?? ensureReviewProject(draft, company, timestamp)
          : ensureReviewProject(draft, company, timestamp);

        if (!inferred.vendorId && senderName === "発送元確認待ち") fallbackWarnings.push("支払先を特定できなかったため、OCR未確認支払先に仮登録しました。");
        if (!inferred.vendorId && senderName !== "発送元確認待ち") fallbackWarnings.push("発送元を支払先として自動登録しました。");
        if (!inferred.projectId) fallbackWarnings.push("案件を特定できなかったため、OCR未確認案件に仮登録しました。");

        vendorName = vendor.companyName;
        mailDocument.senderName = vendor.companyName || senderName;
        projectName = project.name;
        const existing = draft.receivedInvoices.find(
          (invoice) =>
            !invoice.deletedAt &&
            invoice.vendorId === vendor.id &&
            invoice.issueDate === inferred.issueDate &&
            invoice.total === inferred.total &&
            inferred.total > 0,
        );
        duplicate = Boolean(existing);
        invoiceId = existing?.id ?? invoiceId;
        mailDocument.relatedReceivedInvoiceId = invoiceId;
        mailDocument.memo = buildMailSummaryMemo({ classification, duplicate, invoice: inferred, senderName: mailDocument.senderName || senderName });

        const invoice: ReceivedInvoice = {
          id: invoiceId,
          vendorId: vendor.id,
          projectId: project.id,
          receivedDate: timestamp.slice(0, 10),
          issueDate: inferred.issueDate,
          dueDate: inferred.dueDate,
          subtotal: inferred.subtotal,
          taxTotal: inferred.taxTotal,
          total: inferred.total,
          status: "REVIEWING",
          fileUrl,
          originalFileName: safeName,
          mimeType: file.type,
          ocrText: extracted.text,
          memo: [buildMailSummaryMemo({ classification, invoice: inferred, senderName: mailDocument.senderName || senderName }), ...fallbackWarnings].filter(Boolean).join("\n"),
          uploadedById: user.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        draft.mailDocuments.unshift(mailDocument);
        if (!existing) {
          draft.receivedInvoices.unshift(invoice);
          draft.attachments.unshift({
            id: newId(),
            relatedType: "ReceivedInvoice",
            relatedId: invoice.id,
            fileUrl,
            fileName: safeName,
            mimeType: file.type,
            uploadedById: user.id,
            createdAt: timestamp,
          });
        }
        return mailDocument;
      });

      results.push({
        category: "INVOICE",
        confidence: classification.confidence,
        duplicate,
        fileName: safeName,
        invoice: {
          dueDate: inferred.dueDate,
          issueDate: inferred.issueDate,
          projectName,
          total: inferred.total,
          vendorName,
        },
        reason: classification.reason,
        savedAs: duplicate ? "other-document" : "received-invoice",
        warnings: fallbackWarnings,
      });
      continue;
    }

    const mailDocument: MailDocument = {
      id,
      company,
      category: classification.category === "INVOICE" ? "OTHER" : classification.category,
      title: safeName,
      senderName,
      fileUrl,
      originalFileName: safeName,
      mimeType: file.type,
      ocrText: extracted.text,
      confidence: classification.confidence,
      memo: buildMailSummaryMemo({ classification, senderName }),
      uploadedById: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await mutateData(user.id, "SORT_MAIL_DOCUMENT", "MailDocument", id, (draft) => {
      draft.mailDocuments.unshift(mailDocument);
      draft.attachments.unshift({
        id: newId(),
        relatedType: "MailDocument",
        relatedId: id,
        fileUrl,
        fileName: safeName,
        mimeType: file.type,
        uploadedById: user.id,
        createdAt: timestamp,
      });
      return mailDocument;
    });

    results.push({
      category: mailDocument.category,
      confidence: classification.confidence,
      fileName: safeName,
      reason: classification.reason,
      savedAs: "other-document",
      warnings: extracted.warnings,
    });
  }

  return NextResponse.json({ results });
}
