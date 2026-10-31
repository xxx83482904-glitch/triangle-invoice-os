import { z } from "zod";
import type { AppData, DebtRole, ReceivedInvoice, User } from "@/lib/types";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { can, canAccessCompany } from "@/lib/rbac";

// A debt group bundles the paper trail of one debt: 請求書 → 再請求 → 督促 → 領収書 (and 合計請求書).
// Only the latest payable document in a group is the one to pay and reconcile; the others stay as evidence.
type Actor = Pick<User, "id" | "role">;
export const debtRoles: Record<DebtRole, string> = { INVOICE: "請求書", REISSUE: "再請求", REMINDER: "督促", STATEMENT: "合計請求書", RECEIPT: "領収書" };
export const debtRoleList = Object.keys(debtRoles) as DebtRole[];
const payableRoles: DebtRole[] = ["INVOICE", "REISSUE", "REMINDER", "STATEMENT"];
export const DEBT_NOT_PAYABLE = "債務グループの支払対象外の書類です。最新の請求書（支払対象）で支払・照合してください";
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
const cents = (value: number) => Math.round(value * 100);

const scopedProjects = (data: AppData, actor: Actor, company: CompanyScope) => new Set(visibleProjects(data, actor).filter((row) => !row.deletedAt && companyFromParam(row.company) === company).map((row) => row.id));
function companyOf(data: AppData, invoice: ReceivedInvoice) {
  const project = data.projects.find((row) => row.id === invoice.projectId && !row.deletedAt);
  return project ? companyFromParam(project.company) : undefined;
}

export function debtGroupMembers(data: AppData, groupId: string) {
  return data.receivedInvoices.filter((row) => !row.deletedAt && row.debtGroupId === groupId).sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.createdAt.localeCompare(b.createdAt));
}
export function payableDebtDocument(members: ReceivedInvoice[]) {
  return members.filter((row) => payableRoles.includes(row.debtRole || "INVOICE")).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt))[0];
}
export function isPayableReceivedInvoice(data: AppData, invoice: ReceivedInvoice) {
  if (!invoice.debtGroupId) return true;
  return payableDebtDocument(debtGroupMembers(data, invoice.debtGroupId))?.id === invoice.id;
}

export type DebtGroupMemberView = { id: string; updatedAt: string; role: DebtRole; roleLabel: string; issueDate: string; total: number; fileName: string; status: ReceivedInvoice["status"]; payable: boolean; statementCurrentAmount?: number; statementCarriedOver?: number };
export type DebtGroupCandidateView = { id: string; issueDate: string; total: number; fileName: string; status: ReceivedInvoice["status"]; reasons: string[] };
export type DebtGroupView = { groupId?: string; role: DebtRole; payable: boolean; payableId?: string; members: DebtGroupMemberView[]; candidates: DebtGroupCandidateView[]; statementCurrentAmount?: number; statementCarriedOver?: number };

const keyword = /再発行|再請求|督促|領収|合計請求|お支払いのお願い|reminder|receipt|statement/i;
// Proposal only: same vendor, within half a year, same amount or a reissue/reminder/receipt word in the name.
export function debtGroupCandidates(data: AppData, company: CompanyScope, invoice: ReceivedInvoice, limit = 8): DebtGroupCandidateView[] {
  const own = `${invoice.originalFileName || ""} ${invoice.memo || ""}`;
  return data.receivedInvoices.filter((row) => !row.deletedAt && row.id !== invoice.id && row.vendorId === invoice.vendorId && companyOf(data, row) === company && !row.debtGroupId)
    .flatMap((row) => {
      const days = Math.abs(Date.parse(row.issueDate) - Date.parse(invoice.issueDate)) / 86400000;
      if (!Number.isFinite(days) || days > 180) return [];
      const reasons: string[] = [];
      if (cents(row.total) === cents(invoice.total)) reasons.push("同じ金額");
      if (keyword.test(`${row.originalFileName || ""} ${row.memo || ""}`) || keyword.test(own)) reasons.push("再請求・督促・領収・合計の語を含む");
      if (!reasons.length) return [];
      reasons.push(`発行日の差 ${Math.round(days)}日`);
      return [{ id: row.id, issueDate: row.issueDate, total: row.total, fileName: row.originalFileName || "受領請求書", status: row.status, reasons }];
    }).sort((a, b) => b.reasons.length - a.reasons.length || b.issueDate.localeCompare(a.issueDate)).slice(0, limit);
}

