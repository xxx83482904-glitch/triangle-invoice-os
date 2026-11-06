// Icon names only, so tests can check the map without loading lucide-react; the shell resolves names to components.
export const navigationIconNames: Record<string, string> = {
  "/dashboard": "LayoutGrid", "/documents": "Files", "/projects": "Building2", "/mail-sorter": "Mail",
  "/issued-invoices": "FileText", "/estimates": "ReceiptText", "/received-invoices": "ReceiptText", "/imports": "Ship",
  "/payments": "WalletCards", "/expenses": "Receipt", "/banking": "WalletCards", "/partners": "Users", "/reports": "BarChart3", "/users": "UserCheck",
  "/banking/accounts": "Landmark", "/banking/reconcile": "Link2", "/banking/reconcile?view=checks": "ListChecks",
  "/banking/insights": "BarChart3", "/banking/forecast": "ChartNoAxesCombined", "/banking/payroll": "Users",
  "/banking/obligations": "ReceiptText", "/banking/integrity": "ShieldCheck",
};

export function navigationIconName(href: string) {
  const [path, search] = href.split("?");
  const key = path === "/banking/reconcile" && new URLSearchParams(search).get("view") === "checks" ? `${path}?view=checks` : path;
  return navigationIconNames[key];
}
