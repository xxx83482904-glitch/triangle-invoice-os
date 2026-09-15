import { z } from "zod";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

export type IssuedDelete = { id: string; updatedAt: string };
const schema = z.array(z.object({ id: z.string().min(1), updatedAt: z.string().min(1) })).min(1).max(500);

export function applyIssuedInvoiceDeletion(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, input: IssuedDelete[]) {
  assertCan(user, "manage:issuedInvoices");
  assertCompanyAccess(user, company);
  const requested = schema.parse(input);
  const projects = new Set(visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company).map((p) => p.id));
  const ids = new Set(requested.map((i) => i.id));
  if (ids.size !== requested.length) throw new Error("同じ請求書が重複しています");
  // Validate the whole batch before changing anything, including payment and version checks.
  const invoices = requested.map((target) => {
    const invoice = data.issuedInvoices.find((i) => i.id === target.id && !i.deletedAt && projects.has(i.projectId));
    if (!invoice) throw new Error("削除できない請求書が含まれています");
    if (invoice.updatedAt !== target.updatedAt) throw new Error("他の操作で更新されています。再読み込みして確認してください");
    if (["PAID", "PARTIALLY_PAID"].includes(invoice.status) || invoice.paidAt || data.payments.some((p) => !p.deletedAt && p.issuedInvoiceId === invoice.id)) {
      throw new Error("入金記録のある請求書は削除できません。管理者に確認してください");
    }
    return invoice;
  });
  const timestamp = new Date().toISOString();
  for (const invoice of invoices) { invoice.deletedAt = timestamp; invoice.updatedAt = timestamp; }
  // Keep items and original files for audit/undo; deleted parents hide attachments and downloads.
  return { ids: [...ids] };
}
