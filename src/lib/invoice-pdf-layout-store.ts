import { z } from "zod";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { normalizePdfLayout, pdfLayoutSchema } from "@/lib/invoice-pdf-layout";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

// Saving a PDF layout is a presentation change: amounts, lines and `updatedAt` stay as they are,
// so edits already open in a list are not rejected as stale afterwards.
const inputSchema = z.object({ id: z.string().min(1), layout: pdfLayoutSchema });
export type PdfLayoutSave = z.infer<typeof inputSchema>;

function companyProjects(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope) {
  return new Set(visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company).map((p) => p.id));
}

export function applyIssuedInvoicePdfLayout(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, input: PdfLayoutSave) {
  assertCan(user, "manage:issuedInvoices");
  assertCompanyAccess(user, company);
  const { id, layout } = inputSchema.parse(input);
  const invoice = data.issuedInvoices.find((i) => i.id === id && !i.deletedAt && companyProjects(data, user, company).has(i.projectId));
  if (!invoice) throw new Error("請求書が見つかりません");
  if (invoice.fileUrl) throw new Error("取り込んだ原本のレイアウトは変更できません");
  const stored = normalizePdfLayout(layout);
  if (stored) invoice.pdfLayout = stored; else delete invoice.pdfLayout;
  return { id, layout: stored ?? null };
}

export function applyEstimatePdfLayout(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, input: PdfLayoutSave) {
  assertCan(user, "manage:estimates");
  assertCompanyAccess(user, company);
  const { id, layout } = inputSchema.parse(input);
  const estimate = data.estimates.find((e) => e.id === id && !e.deletedAt && companyProjects(data, user, company).has(e.projectId));
  if (!estimate) throw new Error("見積書が見つかりません");
  const stored = normalizePdfLayout(layout);
  if (stored) estimate.pdfLayout = stored; else delete estimate.pdfLayout;
  return { id, layout: stored ?? null };
}
