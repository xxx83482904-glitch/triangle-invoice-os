import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { documentRows } from "@/lib/documents";
import { contentDispositionFileName, readUploadedFile } from "@/lib/files";
import { companyFromParam } from "@/lib/company";
import { buildIssuedInvoicePdf } from "@/lib/issued-invoice-pdf";
import { pdfLayoutFromQuery } from "@/lib/invoice-pdf-layout";
import { issuedInvoicePdfDraft, PdfDraftError, readPdfDraft } from "@/lib/pdf-document-draft";
import { pdfResponseHeaders } from "@/lib/pdf-response";
import { can } from "@/lib/rbac";
import { readData } from "@/lib/store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const data = await readData();
  const invoice = data.issuedInvoices.find((item) => item.id === id && !item.deletedAt);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const company = companyFromParam(data.projects.find((p) => p.id === invoice.projectId)?.company);
  if (user.role === "GUEST" ? invoice.createdById !== user.id : !documentRows(data, user, company).some((r) => r.id === `issued:${id}`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (invoice.fileUrl) {
    const file = await readUploadedFile(invoice.fileUrl);
    if (!file) return NextResponse.json({ error: "Original file not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(file.data), { headers: {
      "Content-Type": file.mimeType, "Content-Disposition": contentDispositionFileName(invoice.originalFileName || "invoice.pdf"),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  }

  try {
    // Layout keys in the query (from the preview dialog) win over the layout saved on the invoice.
    const result = await buildIssuedInvoicePdf(invoice, data, pdfLayoutFromQuery(new URL(request.url).searchParams));
    return new NextResponse(new Uint8Array(result.pdf), { headers: pdfResponseHeaders(`${invoice.invoiceNumber}.pdf`, result) });
  } catch {
    return NextResponse.json({ error: "請求書PDFの生成に失敗しました。再読み込みしてください" }, { status: 500 });
  }
}

// Unsaved edits from the PDF dialog: same builder as the download, and nothing is stored.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  if (!can(user, "manage:issuedInvoices")) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const { id } = await params;
  const data = await readData();
  const invoice = data.issuedInvoices.find((item) => item.id === id && !item.deletedAt);
  if (!invoice) return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });
  const company = companyFromParam(data.projects.find((p) => p.id === invoice.projectId)?.company);
  if (!documentRows(data, user, company).some((r) => r.id === `issued:${id}`)) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  if (invoice.fileUrl) return NextResponse.json({ error: "取り込んだ原本の内容は変更できません" }, { status: 409 });
  try {
    const draft = await readPdfDraft(request);
    const next = issuedInvoicePdfDraft(invoice, data, draft);
    const result = await buildIssuedInvoicePdf(next.invoice, next.data, draft.layout);
    return new NextResponse(new Uint8Array(result.pdf), { headers: pdfResponseHeaders(`${next.invoice.invoiceNumber}.pdf`, result) });
  } catch (error) {
    if (error instanceof PdfDraftError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "請求書PDFの生成に失敗しました。再読み込みしてください" }, { status: 500 });
  }
}
