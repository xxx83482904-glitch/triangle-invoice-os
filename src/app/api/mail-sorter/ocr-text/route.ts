import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, mailSorterCompany } from "@/lib/company";
import { can } from "@/lib/rbac";
import { readDataForRequest as readData } from "@/lib/store";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "view:mailSorter")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const mailDocumentId = searchParams.get("mailDocumentId");
  const receivedInvoiceId = searchParams.get("receivedInvoiceId");
  if (!mailDocumentId && !receivedInvoiceId) {
    return NextResponse.json({ error: "Document id is required" }, { status: 400 });
  }

  const data = await readData();
  let ocrText = "";

  if (mailDocumentId) {
    const document = data.mailDocuments.find(
      (item) =>
        item.id === mailDocumentId &&
        !item.deletedAt &&
        companyFromParam(item.company) === mailSorterCompany,
    );
    ocrText = document?.ocrText ?? "";
  } else if (receivedInvoiceId) {
    const japanProjectIds = new Set(
      data.projects
        .filter((project) => !project.deletedAt && companyFromParam(project.company) === mailSorterCompany)
        .map((project) => project.id),
    );
    const invoice = data.receivedInvoices.find(
      (item) => item.id === receivedInvoiceId && !item.deletedAt && japanProjectIds.has(item.projectId),
    );
    ocrText = invoice?.ocrText ?? "";
  }

  return NextResponse.json(
    { ocrText },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
