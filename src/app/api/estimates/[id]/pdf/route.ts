import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { documentRows } from "@/lib/documents";
import { buildEstimatePdf } from "@/lib/issued-invoice-pdf";
import { pdfLayoutFromQuery } from "@/lib/invoice-pdf-layout";
import { estimatePdfDraft, PdfDraftError, readPdfDraft } from "@/lib/pdf-document-draft";
import { pdfResponseHeaders } from "@/lib/pdf-response";
import { can } from "@/lib/rbac";
import { readData } from "@/lib/store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  const { id } = await params;
  const data = await readData();
  const estimate = data.estimates.find((e) => e.id === id && !e.deletedAt);
  if (!estimate) return NextResponse.json({ error: "見積書が見つかりません" }, { status: 404 });
  const company = companyFromParam(data.projects.find((p) => p.id === estimate.projectId)?.company);
  if (!documentRows(data, user, company).some((r) => r.id === `estimate:${id}` && !r.amountsHidden)) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  try {
    // Layout keys in the query (from the preview dialog) win over the layout saved on the estimate.
    const result = await buildEstimatePdf(estimate, data, pdfLayoutFromQuery(new URL(request.url).searchParams));
    return new NextResponse(new Uint8Array(result.pdf), { headers: pdfResponseHeaders(`${estimate.estimateNumber}.pdf`, result) });
  } catch { return NextResponse.json({ error: "見積書PDFの生成に失敗しました" }, { status: 500 }); }
}

// Unsaved edits from the PDF dialog: same builder as the download, and nothing is stored.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  if (!can(user, "manage:estimates")) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  const { id } = await params;
  const data = await readData();
  const estimate = data.estimates.find((e) => e.id === id && !e.deletedAt);
  if (!estimate) return NextResponse.json({ error: "見積書が見つかりません" }, { status: 404 });
  const company = companyFromParam(data.projects.find((p) => p.id === estimate.projectId)?.company);
  if (!documentRows(data, user, company).some((r) => r.id === `estimate:${id}` && !r.amountsHidden)) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  try {
    const draft = await readPdfDraft(request);
    const next = estimatePdfDraft(estimate, data, draft);
    const result = await buildEstimatePdf(next, data, draft.layout);
    return new NextResponse(new Uint8Array(result.pdf), { headers: pdfResponseHeaders(`${next.estimateNumber}.pdf`, result) });
  } catch (error) {
    if (error instanceof PdfDraftError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "見積書PDFの生成に失敗しました" }, { status: 500 });
  }
}
