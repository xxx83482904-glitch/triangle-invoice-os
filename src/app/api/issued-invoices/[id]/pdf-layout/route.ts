import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { documentRows } from "@/lib/documents";
import { pdfLayoutMeta } from "@/lib/pdf-layout-meta";
import { readData } from "@/lib/store";

// What the layout dialog needs before it shows a generated invoice: the saved layout and the line labels.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください" }, { status: 401 });
  const { id } = await params;
  const data = await readData();
  const invoice = data.issuedInvoices.find((item) => item.id === id && !item.deletedAt);
  if (!invoice) return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });
  const company = companyFromParam(data.projects.find((p) => p.id === invoice.projectId)?.company);
  if (user.role === "GUEST" ? invoice.createdById !== user.id : !documentRows(data, user, company).some((r) => r.id === `issued:${id}`)) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
  if (invoice.fileUrl) return NextResponse.json({ error: "取り込んだ原本にはレイアウト調整がありません" }, { status: 409 });
  const items = data.issuedInvoiceItems.filter((item) => item.invoiceId === invoice.id);
  return NextResponse.json(pdfLayoutMeta(invoice, items, Boolean(invoice.notes?.trim())), { headers: { "Cache-Control": "private, no-store" } });
}
