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

function memoValue(memo: string | undefined, label: string) {
  const prefix = `${label}:`;
  return (
    memo
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() ?? ""
  );
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
  } else if (kind === "ocr-documents") {
    const searchParams = new URL(request.url).searchParams;
    const selectedIds = new Set(
      (searchParams.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const linkedReceivedInvoiceIds = new Set(
      data.mailDocuments.map((document) => document.relatedReceivedInvoiceId).filter((id): id is string => Boolean(id)),
    );
    const rows = [
      ...data.mailDocuments
        .filter((document) => !document.deletedAt && companyFromParam(document.company) === company)
        .map((document) => {
          const invoice = document.relatedReceivedInvoiceId ? data.receivedInvoices.find((item) => item.id === document.relatedReceivedInvoiceId) : undefined;
          const vendor = invoice ? data.vendors.find((item) => item.id === invoice.vendorId) : undefined;
          const project = invoice ? data.projects.find((item) => item.id === invoice.projectId) : undefined;
          return {
            amount: memoValue(document.memo, "金額") || invoice?.total || "",
            category: document.category,
            content: memoValue(document.memo, "内容"),
            dueDate: invoice?.dueDate ?? "",
            fileName: document.originalFileName,
            fileUrl: document.fileUrl,
            id: `mail-${document.id}`,
            issueDate: invoice?.issueDate ?? "",
            memo: document.memo ?? "",
            paymentDestination: memoValue(document.memo, "振込先"),
            projectName: project?.name ?? "",
            savedAs: invoice ? "受領請求書" : "その他書類",
            senderName: document.senderName || vendor?.companyName || memoValue(document.memo, "発送元"),
            status: invoice?.status ?? "",
          };
        }),
      ...data.receivedInvoices
        .filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId) && invoice.ocrText && !linkedReceivedInvoiceIds.has(invoice.id))
        .map((invoice) => {
          const vendor = data.vendors.find((item) => item.id === invoice.vendorId);
          const project = data.projects.find((item) => item.id === invoice.projectId);
          return {
            amount: invoice.total,
            category: "INVOICE",
            content: memoValue(invoice.memo, "内容"),
            dueDate: invoice.dueDate,
            fileName: invoice.originalFileName ?? "",
            fileUrl: invoice.fileUrl ?? "",
            id: `invoice-${invoice.id}`,
            issueDate: invoice.issueDate,
            memo: invoice.memo ?? "",
            paymentDestination: memoValue(invoice.memo, "振込先"),
            projectName: project?.name ?? "",
            savedAs: "受領請求書",
            senderName: vendor?.companyName || memoValue(invoice.memo, "発送元"),
            status: invoice.status,
          };
        }),
    ].filter((row) => !selectedIds.size || selectedIds.has(row.id));
    body = csv([
      ["ID", "発送元", "分類", "保存先", "内容", "金額", "振込先", "請求日", "支払期限", "案件", "ステータス", "ファイル名", "ファイルURL", "メモ"],
      ...rows.map((row) => [
        row.id,
        row.senderName,
        row.category,
        row.savedAs,
        row.content,
        row.amount,
        row.paymentDestination,
        row.issueDate ? formatDate(row.issueDate) : "",
        row.dueDate ? formatDate(row.dueDate) : "",
        row.projectName,
        row.status,
        row.fileName,
        row.fileUrl,
        row.memo,
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
