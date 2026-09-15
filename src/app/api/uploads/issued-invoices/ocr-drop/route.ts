import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { allowedUploadTypes, deleteReceivedInvoiceFile, maxUploadSize, readableUploadFileName, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { extractDocumentText, inferIssuedInvoiceWithAi } from "@/lib/ocr";
import { can } from "@/lib/rbac";
import { mutateData, newId, readData } from "@/lib/store";
import type { IssuedInvoice } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  if (!can(user, "manage:issuedInvoices")) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const form = await request.formData();
  const company = companyFromParam(String(form.get("company") || ""));
  const projectId = String(form.get("projectId") || "");
  const data = await readData();
  const project = visibleProjects(data, user).find((p) => p.id === projectId && companyFromParam(p.company) === company);
  if (!project) return NextResponse.json({ error: "取込先の案件を選択してください" }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length || files.length > 20) return NextResponse.json({ error: "1回に1〜20件を選択してください" }, { status: 400 });
  const results = [];
  for (const file of files) {
    let savedName: string | undefined;
    try {
      const extension = allowedUploadTypes.get(file.type);
      if (!extension || !file.size || file.size > maxUploadSize) throw new Error("PDF・JPEG・PNG、1件10MB以内のファイルを選択してください");
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileHash = createHash("sha256").update(buffer).digest("hex");
      const current = await readData();
      const companyIds = new Set(current.projects.filter((p) => companyFromParam(p.company) === company).map((p) => p.id));
      if (current.issuedInvoices.some((i) => !i.deletedAt && companyIds.has(i.projectId) && i.fileHash === fileHash)) {
        results.push({ fileName: file.name, duplicate: true, error: "同じファイルは登録済みです" });
        continue;
      }
      const extracted = await extractDocumentText(file.name, file.type, buffer);
      const inferred = await inferIssuedInvoiceWithAi(extracted);
      const id = newId();
      const timestamp = new Date().toISOString();
      savedName = readableUploadFileName({ date: inferred.issueDate, extension, id, senderName: "issued" });
      await saveReceivedInvoiceFile(savedName, buffer, file.type);
      const invoice: IssuedInvoice = {
        id, projectId, clientId: project.clientId, invoiceNumber: inferred.invoiceNumber || `OCR-${id.slice(0, 8)}`,
        issueDate: inferred.issueDate, dueDate: inferred.dueDate, transactionDate: inferred.issueDate,
        subtotal: inferred.total, taxTotal: 0, total: inferred.total, status: "DRAFT", needsReview: true,
        fileUrl: receivedInvoiceFileUrl(savedName), fileHash, originalFileName: file.name, mimeType: file.type,
        ocrText: extracted.text, ocrConfidence: inferred.confidence, ocrWarnings: inferred.warnings, ocrClientName: inferred.clientName,
        createdById: user.id, createdAt: timestamp, updatedAt: timestamp,
      };
      await mutateData(user.id, "OCR_DROP_ISSUED_INVOICE", "IssuedInvoice", id, (draft) => {
        const allowed = visibleProjects(draft, user).find((p) => p.id === projectId && companyFromParam(p.company) === company);
        if (!allowed) throw new Error("案件の権限が変更されました");
        invoice.clientId = allowed.clientId;
        const draftCompanyIds = new Set(draft.projects.filter((p) => companyFromParam(p.company) === company).map((p) => p.id));
        if (draft.issuedInvoices.some((i) => !i.deletedAt && draftCompanyIds.has(i.projectId) && (i.fileHash === fileHash || i.invoiceNumber === invoice.invoiceNumber))) {
          throw new Error("同じファイルまたは請求書番号が登録済みです");
        }
        draft.issuedInvoices.unshift(invoice);
        draft.attachments.unshift({ id: newId(), relatedType: "IssuedInvoice", relatedId: id, fileUrl: invoice.fileUrl!, fileName: file.name,
          mimeType: file.type, uploadedById: user.id, createdAt: timestamp });
        return { id, invoiceNumber: invoice.invoiceNumber };
      });
      savedName = undefined;
      results.push({ fileName: file.name, id, confidence: inferred.confidence, warnings: inferred.warnings });
    } catch (error) {
      if (savedName) await deleteReceivedInvoiceFile(savedName).catch(() => undefined);
      results.push({ fileName: file.name, error: error instanceof Error ? error.message : "取込に失敗しました" });
    }
  }
  revalidatePath("/issued-invoices");
  revalidatePath("/documents");
  return NextResponse.json({ results });
}
