import type { User, UserRole } from "@/lib/types";
import { effectivePermissions } from "@/lib/member-features";
import { rolePermissions } from "@/lib/role-permissions";
import type { CompanyScope } from "@/lib/company";

/** Safe to pass to client components; never pass a full stored User. */
export type UserAccess = Pick<User, "role" | "featureAccess">;

function hasPermission(permissions: ReadonlySet<string>, permission: string) {
  if (permission === "manage:invoiceProjects") return permissions.has("manage:projects") || permissions.has("create:invoiceProjects");
  if (permission === "view:estimates") return permissions.has("view:issuedInvoices");
  if (permission === "manage:estimates") return permissions.has("manage:issuedInvoices");
  return permissions.has(permission);
}

/** Role previews only. Use can(access, permission) for a signed-in person. */
export function canRole(role: UserRole, permission: string) {
  return hasPermission(new Set(rolePermissions[role]), permission);
}

export function can(user: UserAccess | null, permission: string) {
  return Boolean(user && hasPermission(effectivePermissions(user.role, user.featureAccess), permission));
}

export function defaultPathForRole(role: UserRole) {
  return {
    ADMIN: "/dashboard",
    ACCOUNTING: "/dashboard",
    CHIEF_DESIGNER: "/projects",
    PROJECT_MANAGER: "/projects",
    MAIL_EDITOR: "/mail-sorter",
    BILLING_EDITOR: "/issued-invoices",
    DESIGNER: "/projects",
    GUEST: "/guest-invoices",
  }[role];
}

export function roleLabel(role: UserRole) {
  return {
    ADMIN: "管理者",
    ACCOUNTING: "経理",
    CHIEF_DESIGNER: "主任",
    PROJECT_MANAGER: "担当",
    MAIL_EDITOR: "郵便物担当",
    BILLING_EDITOR: "請求書担当（日本）",
    DESIGNER: "担当補助",
    GUEST: "ゲスト",
  }[role];
}

export function assertCan(user: UserAccess | null, permission: string) {
  if (!can(user, permission)) throw new Error("権限がありません");
}

export function canAccessCompany(_user: Pick<User, "role">, company: CompanyScope) {
  return company === "JAPAN";
}

export function companyForUser(_user: Pick<User, "role">, _value?: string | null): CompanyScope {
  void _user;
  void _value;
  return "JAPAN";
}

export function assertCompanyAccess(user: Pick<User, "role">, company: CompanyScope) {
  if (!canAccessCompany(user, company)) throw new Error("日本版では日本のデータのみ操作できます");
}

export function canEditOptionGroup(user: UserAccess, group: string) {
  return can(user, "manage:clients") && (user.role !== "BILLING_EDITOR" || ["ISSUED_INVOICE_STATUS", "TAX_RATE"].includes(group));
}
