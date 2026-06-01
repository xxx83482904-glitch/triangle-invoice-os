import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { extractDocumentText, inferReceivedInvoice } from "@/lib/ocr";
import { can } from "@/lib/rbac";
import { mutateData, newId, readData } from "@/lib/store";
import type { ReceivedInvoice } from "@/lib/types";

type ImportResult = {
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

  const results: ImportResult[] = [];

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
    const data = await readData();
    const inferred = inferReceivedInvoice(data, extracted, company);

    if (!inferred.vendorId || !inferred.projectId) {
      results.push({
        confidence: inferred.confidence,
        error: "支払先または案件の候補がないため登録できません",
        fileName: file.name,
        warnings: inferred.warnings,
      });
      continue;
    }

    const duplicate = data.receivedInvoices.find(
      (invoice) =>
        !invoice.deletedAt &&
        invoice.vendorId === inferred.vendorId &&
        invoice.issueDate === inferred.issueDate &&
        invoice.total === inferred.total &&
        inferred.total > 0,
    );
    if (duplicate) {
      results.push({
        confidence: inferred.confidence,
        duplicate: true,
        error: "同じ支払先・請求日・金額の受領請求書が既に登録されています",
        fileName: file.name,
        warnings: inferred.warnings,
      });
      continue;
    }

    const id = newId();
    const timestamp = new Date().toISOString();
    const safeName = `${id}${extension}`;
    await saveReceivedInvoiceFile(safeName, buffer, file.type);

    const invoice: ReceivedInvoice = {
      id,
      vendorId: inferred.vendorId,
      projectId: inferred.projectId,
      receivedDate: timestamp.slice(0, 10),
      issueDate: inferred.issueDate,
      dueDate: inferred.dueDate,
      subtotal: inferred.subtotal,
      taxTotal: inferred.taxTotal,
      total: inferred.total,
      status: "REVIEWING",
      fileUrl: receivedInvoiceFileUrl(safeName),
      originalFileName: file.name,
      mimeType: file.type,
      ocrText: extracted.text,
      memo: [inferred.memo, ...inferred.warnings].join("\n"),
      uploadedById: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await mutateData(user.id, "OCR_DROP_RECEIVED_INVOICE", "ReceivedInvoice", id, (draft) => {
      draft.receivedInvoices.unshift(invoice);
      draft.attachments.unshift({
        id: newId(),
        relatedType: "ReceivedInvoice",
        relatedId: id,
        fileUrl: invoice.fileUrl ?? "",
        fileName: file.name,
        mimeType: file.type,
        uploadedById: user.id,
        createdAt: timestamp,
      });
      return invoice;
    });

    results.push({
      confidence: inferred.confidence,
      fileName: file.name,
      invoice: {
        dueDate: inferred.dueDate,
        issueDate: inferred.issueDate,
        projectName: inferred.projectName,
        total: inferred.total,
        vendorName: inferred.vendorName,
      },
      warnings: inferred.warnings,
    });
  }

  return NextResponse.json({ results });
}
