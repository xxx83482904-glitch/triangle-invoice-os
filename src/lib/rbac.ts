import type { User, UserRole } from "@/lib/types";
import { companyFromParam, type CompanyScope } from "@/lib/company";

const permissions = {
  ADMIN: [
    "view:documents",
    "view:dashboard",
    "view:projects",
    "view:mailSorter",
    "view:issuedInvoices",
    "view:receivedInvoices",
    "view:payments",
    "view:partners",
    "view:reports",
    "manage:users",
    "manage:settings",
    "manage:clients",
    "manage:vendors",
    "manage:projects",
    "manage:issuedInvoices",
    "manage:incomePayments",
    "manage:mailSorter",
    "manage:receivedInvoices",
    "manage:expensePayments",
    "export:csv",
    "undo:changes",
    "view:all",
  ],
  ACCOUNTING: [
    "view:documents",
    "view:dashboard",
    "view:projects",
    "view:mailSorter",
    "view:issuedInvoices",
    "view:receivedInvoices",
    "view:payments",
    "view:partners",
    "view:reports",
    "manage:clients",
    "manage:vendors",
    "manage:projects",
    "manage:issuedInvoices",
    "manage:incomePayments",
    "manage:mailSorter",
    "manage:receivedInvoices",
    "manage:expensePayments",
    "export:csv",
    "undo:changes",
    "view:all",
  ],
  CHIEF_DESIGNER: [
    "view:documents",
    "view:projects",
    "view:receivedInvoices",
    "view:assigned",
    "approve:receivedInvoices",
    "upload:receivedInvoices",
    "comment:project",
  ],
  PROJECT_MANAGER: [
    "view:documents",
    "view:projects",
    "view:issuedInvoices",
    "view:assigned",
    "manage:clients",
    "manage:projects",
    "manage:issuedInvoices",
    "comment:project",
  ],
  MAIL_EDITOR: ["view:documents", "view:mailSorter", "manage:mailSorter"],
  BILLING_EDITOR: ["view:issuedInvoices", "manage:issuedInvoices", "view:partners", "manage:clients", "create:invoiceProjects", "export:issuedInvoices"],
  DESIGNER: ["view:assigned", "upload:receivedInvoices", "comment:project"],
  GUEST: ["guest:createIssuedInvoices"],
} satisfies Record<UserRole, string[]>;

export function canRole(role: UserRole, permission: string) {
  if (permission === "manage:invoiceProjects") return permissions[role].includes("manage:projects") || permissions[role].includes("create:invoiceProjects");
  if (permission === "view:estimates") return permissions[role].includes("view:issuedInvoices");
  if (permission === "manage:estimates") return permissions[role].includes("manage:issuedInvoices");
  return permissions[role].includes(permission);
}

export function can(user: Pick<User, "role"> | null, permission: string) {
  if (!user) return false;
  return canRole(user.role, permission);
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

export function assertCan(user: Pick<User, "role"> | null, permission: string) {
  if (!can(user, permission)) throw new Error("権限がありません");
}

export function canAccessCompany(user: Pick<User, "role">, company: CompanyScope) {
  return user.role !== "BILLING_EDITOR" || company === "JAPAN";
}

export function companyForUser(user: Pick<User, "role">, value?: string | null): CompanyScope {
  return user.role === "BILLING_EDITOR" ? "JAPAN" : companyFromParam(value);
}

export function assertCompanyAccess(user: Pick<User, "role">, company: CompanyScope) {
  if (!canAccessCompany(user, company)) throw new Error("日本の発行請求書と関連取引先のみ操作できます");
}

export function canEditOptionGroup(user: Pick<User, "role">, group: string) {
  return can(user, "manage:clients") && (user.role !== "BILLING_EDITOR" || ["ISSUED_INVOICE_STATUS", "TAX_RATE"].includes(group));
}
