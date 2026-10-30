import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { can, canAccessCompany } from "@/lib/rbac";
import { receivedAmountsFromForm, validateReceivedAmounts, validateReceivedDates } from "@/lib/received-invoice-review";
import type { AppData, User } from "@/lib/types";

export function applyReceivedInvoiceFields(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, id: string, form: FormData) {
  if (!can(user, "manage:receivedInvoices") || !canAccessCompany(user, company)) throw new Error("権限がありません。");
  const invoice = data.receivedInvoices.find((item) => item.id === id && !item.deletedAt);
  const projects = visibleProjects(data, user).filter((project) => companyFromParam(project.company) === company);
  if (!invoice || !projects.some((project) => project.id === invoice.projectId)) throw new Error("受領請求書が見つかりません。");
  const field = (key: string) => String(form.get(key) ?? "").trim();
  if (!field("expectedUpdatedAt") || field("expectedUpdatedAt") !== invoice.updatedAt) throw new Error("他の更新があります。再読み込みして確認してください。");
  const project = projects.find((item) => item.id === field("projectId"));
  const vendor = data.vendors.find((item) => item.id === field("vendorId") && !item.deletedAt && partnerMatchesCompany(item, company));
  if (!project || !vendor) throw new Error("案件と請求元を確認してください。");
  validateReceivedDates(field("issueDate"), field("dueDate"));
  const paid = data.payments.filter((payment) => !payment.deletedAt && payment.type === "EXPENSE" && payment.receivedInvoiceId === id).reduce((sum, payment) => sum + payment.amount, 0);
  const amounts = validateReceivedAmounts(receivedAmountsFromForm(form, invoice), paid);
  // Validate every field before touching the invoice or related payment records.
  Object.assign(invoice, amounts, { projectId: project.id, vendorId: vendor.id,
    issueDate: field("issueDate"), dueDate: field("dueDate"), memo: field("memo") || undefined });
  return invoice;
}