export function debtGroupView(data: AppData, company: CompanyScope, invoice: ReceivedInvoice): DebtGroupView {
  const members = invoice.debtGroupId ? debtGroupMembers(data, invoice.debtGroupId) : [];
  const payable = members.length ? payableDebtDocument(members) : undefined;
  return { groupId: invoice.debtGroupId, role: invoice.debtRole || "INVOICE", payable: !invoice.debtGroupId || payable?.id === invoice.id, payableId: payable?.id,
    members: members.map((row) => ({ id: row.id, updatedAt: row.updatedAt, role: row.debtRole || "INVOICE", roleLabel: debtRoles[row.debtRole || "INVOICE"], issueDate: row.issueDate, total: row.total, fileName: row.originalFileName || "受領請求書", status: row.status, payable: row.id === payable?.id, statementCurrentAmount: row.statementCurrentAmount, statementCarriedOver: row.statementCarriedOver })),
    candidates: debtGroupCandidates(data, company, invoice), statementCurrentAmount: invoice.statementCurrentAmount, statementCarriedOver: invoice.statementCarriedOver };
}

const roleEnum = z.enum(debtRoleList as [DebtRole, ...DebtRole[]]);
const assignSchema = z.object({ invoiceIds: z.array(z.string().min(1).max(1000)).min(2).max(50), roles: z.record(z.string(), roleEnum).default({}), groupId: z.string().min(1).max(1000).optional() });
export type AssignDebtGroupInput = z.input<typeof assignSchema>;

function requireManager(data: AppData, actor: Actor, company: CompanyScope) {
  if (!can(actor, "manage:receivedInvoices") || !canAccessCompany(actor, company)) throw new Error("権限がありません");
  return scopedProjects(data, actor, company);
}
function ensurePayable(data: AppData, groupId: string) {
  const members = debtGroupMembers(data, groupId);
  const payable = payableDebtDocument(members);
  if (!payable) throw new Error("支払対象となる書類（請求書・再請求・督促・合計請求書）が1枚必要です");
  for (const row of members) {
    if (row.id === payable.id) continue;
    if (data.payments.some((payment) => !payment.deletedAt && payment.type === "EXPENSE" && payment.receivedInvoiceId === row.id)) throw new Error(`支払記録のある書類（${row.originalFileName || row.id}）は支払対象外にできません。先に支払記録を支払対象の書類へ移すか取り消してください`);
  }
  return { members, payable };
}

export function assignDebtGroup(data: AppData, actor: Actor, company: CompanyScope, input: AssignDebtGroupInput) {
  const projects = requireManager(data, actor, company);
  const value = assignSchema.parse(input), ids = [...new Set(value.invoiceIds)];
  if (ids.length < 2) throw new Error("2枚以上の書類を選んでください");
  const invoices = ids.map((id) => { const row = data.receivedInvoices.find((item) => item.id === id && !item.deletedAt && projects.has(item.projectId)); if (!row) throw new Error("受領請求書が見つかりません"); return row; });
  if (new Set(invoices.map((row) => row.vendorId)).size !== 1) throw new Error("同じ支払先の書類だけ束ねられます");
  const existing = new Set(invoices.map((row) => row.debtGroupId).filter((id): id is string => Boolean(id)));
  if (value.groupId && [...existing].some((id) => id !== value.groupId)) throw new Error("別の債務グループに属する書類が含まれています");
  if (!value.groupId && existing.size > 1) throw new Error("別々の債務グループの書類は束ねられません。先にグループから外してください");
  const groupId = value.groupId || [...existing][0] || crypto.randomUUID();
  for (const row of invoices) { row.debtGroupId = groupId; row.debtRole = value.roles[row.id] || row.debtRole || "INVOICE"; row.updatedAt = stamp(row.updatedAt); }
  const { members, payable } = ensurePayable(data, groupId);
  return { groupId, payableId: payable.id, memberIds: members.map((row) => row.id) };
}

