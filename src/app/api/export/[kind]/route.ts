import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { companyFromParam, matchesCompany } from "@/lib/company";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/rbac";
import { projectMoney, readData } from "@/lib/store";

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await requireUser();
  if (!can(user, "export:csv")) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }
  const { kind } = await params;
  const data = await readData();
  const company = companyFromParam(new URL(request.url).searchParams.get("company"));
  const projects = data.projects.filter((project) => !project.deletedAt && matchesCompany(project, company));
  const projectIds = new Set(projects.map((project) => project.id));

  let body = "";
  if (kind === "issued-invoices") {
    body = csv([
      ["請求書番号", "発行日", "支払期限", "クライアント", "案件", "税抜", "消費税", "税込", "ステータス"],
      ...data.issuedInvoices
        .filter((item) => !item.deletedAt && projectIds.has(item.projectId))
        .map((invoice) => [
          invoice.invoiceNumber,
          formatDate(invoice.issueDate),
          formatDate(invoice.dueDate),
          data.clients.find((client) => client.id === invoice.clientId)?.companyName,
          data.projects.find((project) => project.id === invoice.projectId)?.name,
          invoice.subtotal,
          invoice.taxTotal,
          invoice.total,
          invoice.status,
        ]),
    ]);
  } else if (kind === "received-invoices") {
    body = csv([
      ["請求元", "案件", "請求日", "支払期限", "税抜", "消費税", "税込", "ステータス"],
      ...data.receivedInvoices
        .filter((item) => !item.deletedAt && projectIds.has(item.projectId))
        .map((invoice) => [
          data.vendors.find((vendor) => vendor.id === invoice.vendorId)?.companyName,
          data.projects.find((project) => project.id === invoice.projectId)?.name,
          formatDate(invoice.issueDate),
          formatDate(invoice.dueDate),
          invoice.subtotal,
          invoice.taxTotal,
          invoice.total,
          invoice.status,
        ]),
    ]);
  } else {
    body = csv([
      ["案件", "契約金額", "請求済み", "入金済み", "未入金", "受領請求書合計", "支払い済み", "未払い", "粗利", "粗利率"],
      ...projects
        .map((project) => {
          const money = projectMoney(data, project.id);
          return [
            project.name,
            money.contractAmount,
            money.invoicedAmount,
            money.paidIncomeAmount,
            money.unpaidIncomeAmount,
            money.receivedInvoiceTotal,
            money.paidExpenseAmount,
            money.unpaidExpenseAmount,
            money.grossProfit,
            money.grossProfitRate,
          ];
        }),
    ]);
  }

  return new NextResponse(`\uFEFF${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}.csv"`,
    },
  });
}
