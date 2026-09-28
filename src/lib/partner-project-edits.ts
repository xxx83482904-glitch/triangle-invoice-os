import { z } from "zod";
import { randomUUID } from "node:crypto";
import { entityNameKey, isBillingDescription } from "@/lib/billing-project-name";
import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;
const targetSchema = z.object({ id: z.string().min(1), updatedAt: z.string().min(1) });
const projectSchema = targetSchema.extend({ name: z.string().trim().min(1, "案件名を入力してください").max(500), clientId: z.string().min(1) });
export type ProjectBasicInput = z.infer<typeof projectSchema>;
export type ClientDeleteInput = z.infer<typeof targetSchema>;
const clientFieldsSchema = z.object({
  companyName: z.string().trim().min(1, "会社名を入力してください").max(500)
    .refine((name) => !isBillingDescription(name), "請求回数ではなく、クライアントの会社名・氏名を入力してください"),
  contactName: z.string().trim().max(200).default(""),
  email: z.union([z.literal(""), z.string().trim().email("メールアドレスを確認してください")]).default(""),
  phone: z.string().trim().max(100).default(""),
  address: z.string().trim().max(1000).default(""),
  invoiceRegistrationNumber: z.string().trim().max(100).default(""),
  memo: z.string().trim().max(6000).default(""),
});
export type ClientFieldsInput = z.input<typeof clientFieldsSchema>;
export type ClientSaveInput = ClientFieldsInput & { id?: string; updatedAt?: string };

export function saveClient(data: AppData, user: Actor, company: CompanyScope, input: ClientSaveInput) {
  assertCan(user, "manage:clients");
  assertCompanyAccess(user, company);
  const fields = clientFieldsSchema.parse(input);
  const target = input.id ? targetSchema.parse(input) : null;
  const client = target ? data.clients.find((c) => c.id === target.id && !c.deletedAt && partnerMatchesCompany(c, company)) : undefined;
  if (target && !client) throw new Error("クライアントが見つからないか、編集する権限がありません");
  if (client) checkVersion(client, target!.updatedAt);
  if (data.clients.some((c) => !c.deletedAt && c.id !== client?.id && partnerMatchesCompany(c, company) && entityNameKey(c.companyName) === entityNameKey(fields.companyName))) {
    throw new Error("同名のクライアントが登録済みです。既存のクライアントを選択してください");
  }
  if (client) {
    Object.assign(client, fields, { updatedAt: nextVersion(client.updatedAt) });
    return client;
  }
  const timestamp = new Date().toISOString();
  const created = { ...fields, id: randomUUID(), company, createdAt: timestamp, updatedAt: timestamp,
    sortOrder: Math.max(0, ...data.clients.filter((c) => !c.deletedAt && partnerMatchesCompany(c, company)).map((c) => c.sortOrder || 0)) + 1 };
  data.clients.push(created);
  return created;
}

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
