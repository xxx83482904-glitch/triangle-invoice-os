import { rolePermissions } from "@/lib/role-permissions";
import type { UserRole } from "@/lib/types";

/** Ordered UI catalog. revokeAlso removes legacy privileges but never grants them. */
export const memberFeatures = [
  { key: "dashboard", label: "ダッシュボード", grant: ["view:dashboard"], revokeAlso: [] },
  { key: "banking", label: "口座・カード", grant: ["view:banking", "manage:banking"], revokeAlso: [] },
  { key: "documents", label: "全書類", grant: ["view:documents"], revokeAlso: [] },
  { key: "projects", label: "案件", grant: ["view:projects", "manage:projects", "comment:project"], revokeAlso: [] },
  { key: "issuedInvoices", label: "見積書・発行請求書", grant: ["view:issuedInvoices", "manage:issuedInvoices", "export:issuedInvoices"], revokeAlso: ["create:invoiceProjects"] },
  { key: "issuedInvoiceAmounts", label: "請求書の金額", grant: ["view:issuedInvoiceAmounts"], revokeAlso: [] },
  { key: "mailSorter", label: "郵便仕分け", grant: ["view:mailSorter", "manage:mailSorter"], revokeAlso: [] },
  { key: "receivedInvoices", label: "受領請求書", grant: ["view:receivedInvoices", "manage:receivedInvoices"], revokeAlso: ["approve:receivedInvoices", "upload:receivedInvoices"] },
  { key: "imports", label: "輸入", grant: ["view:imports", "manage:imports"], revokeAlso: [] },
  { key: "payments", label: "入金・支払い", grant: ["view:payments", "manage:incomePayments"], revokeAlso: [] },
  { key: "expenses", label: "経費精算（申請）", grant: ["submit:expenses"], revokeAlso: [] },
  { key: "expenseApproval", label: "経費精算の承認・振込", grant: ["manage:expenses", "manage:expensePayments"], revokeAlso: [] },
  { key: "reports", label: "集計", grant: ["view:reports"], revokeAlso: [] },
  { key: "csvExport", label: "CSVの書き出し", grant: ["export:csv"], revokeAlso: [] },
  { key: "partners", label: "取引先", grant: ["view:partners", "manage:clients", "manage:vendors"], revokeAlso: [] },
] as const;

export type MemberFeatureKey = (typeof memberFeatures)[number]["key"];
/** Stored overrides only. Missing entries inherit the role default. */
export type FeatureAccess = Partial<Record<MemberFeatureKey, boolean>>;

export function roleHasFeature(role: UserRole, key: MemberFeatureKey) {
  const feature = memberFeatures.find((item) => item.key === key);
  return Boolean(feature && [...feature.grant, ...feature.revokeAlso].some((permission) => rolePermissions[role].includes(permission)));
}

function override(role: UserRole, states: FeatureAccess | undefined, key: MemberFeatureKey) {
  if (role === "GUEST" || !states || !Object.hasOwn(states, key)) return undefined;
  return typeof states[key] === "boolean" ? states[key] : undefined;
}

export function effectiveFeatures(role: UserRole, featureAccess?: FeatureAccess): Record<MemberFeatureKey, boolean> {
  return Object.fromEntries(memberFeatures.map(({ key }) => [key, override(role, featureAccess, key) ?? roleHasFeature(role, key)])) as Record<MemberFeatureKey, boolean>;
}

/** Persist only differences; guests never have overrides. Invalid saved values are ignored. */
export function normalizeFeatureAccess(role: UserRole, states?: FeatureAccess): FeatureAccess | undefined {
  const result: FeatureAccess = {};
  for (const { key } of memberFeatures) {
    const value = override(role, states, key);
    if (value !== undefined && value !== roleHasFeature(role, key)) result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

/** A fresh set of base permissions. Derived permissions are resolved by rbac.can. */
export function effectivePermissions(role: UserRole, featureAccess?: FeatureAccess): Set<string> {
  const result = new Set(rolePermissions[role]);
  for (const feature of memberFeatures) {
    const value = override(role, featureAccess, feature.key);
    if (value === false) for (const permission of [...feature.grant, ...feature.revokeAlso]) result.delete(permission);
    else if (value === true && !roleHasFeature(role, feature.key)) for (const permission of feature.grant) result.add(permission);
  }
  return result;
}
