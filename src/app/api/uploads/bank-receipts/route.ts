import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { addBankReceipt, assertBankReceiptAllowed } from "@/lib/bank-receipts";
import { companyFromParam } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize, readableUploadFileName, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { mutateData, newId, readData } from "@/lib/store";
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

export async function POST(request: Request) {
  const user = await requireUser();
  try {
    const formData = await request.formData(), company = companyFromParam(field(formData, "company"));
    const transactionId = field(formData, "transactionId"), upload = formData.get("file");
    if (!(upload instanceof File) || !upload.name) return NextResponse.json({ error: "領収書の写真かPDFを選択してください" }, { status: 400 });
    const extension = allowedUploadTypes.get(upload.type);
    if (!extension) throw new Error("PDF、JPEG、PNGのみ添付できます");
    if (!upload.size) throw new Error("空のファイルは添付できません");
    if (upload.size > maxUploadSize) throw new Error("ファイルサイズは10MB以内にしてください");
    const data = await readData();
    // Reject unauthorized or invalid input before storing bytes, then recheck inside the write lock.
    assertBankReceiptAllowed(data, liveActor(data, user.id), company, { transactionId, mimeType: upload.type });
    const transaction = data.bankTransactions.find((row) => row.id === transactionId)!;
    const id = newId();
    const name = readableUploadFileName({ date: transaction.transactionDate, extension, id, senderName: `bank-receipt_${transaction.content || ""}` });
    await saveReceivedInvoiceFile(name, Buffer.from(await upload.arrayBuffer()), upload.type);
    const input = { transactionId, fileUrl: receivedInvoiceFileUrl(name), fileName: upload.name, mimeType: upload.type };
    await mutateData(user.id, "BANK_RECEIPT_UPLOAD", "Attachment", id, (draft) => addBankReceipt(draft, liveActor(draft, user.id), company, input, id));
    revalidatePath("/banking");
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "添付できませんでした" }, { status: 400 });
  }
}
