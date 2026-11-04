import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { documentRows } from "@/lib/documents";
import { pdfLayoutMeta } from "@/lib/pdf-layout-meta";
import { readData } from "@/lib/store";

// What the layout dialog needs before it shows an estimate: the saved layout and the line labels.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  const { id } = await params;
  const data = await readData();
  const estimate = data.estimates.find((e) => e.id === id && !e.deletedAt);
  if (!estimate) return NextResponse.json({ error: "見積書が見つかりません" }, { status: 404 });
  const company = companyFromParam(data.projects.find((p) => p.id === estimate.projectId)?.company);
  if (!documentRows(data, user, company).some((r) => r.id === `estimate:${id}`)) return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  return NextResponse.json(pdfLayoutMeta(estimate, estimate.items, Boolean(estimate.notes?.trim())), { headers: { "Cache-Control": "private, no-store" } });
}
