import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { analyzeMailDocument, extractDocumentText } from "@/lib/ocr";
import { can } from "@/lib/rbac";
import { mutateData, newId, readData } from "@/lib/store";
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

function inferSenderName(text: string, fileName: string) {
  const organizationPattern = /(株式会社|有限会社|合同会社|一般社団法人|学校法人|医療法人|股份有限公司|有限公司|公司|Inc\.?|Co\.?\s*Ltd\.?|LLC)/i;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2 && line.length <= 60);
  const matched = lines.find((line) => organizationPattern.test(line));
  if (matched) return matched;
  return lines[0] || fileName.replace(/\.[^.]+$/, "");
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
  if (!can(user, "manage:receivedInvoices") && !can(user, "upload:receivedInvoices")) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const formData = await request.formData();
  const company = companyFromParam(String(formData.get("company") ?? ""));
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
    const senderName = classification.senderName || inferred?.vendorName || inferSenderName(extracted.text, file.name);
    const id = newId();
    const timestamp = new Date().toISOString();
    const safeName = `${id}${extension}`;
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
        title: file.name,
        senderName,
        fileUrl,
        originalFileName: file.name,
        mimeType: file.type,
        ocrText: extracted.text,
        confidence: classification.confidence,
        relatedReceivedInvoiceId: invoiceId,
        memo: classification.reason,
        uploadedById: user.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await mutateData(user.id, "SORT_MAIL_DOCUMENT", "MailDocument", mailDocument.id, (draft) => {
        const vendor = inferred.vendorId
          ? draft.vendors.find((item) => item.id === inferred.vendorId && !item.deletedAt) ?? ensureReviewVendor(draft, company, timestamp)
          : senderName
            ? ensureVendorByName(draft, company, senderName, timestamp)
            : ensureReviewVendor(draft, company, timestamp);
        const project = inferred.projectId
          ? draft.projects.find((item) => item.id === inferred.projectId && !item.deletedAt) ?? ensureReviewProject(draft, company, timestamp)
          : ensureReviewProject(draft, company, timestamp);

        if (!inferred.vendorId) fallbackWarnings.push("支払先を特定できなかったため、OCR未確認支払先に仮登録しました。");
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
        mailDocument.memo = duplicate ? "重複候補のため既存の受領請求書に紐づけました" : classification.reason;

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
          originalFileName: file.name,
          mimeType: file.type,
          ocrText: extracted.text,
          memo: [inferred.memo, classification.reason, ...fallbackWarnings].filter(Boolean).join("\n"),
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
            fileName: file.name,
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
        fileName: file.name,
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
      title: file.name,
      senderName,
      fileUrl,
      originalFileName: file.name,
      mimeType: file.type,
      ocrText: extracted.text,
      confidence: classification.confidence,
      memo: classification.reason,
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
        fileName: file.name,
        mimeType: file.type,
        uploadedById: user.id,
        createdAt: timestamp,
      });
      return mailDocument;
    });

    results.push({
      category: mailDocument.category,
      confidence: classification.confidence,
      fileName: file.name,
      reason: classification.reason,
      savedAs: "other-document",
      warnings: extracted.warnings,
    });
  }

  return NextResponse.json({ results });
}
