import type { User, UserRole } from "@/lib/types";

const permissions = {
  ADMIN: [
    "manage:users",
    "manage:settings",
    "manage:clients",
    "manage:vendors",
    "manage:projects",
    "manage:issuedInvoices",
    "manage:incomePayments",
    "manage:receivedInvoices",
    "manage:expensePayments",
    "export:csv",
    "view:all",
  ],
  ACCOUNTING: [
    "manage:clients",
    "manage:vendors",
    "manage:projects",
    "manage:issuedInvoices",
    "manage:incomePayments",
    "manage:receivedInvoices",
    "manage:expensePayments",
    "export:csv",
    "view:all",
  ],
  CHIEF_DESIGNER: [
    "view:assigned",
    "approve:receivedInvoices",
    "upload:receivedInvoices",
    "comment:project",
  ],
  PROJECT_MANAGER: [
    "view:assigned",
    "approve:receivedInvoices",
    "upload:receivedInvoices",
    "comment:project",
  ],
  DESIGNER: ["view:assigned", "upload:receivedInvoices", "comment:project"],
} satisfies Record<UserRole, string[]>;

export function can(user: Pick<User, "role"> | null, permission: string) {
  if (!user) return false;
  return permissions[user.role].includes(permission);
}

export function roleLabel(role: UserRole) {
  return {
    ADMIN: "Admin",
    ACCOUNTING: "Accounting",
    CHIEF_DESIGNER: "Chief Designer",
    PROJECT_MANAGER: "Project Manager",
    DESIGNER: "Designer",
  }[role];
}

export function assertCan(user: Pick<User, "role"> | null, permission: string) {
  if (!can(user, permission)) throw new Error("権限がありません");
}
