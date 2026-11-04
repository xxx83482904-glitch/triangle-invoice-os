import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { mailSorterCompany } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize } from "@/lib/files";
import { intakeMailDocument, type MailSortResult } from "@/lib/mail-intake";
import { extractDocumentText } from "@/lib/ocr";
import { can } from "@/lib/rbac";

export async function POST(request: Request) {
  const user = await requireUser();
  if (!can(user, "manage:mailSorter") && !can(user, "manage:receivedInvoices") && !can(user, "upload:receivedInvoices")) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const formData = await request.formData();
  const company = mailSorterCompany;
  const targetMonthValue = formData.get("targetMonth");
  const targetMonth = typeof targetMonthValue === "string" && targetMonthValue.trim() ? targetMonthValue.trim() : undefined;
  if (targetMonth && !/^\d{4}-\d{2}$/.test(targetMonth)) {
    return NextResponse.json({ error: "収納先の月が正しくありません" }, { status: 400 });
  }
  const files = formData.getAll("files").filter((file): file is File => file instanceof File);
  if (!files.length) return NextResponse.json({ error: "ファイルをドロップしてください" }, { status: 400 });

  const results: MailSortResult[] = [];

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
    const { mailDocumentId, receivedInvoiceId, ...result } = await intakeMailDocument({ user, company, fileName: file.name, mimeType: file.type, buffer, extracted, targetMonth });
    void mailDocumentId; void receivedInvoiceId;
    results.push(result);
  }

  return NextResponse.json({ results });
}
