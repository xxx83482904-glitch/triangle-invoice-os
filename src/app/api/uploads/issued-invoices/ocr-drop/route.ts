import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { allowedUploadTypes, deleteReceivedInvoiceFile, maxUploadSize, readableUploadFileName, receivedInvoiceFileUrl, saveReceivedInvoiceFile } from "@/lib/files";
import { extractDocumentText, inferIssuedInvoiceWithAi } from "@/lib/ocr";
import { can, canAccessCompany } from "@/lib/rbac";
import { resolveIssuedImportProject } from "@/lib/issued-import-project";
import { mutateData, newId, readData } from "@/lib/store";
import type { IssuedInvoice } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  if (!can(user, "manage:issuedInvoices")) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const form = await request.formData();
  if (!["JAPAN", "CHINA"].includes(String(form.get("company")))) return NextResponse.json({ error: "取込先の会社を指定してください" }, { status: 400 });
  const company = companyFromParam(String(form.get("company") || ""));
  if (!canAccessCompany(user, company)) return NextResponse.json({ error: "日本の請求書のみ取り込めます" }, { status: 403 });
  const projectId = String(form.get("projectId") || "");
  const data = await readData();
  const project = visibleProjects(data, user).find((p) => p.id === projectId && companyFromParam(p.company) === company);
  if (projectId && !project) return NextResponse.json({ error: "指定した案件に取り込む権限がありません" }, { status: 400 });
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
        id, projectId, clientId: "", invoiceNumber: inferred.invoiceNumber || `OCR-${id.slice(0, 8)}`,
        issueDate: inferred.issueDate, dueDate: inferred.dueDate, transactionDate: inferred.issueDate,
        subtotal: inferred.total, taxTotal: 0, total: inferred.total, status: "DRAFT", needsReview: true,
        fileUrl: receivedInvoiceFileUrl(savedName), fileHash, originalFileName: file.name, mimeType: file.type,
        ocrText: extracted.text, ocrConfidence: inferred.confidence, ocrWarnings: inferred.warnings, ocrClientName: inferred.clientName,
        createdById: user.id, createdAt: timestamp, updatedAt: timestamp,
      };
      const result = await mutateData(user.id, "OCR_DROP_ISSUED_INVOICE", "IssuedInvoice", id, (draft) => {
        const draftCompanyIds = new Set(draft.projects.filter((p) => companyFromParam(p.company) === company).map((p) => p.id));
        if (draft.issuedInvoices.some((i) => !i.deletedAt && draftCompanyIds.has(i.projectId) && (i.fileHash === fileHash || i.invoiceNumber === invoice.invoiceNumber))) {
          throw new Error("同じファイルまたは請求書番号が登録済みです");
        }
        const resolved = resolveIssuedImportProject(draft, user, company, projectId,
          { projectName: inferred.projectName, clientName: inferred.clientName, text: extracted.text, fileName: file.name });
        invoice.projectId = resolved.project.id;
        invoice.clientId = resolved.project.clientId;
        invoice.ocrWarnings = [...inferred.warnings, ...resolved.warnings];
        draft.issuedInvoices.unshift(invoice);
        draft.attachments.unshift({ id: newId(), relatedType: "IssuedInvoice", relatedId: id, fileUrl: invoice.fileUrl!, fileName: file.name,
          mimeType: file.type, uploadedById: user.id, createdAt: timestamp });
        return { id, invoiceNumber: invoice.invoiceNumber, projectId: resolved.project.id, projectName: resolved.project.name,
          projectCreated: resolved.projectCreated, projectMatch: resolved.projectMatch, warnings: invoice.ocrWarnings };
      });
      savedName = undefined;
      results.push({ fileName: file.name, ...result, confidence: inferred.confidence });
    } catch (error) {
      if (savedName) await deleteReceivedInvoiceFile(savedName).catch(() => undefined);
      results.push({ fileName: file.name, error: error instanceof Error ? error.message : "取込に失敗しました" });
    }
  }
  revalidatePath("/issued-invoices");
  revalidatePath("/documents");
  revalidatePath("/projects");
  revalidatePath("/partners");
  revalidatePath("/dashboard");
  return NextResponse.json({ results });
}
