import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { submitCardReceipt, type CardReceiptSubmit } from "@/lib/card-receipts";
import { companyFromParam } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize, readableUploadFileName, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { can } from "@/lib/rbac";
import { mutateData, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData } from "@/lib/types";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function liveActor(data: AppData, id: string) {
  const user = data.users.find((row) => row.id === id && isActiveUser(row));
  if (!user) throw new Error("利用者の権限が変わっています");
  return user;
}

// A company card receipt: stored, then attached to the matching use on the person's own card when one fits.
export async function POST(request: Request) {
  const user = await requireUser();
  if (!can(user, "submit:expenses")) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  try {
    const formData = await request.formData(), company = companyFromParam(field(formData, "company"));
    const upload = formData.get("file"), file = upload instanceof File && upload.name && upload.size ? upload : undefined;
    if (!file) return NextResponse.json({ error: "領収書の写真かPDFを添付してください" }, { status: 400 });
    const extension = allowedUploadTypes.get(file.type);
    if (!extension) throw new Error("PDF、JPEG、PNGのみアップロードできます");
    if (file.size > maxUploadSize) throw new Error("ファイルサイズは10MB以内にしてください");
    const id = globalThis.crypto.randomUUID(), spentOn = field(formData, "spentOn"), payee = field(formData, "payee");
    const name = readableUploadFileName({ date: spentOn, extension, id, senderName: `card_${payee}` });
    const amount = (key: string) => { const value = field(formData, key).replaceAll(",", ""); return value ? Number(value) : undefined; };
    const tax10 = amount("tax10"), tax8 = amount("tax8");
    const input: CardReceiptSubmit = { spentOn, amount: Number(field(formData, "amount").replaceAll(",", "")), payee, purpose: field(formData, "purpose"),
      categoryId: field(formData, "categoryId") || undefined, projectId: field(formData, "projectId") || undefined, memo: field(formData, "memo") || undefined,
      registrationNumber: field(formData, "registrationNumber").normalize("NFKC").replace(/[\s-]/g, "").toUpperCase() || undefined,
      taxBreakdown: tax10 === undefined && tax8 === undefined ? undefined : { ...(tax10 !== undefined ? { rate10: tax10 } : {}), ...(tax8 !== undefined ? { rate8: tax8 } : {}) },
      file: { fileUrl: receivedInvoiceFileUrl(name), originalFileName: file.name, mimeType: file.type as CardReceiptSubmit["file"]["mimeType"], ocrText: field(formData, "ocrText").slice(0, 4000) },
      transactionId: field(formData, "transactionId") || undefined };
    const data = await readData();
    // Reject invalid or unauthorized input before storing the file, then recheck inside the write lock.
    submitCardReceipt(structuredClone(data), liveActor(data, user.id), company, input, id);
    await saveReceivedInvoiceFile(name, Buffer.from(await file.arrayBuffer()), file.type);
    const result = await mutateData(user.id, "SUBMIT_CARD_RECEIPT", "CardReceipt", id, (draft) => submitCardReceipt(draft, liveActor(draft, user.id), company, input, id));
    revalidatePath("/expenses/capture"); revalidatePath("/banking");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "保存できませんでした";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
