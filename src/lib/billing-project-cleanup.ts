import { createHash } from "node:crypto";
import { entityNameKey, splitBillingProjectName } from "@/lib/billing-project-name";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { assertCan, assertCompanyAccess, can, canAccessCompany } from "@/lib/rbac";
import type { AppData, Project, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;
export type BillingProjectGroup = { id: string; signature: string; name: string; clientName: string; names: string[]; documentCount: number };
const accessKey = (p: Project) => JSON.stringify([p.managerId, [...p.memberIds].sort()]);

function canRetire(data: AppData, p: Project) {
  return p.memo === "発行請求書OCRから自動作成。案件名・請求先・契約情報要確認。" && p.status === "PLANNING" &&
    p.contractAmount === 0 && (p.billingCount || 1) === 1 && !p.stage && !p.startDate && !p.endDate &&
    !Object.entries(p).some(([key, value]) => key.startsWith("contract") && key !== "contractAmount" && value) &&
    !data.receivedInvoices.some((i) => i.projectId === p.id) && !data.attachments.some((a) => a.relatedId === p.id);
}

function candidates(data: AppData, user: Actor, company: CompanyScope) {
  if (!can(user, "manage:invoiceProjects") || !canAccessCompany(user, company)) return [];
  const visible = new Set(visibleProjects(data, user).map((p) => p.id));
  const groups = new Map<string, Project[]>();
  for (const p of data.projects) {
    if (p.deletedAt || companyFromParam(p.company) !== company) continue;
    const { projectName } = splitBillingProjectName(p.name);
    if (!projectName) continue;
    const key = JSON.stringify([p.clientId, entityNameKey(projectName)]);
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  return [...groups.values()].flatMap((projects) => {
    const labeled = projects.filter((p) => splitBillingProjectName(p.name).billingLabel);
    const plain = projects.filter((p) => !splitBillingProjectName(p.name).billingLabel);
    if (!labeled.length || plain.length > 1 || projects.some((p) => !visible.has(p.id) || p.status === "ARCHIVED")) return [];
    const client = data.clients.find((c) => c.id === projects[0].clientId && !c.deletedAt && companyFromParam(c.company) === company);
    if (!client) return [];
    const target = plain[0] || [...labeled].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
    if (labeled.some((p) => !canRetire(data, p)) || projects.some((p) => accessKey(p) !== accessKey(target))) return [];
    const ids = new Set(projects.map((p) => p.id));
    const invoices = data.issuedInvoices.filter((i) => ids.has(i.projectId));
    const estimates = data.estimates.filter((e) => ids.has(e.projectId));
    const signature = createHash("sha256").update(JSON.stringify({ projects, invoices, estimates })).digest("hex");
    const name = plain[0]?.name || splitBillingProjectName(target.name).projectName;
    return [{ target, projects, invoices, estimates, summary: { id: target.id, signature, name, clientName: client.companyName,
      names: labeled.map((p) => p.name), documentCount: [...invoices, ...estimates].filter((d) => !d.deletedAt).length } }];
  });
}

export function billingProjectGroups(data: AppData, user: Actor, company: CompanyScope): BillingProjectGroup[] {
  return candidates(data, user, company).map((group) => group.summary);
}

export function consolidateBillingProject(data: AppData, user: Actor, company: CompanyScope, input: { id: string; signature: string }) {
  assertCan(user, "manage:invoiceProjects");
  assertCompanyAccess(user, company);
  const group = candidates(data, user, company).find((g) => g.summary.id === input.id && g.summary.signature === input.signature);
  if (!group) throw new Error("案件または書類が更新されています。再読み込みして統合候補を確認してください");
  const timestamp = new Date(Math.max(Date.now(), ...[...group.projects, ...group.invoices, ...group.estimates].map((r) => (Date.parse(r.updatedAt) || 0) + 1))).toISOString();
  const names = new Map(group.projects.map((p) => [p.id, p.name]));
  // Preserve invoice/payment identities and recipients, including soft-deleted history.
  for (const doc of [...group.invoices, ...group.estimates]) {
    doc.billingLabel ||= splitBillingProjectName(names.get(doc.projectId) || "").billingLabel;
    doc.projectId = group.target.id;
    doc.updatedAt = timestamp;
  }
  for (const p of group.projects) {
    p.updatedAt = timestamp;
    if (p.id !== group.target.id) p.deletedAt = timestamp;
  }
  group.target.name = group.summary.name;
  return { id: group.target.id, name: group.target.name };
}
