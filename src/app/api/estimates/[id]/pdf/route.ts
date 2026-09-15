import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { documentRows } from "@/lib/documents";
import { contentDispositionFileName } from "@/lib/files";
import { createEstimatePdf } from "@/lib/issued-invoice-pdf";
import { readData } from "@/lib/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  const { id } = await params;
  const data = await readData();
  const estimate = data.estimates.find((e) => e.id === id && !e.deletedAt);
  if (!estimate) return NextResponse.json({ error: "見積書が見つかりません" }, { status: 404 });
  const company = companyFromParam(data.projects.find((p) => p.id === estimate.projectId)?.company);
  if (!documentRows(data, user, company).some((r) => r.id === `estimate:${id}`)) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  try {
    const pdf = await createEstimatePdf(estimate, data);
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionFileName(`${estimate.estimateNumber}.pdf`), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "見積書PDFの生成に失敗しました" }, { status: 500 }); }
}
