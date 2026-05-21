import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { can } from "@/lib/rbac";
import { mutateData, newId, readData } from "@/lib/store";
import type { ReceivedInvoice } from "@/lib/types";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function numeric(formData: FormData, key: string) {
  const value = Number(field(formData, key).replaceAll(",", ""));
  return Number.isFinite(value) ? value : 0;
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!can(user, "manage:receivedInvoices") && !can(user, "upload:receivedInvoices")) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const formData = await request.formData();
  const company = companyFromParam(field(formData, "company"));
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ファイルを選択してください" }, { status: 400 });
  }
  const extension = allowedUploadTypes.get(file.type);
  if (!extension) {
    return NextResponse.json({ error: "PDF、JPEG、PNGのみアップロードできます" }, { status: 400 });
  }
  if (file.size > maxUploadSize) {
    return NextResponse.json({ error: "ファイルサイズは10MB以内にしてください" }, { status: 400 });
  }

  const data = await readData();
  const duplicate = data.receivedInvoices.find(
    (invoice) =>
      !invoice.deletedAt &&
      invoice.vendorId === field(formData, "vendorId") &&
      invoice.issueDate === field(formData, "issueDate") &&
      invoice.total === numeric(formData, "total"),
  );
  if (duplicate) {
    return NextResponse.json(
      { error: "同じ支払先・請求日・金額の受領請求書が既に登録されています" },
      { status: 409 },
    );
  }

  const id = newId();
  const safeName = `${id}${extension}`;
  await saveReceivedInvoiceFile(safeName, Buffer.from(await file.arrayBuffer()));

  const timestamp = new Date().toISOString();
  const subtotal = numeric(formData, "subtotal");
  const taxTotal = numeric(formData, "taxTotal");
  const invoice: ReceivedInvoice = {
    id,
    vendorId: field(formData, "vendorId"),
    projectId: field(formData, "projectId"),
    receivedDate: timestamp.slice(0, 10),
    issueDate: field(formData, "issueDate"),
    dueDate: field(formData, "dueDate"),
    subtotal,
    taxTotal,
    total: numeric(formData, "total") || subtotal + taxTotal,
    status: "RECEIVED",
    fileUrl: receivedInvoiceFileUrl(safeName),
    originalFileName: file.name,
    mimeType: file.type,
    ocrText: "",
    memo: field(formData, "memo"),
    uploadedById: user.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await mutateData(user.id, "UPLOAD_RECEIVED_INVOICE", "ReceivedInvoice", id, (draft) => {
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

  return NextResponse.redirect(new URL(`/received-invoices?company=${company}&uploaded=1`, request.url), { status: 303 });
}
