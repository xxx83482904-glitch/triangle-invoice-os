import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requireUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { allowedUploadTypes, maxUploadSize } from "@/lib/files";
import { intakeImportDocument, type ImportIntakeResult } from "@/lib/import-intake";
import { importDocumentKinds } from "@/lib/import-shipments";
import { extractDocumentText } from "@/lib/ocr";
import { assertCompanyAccess, can } from "@/lib/rbac";

function message(error: unknown) {
  return error instanceof ZodError ? error.issues[0]?.message || "入力内容を確認してください"
    : error instanceof Error ? error.message : "輸入書類を取り込めませんでした";
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!can(user, "manage:imports")) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  try {
    const form = await request.formData();
    const company = companyFromParam(String(form.get("company") ?? ""));
    assertCompanyAccess(user, company);
    const shipmentId = z.string().trim().min(1).max(1000).optional().parse(form.get("shipmentId") || undefined);
    const kind = z.enum(importDocumentKinds).optional().parse(form.get("kind") || undefined);
    const files = form.getAll("files").filter((file): file is File => file instanceof File);
    if (!files.length) return NextResponse.json({ error: "ファイルをドロップしてください" }, { status: 400 });
    const results: ImportIntakeResult[] = [];
    for (const file of files) {
      try {
        if (!allowedUploadTypes.has(file.type)) throw new Error("PDF、JPEG、PNGのみ対応しています");
        if (file.size > maxUploadSize) throw new Error("10MBを超えるファイルは登録できません");
        const buffer = Buffer.from(await file.arrayBuffer());
        const extracted = await extractDocumentText(file.name, file.type, buffer);
        results.push(await intakeImportDocument({ user, company, fileName: file.name, mimeType: file.type, buffer, extracted, shipmentId, kind }));
      } catch (error) {
        results.push({ fileName: file.name, kind: kind ?? "OTHER", filled: [], error: message(error) });
      }
    }
    for (const path of ["/imports", "/mail-sorter", "/received-invoices", "/documents", "/reports"]) revalidatePath(path);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}
