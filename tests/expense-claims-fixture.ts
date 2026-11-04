import type { ExpenseClaim, User } from "../src/lib/types";
import { fixture, timestamp } from "./document-fixture";

export const expenseAdmin: Pick<User, "id" | "role"> = { id: "admin", role: "ADMIN" };
export const expenseAccountant: Pick<User, "id" | "role"> = { id: "acct", role: "ACCOUNTING" };
export const expenseDesigner: Pick<User, "id" | "role"> = { id: "des", role: "DESIGNER" };
export const expenseManager: Pick<User, "id" | "role"> = { id: "pm", role: "PROJECT_MANAGER" };

export function expensesFixture() {
  const data = fixture(), base = { createdAt: timestamp, updatedAt: timestamp };
  data.appEdition = "JAPAN";
  data.users = [
    { ...base, id: "admin", name: "合成管理者", email: "admin@example.invalid", role: "ADMIN", passwordHash: "unused" },
    { ...base, id: "acct", name: "合成経理", email: "accounting@example.invalid", role: "ACCOUNTING", passwordHash: "unused" },
    { ...base, id: "pm", name: "合成担当", email: "manager@example.invalid", role: "PROJECT_MANAGER", passwordHash: "unused" },
    { ...base, id: "des", name: "合成補助", email: "designer@example.invalid", role: "DESIGNER", passwordHash: "unused" },
  ];
  data.projects = data.projects.filter((row) => row.company === "JAPAN").map((row, index) => ({ ...row, name: `合成案件${index + 1}`, managerId: "pm", memberIds: ["des"] }));
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.clients = data.clients.map((row) => ({ ...row, companyName: "合成依頼主" }));
  data.vendors = data.vendors.map((row) => ({ ...row, companyName: "合成支払先" }));
  data.mailDocuments = data.mailDocuments.map((row) => ({ ...row, title: "合成領収書", senderName: "合成支払先" }));
  data.accountingCategories = [
    { ...base, id: "travel", company: "JAPAN", name: "旅費交通費", group: "EXPENSE", available: true },
    { ...base, id: "supplies", company: "JAPAN", name: "消耗品費", group: "EXPENSE", available: true },
    { ...base, id: "sales", company: "JAPAN", name: "売上高", group: "INCOME", available: true },
  ];
  const claim = (id: string, submittedById: string, status: ExpenseClaim["status"], spentOn: string, amount: number, categoryId: string, pdf = false): ExpenseClaim => {
    const at = `${spentOn}T09:00:00.000Z`;
    const row: ExpenseClaim = { id, company: "JAPAN", submittedById, status, spentOn, amount, categoryId, projectId: "japan", paidWith: "CASH",
      payee: `合成${categoryId === "travel" ? "交通" : "文具"}店`, purpose: "合成案件の打ち合わせ・備品購入", memo: "合成確認用データ",
      fileUrl: `/uploads/received-invoices/${id}.${pdf ? "pdf" : "png"}`, originalFileName: `合成領収書.${pdf ? "pdf" : "png"}`, mimeType: pdf ? "application/pdf" : "image/png",
      createdAt: at, updatedAt: at, history: [{ action: "SUBMIT", at, byId: submittedById }] };
    if (status === "RETURNED") {
      row.reviewNote = "合成用途を詳しく記載してください"; row.reviewedById = "acct"; row.reviewedAt = row.updatedAt = `${spentOn}T10:00:00.000Z`;
      row.history.push({ action: "RETURN", at: row.updatedAt, byId: "acct", note: row.reviewNote });
    }
    if (status === "APPROVED" || status === "PAID") {
      row.reviewedById = "acct"; row.reviewedAt = row.updatedAt = `${spentOn}T10:00:00.000Z`;
      row.history.push({ action: "APPROVE", at: row.updatedAt, byId: "acct" });
    }
    if (status === "PAID") {
      row.paidAt = "2026-10-20"; row.paidById = "acct"; row.paymentMemo = "合成振込済み"; row.updatedAt = "2026-10-20T11:00:00.000Z";
      row.history.push({ action: "PAY", at: row.updatedAt, byId: "acct", note: row.paymentMemo });
    }
    if (status === "WITHDRAWN") {
      row.updatedAt = `${spentOn}T10:00:00.000Z`; row.history.push({ action: "WITHDRAW", at: row.updatedAt, byId: submittedById });
    }
    return row;
  };
  data.expenseClaims = [
    claim("submitted-des", "des", "SUBMITTED", "2026-10-10", 1200, "travel"),
    claim("returned-des", "des", "RETURNED", "2026-09-20", 2400, "supplies", true),
    claim("approved-des", "des", "APPROVED", "2026-10-11", 3600, "travel"),
    claim("approved-pm", "pm", "APPROVED", "2026-09-22", 4500, "supplies"),
    claim("paid-pm", "pm", "PAID", "2026-10-05", 5600, "travel", true),
    claim("withdrawn-pm", "pm", "WITHDRAWN", "2026-09-03", 600, "supplies"),
  ];
  return data;
}
