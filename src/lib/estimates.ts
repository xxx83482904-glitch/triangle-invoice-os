import { randomUUID } from "node:crypto";
import { z } from "zod";
import { companyFromParam, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { documentDateSchema, estimateSchema, estimateTotals, type EstimateInput } from "@/lib/estimate-values";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import type { AppData, Estimate, IssuedInvoice, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role">;
export type EstimateTarget = { id: string; updatedAt: string };
export type EstimateConversion = EstimateTarget & { issueDate: string; dueDate: string; transactionDate: string };
const targetSchema = z.object({ id: z.string().min(1), updatedAt: z.string().min(1) });
const conversionSchema = targetSchema.extend({ issueDate: documentDateSchema, dueDate: documentDateSchema, transactionDate: documentDateSchema })
  .refine((v) => v.dueDate >= v.issueDate, { message: "支払期限は発行日以降にしてください" });

function projectScope(data: AppData, user: Actor, company: CompanyScope) {
  assertCan(user, "manage:estimates");
  assertCompanyAccess(user, company);
  return new Set(visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company).map((p) => p.id));
}
function findEstimate(data: AppData, ids: Set<string>, id: string) {
  const estimate = data.estimates.find((e) => e.id === id && !e.deletedAt && ids.has(e.projectId));
  if (!estimate) throw new Error("見積書が見つからないか、操作する権限がありません");
  return estimate;
}
function assertVersion(estimate: Estimate, version?: string) {
  if (estimate.updatedAt !== version) throw new Error("他の操作で更新されています。再読み込みして確認してください");
}
function timestampAfter(previous?: string) {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}
export function saveEstimate(data: AppData, user: Actor, company: CompanyScope, input: EstimateInput) {
  const ids = projectScope(data, user, company);
  const parsed = estimateSchema.parse(input);
  const existing = parsed.id ? findEstimate(data, ids, parsed.id) : undefined;
  if (existing) {
    assertVersion(existing, parsed.updatedAt);
    if (existing.invoiceId || existing.status === "CONVERTED") throw new Error("請求書に変換済みの見積書は編集できません");
  }
  if (!ids.has(parsed.projectId)) throw new Error("この案件には見積書を作成できません");
  if (!data.clients.some((c) => c.id === parsed.clientId && !c.deletedAt && partnerMatchesCompany(c, company))) throw new Error("同じ会社の有効な取引先を選択してください");
  const totals = estimateTotals(parsed.items);
  if (!Number.isSafeInteger(totals.total) || totals.total > 1000000000000) throw new Error("見積金額が上限を超えています");
  const timestamp = timestampAfter(existing?.updatedAt);
  const prefix = `EST-${parsed.issueDate.slice(0, 4)}-`;
  let serial = 1;
  const numbers = new Set(data.estimates.map((e) => e.estimateNumber));
  while (numbers.has(`${prefix}${String(serial).padStart(4, "0")}`)) serial++;
  const estimate: Estimate = {
    id: existing?.id || randomUUID(), estimateNumber: existing?.estimateNumber || `${prefix}${String(serial).padStart(4, "0")}`,
    projectId: parsed.projectId, clientId: parsed.clientId, issueDate: parsed.issueDate, validUntil: parsed.validUntil,
    status: parsed.status, notes: parsed.notes, internalMemo: parsed.internalMemo, ...totals,
    items: parsed.items.map((item) => ({ ...item, id: randomUUID(), amount: Math.round(item.quantity * item.unitPrice) })),
    createdById: existing?.createdById || user.id, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp,
  };
  if (existing) Object.assign(existing, estimate); else data.estimates.unshift(estimate);
  return estimate;
}

export function convertEstimate(data: AppData, user: Actor, company: CompanyScope, input: EstimateConversion) {
  const ids = projectScope(data, user, company);
  assertCan(user, "manage:issuedInvoices");
  const parsed = conversionSchema.parse(input);
  const estimate = findEstimate(data, ids, parsed.id);
  // Retries return the same authorized invoice, even after the source version has changed.
  if (estimate.invoiceId) {
    const existing = data.issuedInvoices.find((i) => i.id === estimate.invoiceId && !i.deletedAt && ids.has(i.projectId));
    if (!existing) throw new Error("変換先の請求書は削除済みか、参照できません。管理者に確認してください");
    return existing;
  }
  assertVersion(estimate, parsed.updatedAt);
  if (estimate.status === "DECLINED" || estimate.status === "CONVERTED") throw new Error("この状態の見積書は請求書に変換できません");
  if (!data.clients.some((c) => c.id === estimate.clientId && !c.deletedAt && partnerMatchesCompany(c, company))) throw new Error("取引先が削除または変更されています");
  const timestamp = timestampAfter(estimate.updatedAt);
  const setting = data.invoiceNumberSettings[0];
  const prefix = `${setting?.prefix || "TRI"}-${setting?.fiscalYear || Number(parsed.issueDate.slice(0, 4))}-`;
  let serial = Math.max(1, setting?.nextNumber || 1);
  const numbers = new Set(data.issuedInvoices.map((i) => i.invoiceNumber));
  while (numbers.has(`${prefix}${String(serial).padStart(4, "0")}`)) serial++;
  const invoice: IssuedInvoice = {
    id: randomUUID(), invoiceNumber: `${prefix}${String(serial).padStart(4, "0")}`, estimateId: estimate.id,
    projectId: estimate.projectId, clientId: estimate.clientId, issueDate: parsed.issueDate, dueDate: parsed.dueDate,
    transactionDate: parsed.transactionDate, subtotal: estimate.subtotal, taxTotal: estimate.taxTotal, total: estimate.total,
    status: "DRAFT", needsReview: false, notes: estimate.notes, internalMemo: estimate.internalMemo,
    createdById: user.id, createdAt: timestamp, updatedAt: timestamp,
  };
  data.issuedInvoices.unshift(invoice);
  data.issuedInvoiceItems.push(...estimate.items.map((item) => ({ ...item, id: randomUUID(), invoiceId: invoice.id, createdAt: timestamp, updatedAt: timestamp })));
  if (setting) { setting.nextNumber = serial + 1; setting.updatedAt = timestamp; }
  estimate.invoiceId = invoice.id; estimate.status = "CONVERTED"; estimate.updatedAt = timestamp;
  return invoice;
}

export function deleteEstimate(data: AppData, user: Actor, company: CompanyScope, input: EstimateTarget) {
  const ids = projectScope(data, user, company);
  const parsed = targetSchema.parse(input);
  const estimate = findEstimate(data, ids, parsed.id);
  assertVersion(estimate, parsed.updatedAt);
  if (estimate.invoiceId || estimate.status === "CONVERTED") throw new Error("請求書に変換済みの見積書は削除できません");
  estimate.deletedAt = timestampAfter(estimate.updatedAt); estimate.updatedAt = estimate.deletedAt;
  return { id: estimate.id };
}
