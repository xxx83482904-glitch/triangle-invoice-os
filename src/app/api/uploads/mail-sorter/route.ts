import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { classifyMailDocument, extractDocumentText, inferReceivedInvoice } from "@/lib/ocr";
import { can } from "@/lib/rbac";
import { mutateData, newId, readData } from "@/lib/store";
import type { MailDocument, MailDocumentCategory, ReceivedInvoice } from "@/lib/types";

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
    const extracted = await extractDocumentText(file.name, file.type, buffer);
    const classification = classifyMailDocument(extracted);
    const data = await readData();
    const id = newId();
    const timestamp = new Date().toISOString();
    const safeName = `${id}${extension}`;
    await saveReceivedInvoiceFile(safeName, buffer, file.type);
    const fileUrl = receivedInvoiceFileUrl(safeName);

    if (classification.category === "INVOICE") {
      const inferred = inferReceivedInvoice(data, extracted, company);
      if (inferred.vendorId && inferred.projectId) {
        const duplicate = data.receivedInvoices.find(
          (invoice) =>
            !invoice.deletedAt &&
            invoice.vendorId === inferred.vendorId &&
            invoice.issueDate === inferred.issueDate &&
            invoice.total === inferred.total &&
            inferred.total > 0,
        );
        const invoiceId = duplicate?.id ?? id;

        const mailDocument: MailDocument = {
          id: newId(),
          company,
          category: "INVOICE",
          title: file.name,
          fileUrl,
          originalFileName: file.name,
          mimeType: file.type,
          ocrText: extracted.text,
          confidence: classification.confidence,
          relatedReceivedInvoiceId: invoiceId,
          memo: duplicate ? "重複候補のため既存の受領請求書に紐づけました" : classification.reason,
          uploadedById: user.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const invoice: ReceivedInvoice = {
          id: invoiceId,
          vendorId: inferred.vendorId,
          projectId: inferred.projectId,
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
          memo: [inferred.memo, classification.reason, ...inferred.warnings].join("\n"),
          uploadedById: user.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        await mutateData(user.id, "SORT_MAIL_DOCUMENT", "MailDocument", mailDocument.id, (draft) => {
          draft.mailDocuments.unshift(mailDocument);
          if (!duplicate) {
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
          duplicate: Boolean(duplicate),
          fileName: file.name,
          invoice: {
            dueDate: inferred.dueDate,
            issueDate: inferred.issueDate,
            projectName: inferred.projectName,
            total: inferred.total,
            vendorName: inferred.vendorName,
          },
          reason: classification.reason,
          savedAs: duplicate ? "other-document" : "received-invoice",
          warnings: inferred.warnings,
        });
        continue;
      }
    }

    const mailDocument: MailDocument = {
      id,
      company,
      category: classification.category === "INVOICE" ? "OTHER" : classification.category,
      title: file.name,
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
