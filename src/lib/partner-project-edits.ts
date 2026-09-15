import { z } from "zod";
import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;
const targetSchema = z.object({ id: z.string().min(1), updatedAt: z.string().min(1) });
const projectSchema = targetSchema.extend({ name: z.string().trim().min(1, "案件名を入力してください").max(500), clientId: z.string().min(1) });
export type ProjectBasicInput = z.infer<typeof projectSchema>;
export type ClientDeleteInput = z.infer<typeof targetSchema>;

function nextVersion(previous: string) {
  return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
}
function checkVersion(record: { updatedAt: string }, expected: string) {
  if (record.updatedAt !== expected) throw new Error("他の操作で更新されています。再読み込みして確認してください");
}

export function updateProjectBasics(data: AppData, user: Actor, company: CompanyScope, input: ProjectBasicInput) {
  assertCan(user, "manage:invoiceProjects");
  assertCompanyAccess(user, company);
  const value = projectSchema.parse(input);
  const project = visibleProjects(data, user).find((p) => p.id === value.id && companyFromParam(p.company) === company);
  if (!project) throw new Error("案件が見つからないか、編集する権限がありません");
  checkVersion(project, value.updatedAt);
  if (!data.clients.some((c) => c.id === value.clientId && !c.deletedAt && partnerMatchesCompany(c, company))) throw new Error("同じ会社の有効な取引先を選択してください");
  // Existing documents retain their recipients; only the project's defaults change.
  project.name = value.name;
  project.clientId = value.clientId;
  project.updatedAt = nextVersion(project.updatedAt);
  return { id: project.id, name: project.name, clientId: project.clientId, updatedAt: project.updatedAt };
}

export function deleteClient(data: AppData, user: Actor, company: CompanyScope, input: ClientDeleteInput) {
  assertCan(user, "manage:clients");
  assertCompanyAccess(user, company);
  const value = targetSchema.parse(input);
  const client = data.clients.find((c) => c.id === value.id && !c.deletedAt && partnerMatchesCompany(c, company));
  if (!client) throw new Error("クライアントが見つからないか、削除する権限がありません");
  checkVersion(client, value.updatedAt);
  if (["cli-japan", "cli-china"].includes(client.id)) throw new Error("標準クライアントは削除できません");
  if (data.projects.some((p) => !p.deletedAt && p.clientId === client.id) ||
      data.issuedInvoices.some((i) => !i.deletedAt && i.clientId === client.id) ||
      data.estimates.some((e) => !e.deletedAt && e.clientId === client.id)) {
    throw new Error("案件・請求書・見積書で使用中のため削除できません。紐付け先を変更してから削除してください");
  }
  client.deletedAt = nextVersion(client.updatedAt);
  client.updatedAt = client.deletedAt;
  return { id: client.id };
}
