import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { documentRows } from "@/lib/documents";
import { contentDispositionFileName, readUploadedFile } from "@/lib/files";
import { companyFromParam } from "@/lib/company";
import { buildIssuedInvoicePdf } from "@/lib/issued-invoice-pdf";
import { pdfLayoutFromQuery } from "@/lib/invoice-pdf-layout";
import { pdfResponseHeaders } from "@/lib/pdf-response";
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
