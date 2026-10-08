"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, Building2, Ellipsis, FileText, Files, LayoutGrid, LoaderCircle, Mail, ReceiptText, Users, UserCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { companyFromParam, companyOptions, mailSorterCompany, type CompanyScope } from "@/lib/company";
import { companyForUser, defaultPathForRole } from "@/lib/rbac";
import { mobileNavigation, navigationActive, navigationCompany, navigationGroups, workflowNavigation } from "@/lib/app-navigation";
import type { UserRole } from "@/lib/types";

const icons: Record<string, typeof Files> = {
  "/dashboard": LayoutGrid, "/documents": Files, "/projects": Building2, "/mail-sorter": Mail,
  "/issued-invoices": FileText, "/estimates": ReceiptText, "/received-invoices": ReceiptText,
  "/payments": WalletCards, "/banking": WalletCards, "/partners": Users, "/reports": BarChart3, "/users": UserCheck,
};

function scopedHref(pathname: string, searchParams: { toString(): string }, company: CompanyScope) {
  const params = new URLSearchParams(searchParams.toString());
  if (pathname.startsWith("/banking") && params.get("company") !== company) { params.delete("account"); params.delete("transaction"); params.delete("analysisThrough"); params.delete("invoice"); params.delete("page"); }
  params.set("company", company);
  return `${pathname}?${params.toString()}`;
}

function navHref(href: string, company: CompanyScope) {
  return `${href}?company=${href === "/mail-sorter" ? mailSorterCompany : company}`;
}

function optionsForPath(pathname: string, role?: UserRole) {
  return pathname === "/mail-sorter" || role === "MAIL_EDITOR" || role === "BILLING_EDITOR" ? companyOptions.filter((option) => option.value === mailSorterCompany) : companyOptions;
}

function NavLinkPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <LoaderCircle
      aria-hidden
      className={`h-3.5 w-3.5 shrink-0 animate-spin transition-opacity ${pending ? "opacity-100" : "opacity-0"} ${className}`}
    />
  );
}

export function CompanySwitch({ role }: { role?: UserRole }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const options = optionsForPath(pathname, role);
  const company = pathname === "/mail-sorter" ? mailSorterCompany : role ? companyForUser({ role }, searchParams.get("company")) : companyFromParam(searchParams.get("company"));

  return (
    <div aria-label="対象会社" className={`grid ${options.length === 1 ? "grid-cols-1" : "grid-cols-2"} gap-1 rounded-md border bg-muted/30 p-1`}>
      {options.map((option) => (
        <Button
          key={option.value}
          asChild
          size="xs"
          variant={company === option.value ? "default" : "ghost"}
          className="h-8 w-full rounded px-2 text-xs"
        >
          <Link href={scopedHref(pathname, searchParams, option.value)} aria-current={company === option.value ? "true" : undefined} prefetch={false}>{option.shortLabel}</Link>
        </Button>
      ))}
    </div>
  );
}

export function MobileCompanySwitch({ role }: { role?: UserRole }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const options = optionsForPath(pathname, role);
  const company = pathname === "/mail-sorter" ? mailSorterCompany : role ? companyForUser({ role }, searchParams.get("company")) : companyFromParam(searchParams.get("company"));

  return (
    <div className="flex gap-1">
      {options.map((option) => (
        <Button
          key={option.value}
          asChild
          size="xs"
          variant={company === option.value ? "default" : "outline"}
          className="px-2"
        >
          <Link href={scopedHref(pathname, searchParams, option.value)} prefetch={false}>{option.shortLabel}</Link>
        </Button>
      ))}
    </div>
  );
}

export function MobileAppNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const company = navigationCompany(role, searchParams.get("company"));
  const { primary: primaryItems, more: moreItems } = mobileNavigation(role);
  const moreActive = moreItems.some((item) => navigationActive(pathname, item.href));

  return (
    <nav aria-label="メインメニュー（モバイル）" style={{ gridTemplateColumns: `repeat(${Math.max(1, primaryItems.length + (moreItems.length ? 1 : 0))}, minmax(0, 1fr))` }} className="grid h-16 items-stretch gap-1 px-2 py-1.5">
      {primaryItems.map((item) => {
        const Icon = icons[item.href];
        const active = navigationActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={navHref(item.href, company)}
            prefetch={false}
            title={item.label}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 transition ${
              active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="max-w-full truncate text-[10px] leading-tight">{item.href === "/banking" ? "口座・カード" : item.label}</span>
            <NavLinkPending className="absolute right-1 top-1" />
          </Link>
        );
      })}
      {moreItems.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 transition ${
                moreActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Ellipsis className="h-4 w-4" />
              <span className="max-w-full truncate text-[10px] leading-tight">その他</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={8} className="max-h-[65dvh] w-56 overflow-y-auto">
            {moreItems.map((item) => {
              const Icon = icons[item.href];
              return (
                <DropdownMenuItem key={item.href} asChild>
                  <Link href={navHref(item.href, company)} prefetch={false} aria-current={navigationActive(pathname, item.href) ? "page" : undefined} className="flex min-h-11 items-center gap-2 aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary">
                    <Icon className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <NavLinkPending />
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}

export function AppNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const company = navigationCompany(role, searchParams.get("company"));

  return (
    <nav aria-label="メインメニュー" className="flex w-full flex-col gap-4 pb-3">
      {navigationGroups(role).map((group) => <div key={group.label}>
        <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">{group.label}</p>
        <div className="space-y-0.5">{group.items.map((item) => {
        const Icon = icons[item.href];
        const active = navigationActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={navHref(item.href, company)}
            prefetch={false}
            title={item.label}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-9 w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition focus-visible:outline-2 focus-visible:outline-ring ${
              active
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{item.label}</span>
            <NavLinkPending className="ml-auto" />
          </Link>
        );
      })}</div></div>)}
    </nav>
  );
}

export function WorkflowNav({ role }: { role: UserRole }) {
  const pathname = usePathname(), searchParams = useSearchParams();
  const items = workflowNavigation(pathname, new URLSearchParams(searchParams.toString()), role);
  if (items.length < 2) return null;
  return <nav aria-label="関連画面" className="mb-5 flex min-w-0 flex-wrap gap-x-4 border-b">
    {items.map((item) => <Link key={item.href} href={item.href} prefetch={false} aria-current={item.active ? "page" : undefined}
      className={`relative inline-flex min-h-11 items-center gap-1 border-b-2 px-1 text-sm transition focus-visible:outline-2 focus-visible:outline-ring ${item.active ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"}`}>
      {item.label}<NavLinkPending />
    </Link>)}
  </nav>;
}

export function ScopedBrandLink({ compact = false, role }: { compact?: boolean; role: UserRole }) {
  const searchParams = useSearchParams();
  const company = navigationCompany(role, searchParams.get("company"));
  const href = defaultPathForRole(role);

  return (
    <Link href={navHref(href, company)} prefetch={false} className={compact ? "font-semibold" : "flex items-center gap-3 rounded-xl px-1"}>
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-sm">T</div>
      {!compact ? (
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">TRIANGLE</div>
          <div className="truncate text-xs text-muted-foreground">Invoice OS</div>
        </div>
      ) : null}
    </Link>
  );
}
