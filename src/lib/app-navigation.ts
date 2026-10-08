import { companyForUser, canRole } from "@/lib/rbac";
import type { CompanyScope } from "@/lib/company";
import type { UserRole } from "@/lib/types";

export const appNavigation = [
  { label: "全体", items: [
    { href: "/dashboard", label: "ダッシュボード", permission: "view:dashboard" },
    { href: "/documents", label: "全書類", permission: "view:documents" },
  ] },
  { label: "案件・書類", items: [
    { href: "/projects", label: "案件", permission: "view:projects" },
    { href: "/estimates", label: "見積書", permission: "view:estimates" },
    { href: "/issued-invoices", label: "発行請求書", permission: "view:issuedInvoices" },
    { href: "/mail-sorter", label: "郵便仕分け", permission: "view:mailSorter" },
    { href: "/received-invoices", label: "受領請求書", permission: "view:receivedInvoices" },
  ] },
  { label: "入出金・分析", items: [
    { href: "/banking", label: "口座・カード明細", permission: "view:banking" },
    { href: "/payments", label: "入金・支払い", permission: "view:payments" },
    { href: "/reports", label: "集計", permission: "view:reports" },
  ] },
  { label: "管理", items: [
    { href: "/partners", label: "取引先", permission: "view:partners" },
    { href: "/users", label: "利用者管理", permission: "manage:users" },
  ] },
];

export function navigationGroups(role: UserRole) {
  return appNavigation.map((group) => ({ ...group, items: group.items.filter((item) => canRole(role, item.permission)) })).filter((group) => group.items.length);
}

export function navigationActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function navigationCompany(role: UserRole, value: string | null): CompanyScope {
  return role === "MAIL_EDITOR" ? "JAPAN" : companyForUser({ role }, value);
}

export function mobileNavigation(role: UserRole) {
  const items = navigationGroups(role).flatMap((group) => group.items);
  const preferred = role === "BILLING_EDITOR" ? ["/issued-invoices", "/estimates", "/partners"]
    : role === "MAIL_EDITOR" ? ["/mail-sorter", "/documents"]
      : role === "ADMIN" || role === "ACCOUNTING" ? ["/mail-sorter", "/issued-invoices", "/banking", "/documents"]
        : ["/projects", "/issued-invoices", "/received-invoices", "/documents"];
  return { primary: preferred.flatMap((href) => items.filter((item) => item.href === href)), more: items.filter((item) => !preferred.includes(item.href)) };
}

export function workflowNavigation(pathname: string, params: URLSearchParams, role: UserRole) {
  const company = navigationCompany(role, params.get("company"));
  const sales = ["/projects", "/estimates", "/issued-invoices"];
  const receiving = ["/mail-sorter", "/received-invoices"];
  const bank = pathname === "/banking" || pathname.startsWith("/banking/");
  const paths = sales.some((path) => navigationActive(pathname, path)) ? sales : receiving.includes(pathname) ? receiving : [];
  const items = bank ? [
    { href: "/banking", label: "明細", permission: "view:banking" },
    { href: "/banking/reconcile", label: "銀行・書類照合", permission: "manage:banking" },
    { href: "/banking/reconcile?view=checks", label: "AI・確認事項", permission: "manage:banking" },
    { href: "/banking/insights", label: "出金の傾向", permission: "view:banking" },
    { href: "/banking/forecast", label: "資金予測", permission: "view:banking" },
  ] : appNavigation.flatMap((group) => group.items).filter((item) => paths.includes(item.href)).sort((a, b) => paths.indexOf(a.href) - paths.indexOf(b.href));
  return items.filter((item) => canRole(role, item.permission)).map((item) => {
    const [path, search] = item.href.split("?"), target = new URLSearchParams(search);
    target.set("company", path === "/mail-sorter" ? "JAPAN" : company);
    const checks = target.get("view") === "checks";
    if (bank) {
      if (["/banking", "/banking/insights", "/banking/forecast"].includes(path) && params.get("account")) target.set("account", params.get("account")!);
      const month = params.get("month") || params.get("checkMonth");
      if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && (checks || path !== "/banking/forecast" && path !== "/banking/reconcile")) target.set(checks ? "checkMonth" : "month", month);
    }
    const active = bank ? pathname === path && (path !== "/banking/reconcile" || (params.get("view") === "checks") === checks) : navigationActive(pathname, path);
    return { label: item.label, href: `${path}?${target}`, active };
  });
}
