import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { bankToday } from "@/lib/banking";
import { companyFromParam } from "@/lib/company";
import { readExpenseReceipt } from "@/lib/expense-receipt-reading";
import { allowedUploadTypes, maxUploadSize } from "@/lib/files";
import { assertCompanyAccess, can } from "@/lib/rbac";
import { readData } from "@/lib/store";

export async function POST(request: Request) {
  const user = await requireUser();
  if (!can(user, "submit:expenses")) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  try {
    const formData = await request.formData(), company = companyFromParam(String(formData.get("company") ?? ""));
    assertCompanyAccess(user, company);
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("領収書の写真かPDFを選択してください");
    if (!allowedUploadTypes.has(file.type)) throw new Error("PDF、JPEG、PNGのみアップロードできます");
    if (file.size > maxUploadSize) throw new Error("ファイルサイズは10MB以内にしてください");
    const reading = await readExpenseReceipt(await readData(), user, company, { name: file.name, type: file.type, buffer: Buffer.from(await file.arrayBuffer()) }, bankToday());
    return NextResponse.json(reading);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "領収書を読み取れませんでした。手入力で続けられます。" }, { status: 400 });
  }
}
