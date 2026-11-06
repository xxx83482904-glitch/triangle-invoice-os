import { companyForUser, canRole } from "@/lib/rbac";
import { mailSorterCompany, type CompanyScope } from "@/lib/company";
import { navigationIconName } from "@/lib/navigation-icons";
import type { UserRole } from "@/lib/types";

export const appNavigation = [
  { label: "全体", items: [
    { href: "/dashboard", label: "ダッシュボード", permission: "view:dashboard" },
    { href: "/banking", label: "口座・カード", permission: "view:banking" },
    { href: "/documents", label: "全書類", permission: "view:documents" },
  ] },
  { label: "案件・書類", items: [
    { href: "/projects", label: "案件", permission: "view:projects" },
    { href: "/estimates", label: "見積書", permission: "view:estimates" },
    { href: "/issued-invoices", label: "発行請求書", permission: "view:issuedInvoices" },
    { href: "/mail-sorter", label: "郵便仕分け", permission: "view:mailSorter" },
    { href: "/received-invoices", label: "受領請求書", permission: "view:receivedInvoices" },
    { href: "/imports", label: "輸入", permission: "view:imports" },
  ] },
  { label: "入出金・分析", items: [
    { href: "/payments", label: "入金・支払い", permission: "view:payments" },
    { href: "/expenses", label: "経費精算", permission: "submit:expenses" },
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

export function navHref(href: string, company: CompanyScope) {
  return `${href === "/banking" ? "/banking/accounts" : href}?company=${href === "/mail-sorter" ? mailSorterCompany : company}`;
}

export type SidebarNavigationItem = {
  label: string;
  href: string;
  icon: string;
  active: boolean;
  children?: SidebarNavigationItem[];
};

export function sidebarNavigation(pathname: string, params: URLSearchParams, role: UserRole) {
  const company = navigationCompany(role, params.get("company"));
  const bank = navigationActive(pathname, "/banking");
  return navigationGroups(role).map((group) => ({
    label: group.label,
    items: group.items.map((item): SidebarNavigationItem => ({
      label: item.label,
      href: navHref(item.href, company),
      icon: navigationIconName(item.href),
      active: navigationActive(pathname, item.href),
      ...(item.href === "/banking" && bank ? {
        children: workflowNavigation(pathname, params, role).map((child) => ({
          ...child,
          icon: navigationIconName(child.href),
        })),
      } : {}),
    })),
  }));
}

export function commandNavigation(pathname: string, params: URLSearchParams, role: UserRole) {
  // The palette exposes bank screens even when the sidebar branch is closed.
  const groups = sidebarNavigation(navigationActive(pathname, "/banking") ? pathname : "/banking", params, role);
  return groups.flatMap((group) => group.items.flatMap((item) =>
    (item.children ?? [item]).map(({ label, href, icon }) => ({ label, href, icon, group: item.children ? item.label : group.label })),
  ));
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
  const receiving = ["/mail-sorter", "/received-invoices", "/imports"];
  const bank = pathname === "/banking" || pathname.startsWith("/banking/");
  const paths = sales.some((path) => navigationActive(pathname, path)) ? sales : receiving.some((path) => navigationActive(pathname, path)) ? receiving : [];
  const items = bank ? [
    { href: "/banking/accounts", label: "口座一覧", permission: "view:banking" },
    { href: "/banking", label: "明細", permission: "view:banking" },
    { href: "/banking/reconcile", label: "銀行・書類照合", permission: "manage:banking" },
    { href: "/banking/reconcile?view=checks", label: "AI・確認事項", permission: "manage:banking" },
    { href: "/banking/insights", label: "出金の傾向", permission: "view:banking" },
    { href: "/banking/forecast", label: "資金予測", permission: "view:banking" },
    { href: "/banking/payroll", label: "給与一覧", permission: "view:banking" },
    { href: "/banking/obligations", label: "税金・保険", permission: "view:banking" },
    { href: "/banking/integrity", label: "整合性", permission: "view:banking" },
  ] : appNavigation.flatMap((group) => group.items).filter((item) => paths.includes(item.href)).sort((a, b) => paths.indexOf(a.href) - paths.indexOf(b.href));
  return items.filter((item) => canRole(role, item.permission)).map((item) => {
    const [path, search] = item.href.split("?"), target = new URLSearchParams(search);
    target.set("company", path === "/mail-sorter" ? "JAPAN" : company);
    const checks = target.get("view") === "checks";
    if (bank) {
      if (["/banking", "/banking/insights", "/banking/forecast", "/banking/payroll", "/banking/obligations", "/banking/integrity"].includes(path) && params.get("account")) target.set("account", params.get("account")!);
      const month = params.get("month") || params.get("checkMonth");
      if (path !== "/banking/accounts" && month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && (checks || path !== "/banking/forecast" && path !== "/banking/reconcile")) target.set(checks ? "checkMonth" : "month", month);
    }
    const active = bank ? pathname === path && (path !== "/banking/reconcile" || (params.get("view") === "checks") === checks) : navigationActive(pathname, path);
    return { label: item.label, href: `${path}?${target}`, active };
  });
}
