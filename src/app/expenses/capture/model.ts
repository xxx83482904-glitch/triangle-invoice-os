import type { CardReceiptView, CardUseView, MyCardView } from "@/lib/card-receipts";
import type { ExpenseClaimStatus, ExpensePaidWith } from "@/lib/types";

export type { CardReceiptView, CardUseView, MyCardView };
export type PayKind = "expense" | "card";

export type Option = { value: string; label: string };
// One of the person's own claims, as the phone screens need it.
export type MyClaim = {
  id: string; updatedAt: string; createdAt: string; submittedAt: string; spentOn: string; payee: string; purpose: string; amount: number; status: ExpenseClaimStatus;
  reviewNote: string; reviewerName: string; reviewedAt: string; paidAt: string; categoryId: string; categoryName: string; projectId: string; projectName: string;
  paidWith: ExpensePaidWith | ""; memo: string; registrationNumber: string; tax10: number; tax8: number; fileUrl: string; mimeType: string; editable: boolean;
};
export type Fields = { amount: string; spentOn: string; payee: string; purpose: string; categoryId: string; projectId: string; paidWith: ExpensePaidWith;
  registrationNumber: string; tax10: string; tax8: string; memo: string };
export type FieldKey = keyof Fields;
export type Source = "ai" | "ocr" | "history";
export type Draft = {
  key: string; kind: PayKind; targetUse?: CardUseView; burst?: string; file?: File; preview: string; pdf: boolean; state: "preparing" | "reading" | "ready" | "sending"; manual: boolean;
  fields: Fields; auto: Partial<Record<FieldKey, Source>>; touched: Partial<Record<FieldKey, true>>; ocrText: string; warnings: string[]; error: string;
  claim?: MyClaim; more: boolean;
};
export type ScreenState =
  | { name: "home" }
  | { name: "confirm"; key: string; mode: "single" | "batch" | "edit" }
  | { name: "batch" }
  | { name: "done"; count: number; total: number; label: string; note?: string }
  | { name: "shutter"; kind: PayKind; session: string }
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "cardPick"; receipt: Pick<CardReceiptView, "id" | "updatedAt" | "payee" | "amount" | "spentOn" | "candidates"> }
  | { name: "cardDone"; status: CardReceiptView["status"]; payee: string; amount: number; purpose: string; use?: CardUseView }
  | { name: "missing" }
  | { name: "cardDetail"; id: string };
export type SheetState = { kind: "spentOn" | "payee" | "purpose" | "projectId" | "categoryId"; key: string } | { kind: "withdraw"; id: string }
  | { kind: "payKind" } | { kind: "removeCard"; id: string } | null;

const DAY = 86_400_000;
// The same rule the server applies: the person's own undocumented uses with the same amount within a week.
export function cardMatches(uses: Array<CardUseView & { documented: boolean }>, amount: number, spentOn: string) {
  if (!amount || !/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) return [];
  return uses.filter((row) => !row.documented && Math.round(row.amount * 100) === Math.round(amount * 100) && Math.abs(Date.parse(row.date) - Date.parse(spentOn)) <= 7 * DAY);
}

export const emptyFields = (paidWith: ExpensePaidWith): Fields => ({ amount: "", spentOn: "", payee: "", purpose: "", categoryId: "", projectId: "", paidWith,
  registrationNumber: "", tax10: "", tax8: "", memo: "" });

export function missing(fields: Fields, today: string) {
  const list: string[] = [], amount = Number(fields.amount.replaceAll(",", ""));
  if (!fields.amount || !Number.isSafeInteger(amount) || amount <= 0) list.push("金額");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.spentOn) || fields.spentOn > today) list.push("日付");
  if (!fields.payee.trim()) list.push("お店");
  if (!fields.purpose.trim()) list.push("用途");
  return list;
}

export function amountOf(fields: Fields) {
  const value = Number(fields.amount.replaceAll(",", ""));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function claimFields(claim: MyClaim): Fields {
  return { amount: String(claim.amount), spentOn: claim.spentOn, payee: claim.payee, purpose: claim.purpose, categoryId: claim.categoryId, projectId: claim.projectId,
    paidWith: claim.paidWith || "CASH", registrationNumber: claim.registrationNumber, tax10: claim.tax10 ? String(claim.tax10) : "", tax8: claim.tax8 ? String(claim.tax8) : "", memo: claim.memo };
}
