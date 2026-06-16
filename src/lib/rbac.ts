import type { User, UserRole } from "@/lib/types";

const permissions = {
  ADMIN: [
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
    "view:projects",
    "view:receivedInvoices",
    "view:assigned",
    "approve:receivedInvoices",
    "upload:receivedInvoices",
    "comment:project",
  ],
  PROJECT_MANAGER: [
    "view:projects",
    "view:issuedInvoices",
    "view:assigned",
    "manage:clients",
    "manage:projects",
    "manage:issuedInvoices",
    "comment:project",
  ],
  MAIL_EDITOR: ["view:mailSorter", "manage:mailSorter"],
  DESIGNER: ["view:assigned", "upload:receivedInvoices", "comment:project"],
  GUEST: ["guest:createIssuedInvoices"],
} satisfies Record<UserRole, string[]>;

export function canRole(role: UserRole, permission: string) {
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
    DESIGNER: "担当補助",
    GUEST: "ゲスト",
  }[role];
}

export function assertCan(user: Pick<User, "role"> | null, permission: string) {
  if (!can(user, permission)) throw new Error("権限がありません");
}
