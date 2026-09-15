import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { documentOcrText, documentRows } from "@/lib/documents";
import { readData } from "@/lib/store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  const { id } = await params;
  const company = companyFromParam(new URL(request.url).searchParams.get("company"));
  const data = await readData();
  const row = documentRows(data, user, company).find((r) => r.id === id);
  if (!row) return NextResponse.json({ error: "書類が見つかりません" }, { status: 404 });
  const invoice = row.kind === "issued" ? data.issuedInvoices.find((i) => i.id === row.sourceId) : undefined;
  return NextResponse.json({ ocrText: documentOcrText(data, row), warnings: invoice?.ocrWarnings ?? [], clientName: invoice?.ocrClientName ?? "", memo: invoice?.internalMemo ?? "" },
    { headers: { "Cache-Control": "private, no-store" } });
}