const roleUpdateSchema = z.object({ invoiceId: z.string().min(1).max(1000), expectedUpdatedAt: z.string(), role: roleEnum,
  statementCurrentAmount: z.number().min(0).max(1e12).optional(), statementCarriedOver: z.number().min(0).max(1e12).optional() });
export type UpdateDebtRoleInput = z.input<typeof roleUpdateSchema>;
export function updateDebtRole(data: AppData, actor: Actor, company: CompanyScope, input: UpdateDebtRoleInput) {
  const projects = requireManager(data, actor, company);
  const value = roleUpdateSchema.parse(input);
  const invoice = data.receivedInvoices.find((row) => row.id === value.invoiceId && !row.deletedAt && projects.has(row.projectId));
  if (!invoice) throw new Error("受領請求書が見つかりません");
  if (invoice.updatedAt !== value.expectedUpdatedAt) throw new Error("書類が更新されています。画面を更新してください");
  if (!invoice.debtGroupId) throw new Error("債務グループに属していない書類です");
  const before = { role: invoice.debtRole, current: invoice.statementCurrentAmount, carried: invoice.statementCarriedOver };
  invoice.debtRole = value.role;
  if (value.role === "STATEMENT") { invoice.statementCurrentAmount = value.statementCurrentAmount; invoice.statementCarriedOver = value.statementCarriedOver; }
  else { delete invoice.statementCurrentAmount; delete invoice.statementCarriedOver; }
  try { ensurePayable(data, invoice.debtGroupId); }
  catch (error) { invoice.debtRole = before.role; invoice.statementCurrentAmount = before.current; invoice.statementCarriedOver = before.carried; throw error; }
  invoice.updatedAt = stamp(invoice.updatedAt);
  return { id: invoice.id, role: invoice.debtRole, payableId: payableDebtDocument(debtGroupMembers(data, invoice.debtGroupId))!.id };
}

const removeSchema = z.object({ invoiceId: z.string().min(1).max(1000), expectedUpdatedAt: z.string() });
export type RemoveFromDebtGroupInput = z.input<typeof removeSchema>;
export function removeFromDebtGroup(data: AppData, actor: Actor, company: CompanyScope, input: RemoveFromDebtGroupInput) {
  const projects = requireManager(data, actor, company);
  const value = removeSchema.parse(input);
  const invoice = data.receivedInvoices.find((row) => row.id === value.invoiceId && !row.deletedAt && projects.has(row.projectId));
  if (!invoice) throw new Error("受領請求書が見つかりません");
  if (invoice.updatedAt !== value.expectedUpdatedAt) throw new Error("書類が更新されています。画面を更新してください");
  const groupId = invoice.debtGroupId;
  if (!groupId) throw new Error("債務グループに属していない書類です");
  const clear = (row: ReceivedInvoice) => { delete row.debtGroupId; delete row.debtRole; delete row.statementCurrentAmount; delete row.statementCarriedOver; row.updatedAt = stamp(row.updatedAt); };
  clear(invoice);
  const rest = debtGroupMembers(data, groupId);
  // A group of one is no group: the remaining document goes back to standing on its own.
  if (rest.length === 1) clear(rest[0]);
  else if (rest.length) ensurePayable(data, groupId);
  return { id: invoice.id, groupId, remaining: rest.length === 1 ? 0 : rest.length };
}
