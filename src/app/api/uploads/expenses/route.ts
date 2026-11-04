import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { applyExpenseMutation, type ExpenseMutation } from "@/lib/expense-claim-edits";
import { allowedUploadTypes, maxUploadSize, readableUploadFileName, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { can } from "@/lib/rbac";
import { mutateData, readData } from "@/lib/store";
import { isActiveUser } from "@/lib/user-access";
import type { AppData, ExpensePaidWith } from "@/lib/types";

type ExpenseFile = NonNullable<Extract<ExpenseMutation, { action: "submit" }>["file"]>;

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
  if (!can(user, "submit:expenses")) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  try {
    const formData = await request.formData(), company = companyFromParam(field(formData, "company"));
    const claimId = field(formData, "claimId"), version = field(formData, "version");
    if (Boolean(claimId) !== Boolean(version)) throw new Error("申請と更新情報を確認してください");
    const upload = formData.get("file"), file = upload instanceof File && upload.name ? upload : undefined;
    if (!claimId && (!file || !file.size)) return NextResponse.json({ error: "領収書の写真かPDFを添付してください" }, { status: 400 });
    const extension = file ? allowedUploadTypes.get(file.type) : undefined;
    if (file && !extension) throw new Error("PDF、JPEG、PNGのみアップロードできます");
    if (file && file.size > maxUploadSize) throw new Error("ファイルサイズは10MB以内にしてください");
    if (file && !file.size) throw new Error("空のファイルは添付できません");
    const id = claimId || globalThis.crypto.randomUUID();
    const spentOn = field(formData, "spentOn"), payee = field(formData, "payee");
    // A replacement gets its own name so the previous receipt is never overwritten.
    const name = file && extension ? readableUploadFileName({ date: spentOn, extension, id: claimId ? globalThis.crypto.randomUUID() : id, senderName: payee }) : undefined;
    const contents = { spentOn, amount: Number(field(formData, "amount")), payee, purpose: field(formData, "purpose"),
      categoryId: field(formData, "categoryId") || undefined, projectId: field(formData, "projectId") || undefined,
      paidWith: (field(formData, "paidWith") || undefined) as ExpensePaidWith | undefined, memo: field(formData, "memo"),
      ...(file && name ? { file: { fileUrl: receivedInvoiceFileUrl(name), originalFileName: file.name, mimeType: file.type as ExpenseFile["mimeType"], ocrText: field(formData, "ocrText") } } : {}) };
    const input: ExpenseMutation = claimId ? { action: "update", id, version, ...contents } : { action: "submit", ...contents };
    const data = await readData();
    // Reject invalid or unauthorized input before storing a file, then recheck inside the write lock.
    applyExpenseMutation(structuredClone(data), liveActor(data, user.id), company, input, id);
    if (file && name) await saveReceivedInvoiceFile(name, Buffer.from(await file.arrayBuffer()), file.type);
    const result = await mutateData(user.id, claimId ? "UPDATE_EXPENSE_CLAIM" : "SUBMIT_EXPENSE_CLAIM", "ExpenseClaim", id,
      (draft) => applyExpenseMutation(draft, liveActor(draft, user.id), company, input, id));
    revalidatePath("/expenses"); revalidatePath("/dashboard");
    return NextResponse.json({ id, updatedAt: result.updatedAt });
  } catch (error) {
    const message = error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください" : error instanceof Error ? error.message : "保存できませんでした";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
