import { z } from "zod";
import type { AppData, IntegrityAcknowledgement, User } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import { INTEGRITY_KIND_LIMIT, integrityReport } from "@/lib/integrity";
import { integrityKinds, type IntegrityKind } from "@/lib/integrity-types";

const reason = z.string().trim().min(1, "理由を入力してください").max(1000, "理由は1000文字以内で入力してください");
const reference = z.object({ id: z.string().min(1).max(10000), fingerprint: z.string().regex(/^v1:[0-9a-f]{64}$/) }).strict();
const schema = z.object({
  mode: z.enum(["ISSUE", "KIND"]), kind: z.enum(Object.keys(integrityKinds) as [IntegrityKind, ...IntegrityKind[]]), reason,
  targets: z.array(reference).min(1).max(INTEGRITY_KIND_LIMIT).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, "指摘が重複しています"),
}).strict().refine((value) => value.mode !== "ISSUE" || value.targets.length === 1, "指摘単位では1件を指定してください");
export type AcknowledgeIntegrityInput = z.input<typeof schema>;
const revokeSchema = z.object({ id: z.string().min(1).max(1000), updatedAt: z.string().min(1).max(1000), reason }).strict();
export type RevokeIntegrityInput = z.input<typeof revokeSchema>;
type Options = { today?: string; fileExists?: (fileUrl?: string) => boolean | undefined };

export function acknowledgeIntegrity(data: AppData, actor: Pick<User, "id" | "role" | "featureAccess">, company: CompanyScope, input: AcknowledgeIntegrityInput, options: Options = {}) {
  assertCompanyAccess(actor, company); assertCan(actor, "manage:banking");
  const value = schema.parse(input), report = integrityReport(data, company, options);
  const current = new Map(report.issues.map((issue) => [issue.id, issue]));
  // Validate the entire submitted snapshot under the mutation lock before creating any record.
  for (const target of value.targets) {
    const issue = current.get(target.id);
    if (!issue || issue.kind !== value.kind || issue.fingerprint !== target.fingerprint) throw new Error("指摘が更新・解消・既知登録されています。再読込して内容を確認してください");
  }
  const timestamp = new Date().toISOString(), batchId = crypto.randomUUID();
  const rows: IntegrityAcknowledgement[] = value.targets.map((target) => ({ id: crypto.randomUUID(), company, issueId: target.id, kind: value.kind,
    fingerprint: target.fingerprint, reason: value.reason, batchId, createdAt: timestamp, updatedAt: timestamp, createdById: actor.id, createdByName: data.users.find((user) => user.id === actor.id)?.name || actor.id }));
  (data.integrityAcknowledgements ??= []).unshift(...rows);
  return { mode: value.mode, kind: value.kind, count: rows.length, batchId, reason: value.reason, ids: rows.map((row) => row.id) };
}

export function revokeIntegrityAcknowledgement(data: AppData, actor: Pick<User, "id" | "role" | "featureAccess">, company: CompanyScope, input: RevokeIntegrityInput) {
  assertCompanyAccess(actor, company); assertCan(actor, "manage:banking");
  const value = revokeSchema.parse(input), row = (data.integrityAcknowledgements || []).find((item) => item.id === value.id && item.company === company);
  const latest = row && data.integrityAcknowledgements!.find((item) => item.company === company && item.issueId === row.issueId);
  if (!row || latest !== row || row.revokedAt || row.updatedAt !== value.updatedAt) throw new Error("既知の記録が更新されています。再読込してください");
  const timestamp = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString();
  Object.assign(row, { revokedAt: timestamp, updatedAt: timestamp, revokedById: actor.id, revokedByName: data.users.find((user) => user.id === actor.id)?.name || actor.id, revokeReason: value.reason });
  return { id: row.id, issueId: row.issueId, kind: row.kind, reason: value.reason };
}
