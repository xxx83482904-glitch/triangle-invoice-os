import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { expenseReceiptFallback } from "@/lib/expense-claim-edits";
import { allowedUploadTypes, maxUploadSize } from "@/lib/files";
import { extractDocumentText, inferReceivedInvoice } from "@/lib/ocr";
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
    const data = await readData();
    const extracted = await extractDocumentText(file.name, file.type, Buffer.from(await file.arrayBuffer()));
    const inferred = inferReceivedInvoice(data, extracted, company), fallback = expenseReceiptFallback(extracted.text);
    return NextResponse.json({ spentOn: inferred.issueDate || fallback.spentOn, amount: inferred.total || fallback.amount || null,
      payee: inferred.vendorName === "支払先確認待ち" ? "" : inferred.vendorName, ocrText: extracted.text.slice(0, 4000), warnings: inferred.warnings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "領収書を読み取れませんでした。手入力で続けられます。" }, { status: 400 });
  }
}
