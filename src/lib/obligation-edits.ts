import { z } from "zod";
import { bankToday, isBankDate } from "@/lib/banking";
import { partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { assertCan, assertCompanyAccess } from "@/lib/rbac";
import { taxObligations } from "@/lib/tax-obligations";
import type { AppData, ManualObligation, User } from "@/lib/types";

type Actor = Pick<User, "id" | "role" | "featureAccess">;
const required = (label: string, max = 200) => z.string().trim().min(1, `${label}を入力してください`).max(max, `${label}は${max}文字以内にしてください`);
const reference = required("対象", 1000), reason = required("理由", 500), version = required("更新情報", 20000);
const stamp = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
export const obligationKindInput = z.enum(["UNSET", "TAX", "SOCIAL_INSURANCE", "NONE"]);
const vendorSchema = z.object({ id: reference, updatedAt: version, obligationKind: obligationKindInput }).strict();
export type VendorObligationInput = z.input<typeof vendorSchema>;

export function updateVendorObligationKind(data: AppData, actor: Actor, company: CompanyScope, input: VendorObligationInput) {
  assertCompanyAccess(actor, company); assertCan(actor, "manage:vendors");
  const value = vendorSchema.parse(input);
  const row = data.vendors.find((item) => item.id === value.id && !item.deletedAt && partnerMatchesCompany(item, company));
  if (!row) throw new Error("支払先が見つかりません");
  if (row.updatedAt !== value.updatedAt) throw new Error("支払先が更新されています。再読込してください");
  if (value.obligationKind === "UNSET") delete row.obligationKind;
  else row.obligationKind = value.obligationKind;
  row.updatedAt = stamp(row.updatedAt);
  return { id: row.id, obligationKind: row.obligationKind, updatedAt: row.updatedAt };
}

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("exclude"), id: reference, version, reason }).strict(),
  z.object({ action: z.literal("restoreExclusion"), id: reference, version, reason }).strict(),
  z.object({ action: z.literal("create"), title: required("名称"), party: required("納付先"), amount: z.number().finite().int("金額は整数円で入力してください").positive("金額は1円以上にしてください").max(1e12), dueDate: z.string().refine((value) => !value || isBankDate(value), "期限は実在する日付にしてください"), memo: z.string().trim().max(2000) }).strict(),
  z.object({ action: z.enum(["pay", "reopen", "cancel", "restoreManual"]), id: reference, version, reason, paymentDate: z.string().optional() }).strict(),
]);
export type ObligationMutation = z.input<typeof mutationSchema>;

// Only the supplemental register and exclusion decisions change, never accounting source rows.
export function applyObligationMutation(data: AppData, actor: Actor, company: CompanyScope, input: ObligationMutation, today = bankToday()) {
  assertCompanyAccess(actor, company); assertCan(actor, "manage:banking");
  const value = mutationSchema.parse(input);
  if (value.action === "create") {
    const timestamp = stamp(), id = crypto.randomUUID();
    const row: ManualObligation = { id, company, title: value.title, party: value.party, amount: value.amount, dueDate: value.dueDate, memo: value.memo, status: "OPEN", createdById: actor.id, createdAt: timestamp, updatedAt: timestamp,
      history: [{ action: "CREATE", reason: "書類のない既知の未納を登録", byId: actor.id, at: timestamp }] };
    (data.manualObligations ??= []).push(row); return { id, action: value.action, updatedAt: timestamp };
  }
  if (value.action === "exclude") {
    const row = taxObligations(data, company, today).items.find((item) => item.id === value.id);
    if (!row || row.version !== value.version) throw new Error("対象の内容または一覧が更新されています。再読込してください");
    const timestamp = stamp(), id = crypto.randomUUID();
    (data.obligationExclusions ??= []).push({ id, company, targetId: row.id, snapshot: { title: row.title, party: row.party, source: row.source, amount: row.amount }, reason: value.reason, createdById: actor.id, createdAt: timestamp, updatedAt: timestamp });
    return { id, action: value.action, updatedAt: timestamp, reason: value.reason };
  }
  if (value.action === "restoreExclusion") {
    const row = (data.obligationExclusions || []).find((item) => item.id === value.id && item.company === company && !item.restoredAt);
    if (!row || row.updatedAt !== value.version) throw new Error("対象外の記録が更新されています。再読込してください");
    row.restoredAt = row.updatedAt = stamp(row.updatedAt); row.restoredById = actor.id; row.restoreReason = value.reason;
    return { id: row.id, action: value.action, updatedAt: row.updatedAt, reason: value.reason };
  }
  const row = (data.manualObligations || []).find((item) => item.id === value.id && item.company === company);
  if (!row || row.updatedAt !== value.version) throw new Error("手入力の記録が更新されています。再読込してください");
  const transition = {
    pay: { from: "OPEN", to: "PAID", history: "PAY" }, reopen: { from: "PAID", to: "OPEN", history: "REOPEN" },
    cancel: { from: "OPEN", to: "CANCELED", history: "CANCEL" }, restoreManual: { from: "CANCELED", to: "OPEN", history: "RESTORE" },
  } as const;
  const next = transition[value.action];
  if (row.status !== next.from) throw new Error("現在の状態ではこの操作はできません。再読込してください");
  if ((data.obligationExclusions || []).some((item) => item.company === company && item.targetId === `manual:${row.id}` && !item.restoredAt)) throw new Error("対象外の記録を先に元に戻してください");
  if (value.action === "pay" && (!isBankDate(value.paymentDate || "") || value.paymentDate! > today)) throw new Error("支払日は今日以前の実在する日付にしてください");
  const timestamp = stamp(row.updatedAt);
  row.history.push({ action: next.history, reason: value.reason, at: timestamp, byId: actor.id, ...(value.action === "pay" ? { paymentDate: value.paymentDate } : {}) });
  row.status = next.to; row.updatedAt = timestamp;
  if (value.action === "pay") row.paidAt = value.paymentDate;
  else delete row.paidAt;
  return { id: row.id, action: value.action, status: row.status, updatedAt: timestamp, reason: value.reason };
}
