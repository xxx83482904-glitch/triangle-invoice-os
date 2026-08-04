"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, Building2, Ellipsis, FileText, LayoutGrid, Mail, ReceiptText, Users, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { companyFromParam, companyOptions, mailSorterCompany, type CompanyScope } from "@/lib/company";
import { canRole, defaultPathForRole } from "@/lib/rbac";
import type { UserRole } from "@/lib/types";

const nav = [
  { href: "/dashboard", label: "一覧", icon: LayoutGrid, permission: "view:dashboard" },
  { href: "/projects", label: "案件", icon: Building2, permission: "view:projects" },
  { href: "/mail-sorter", label: "郵便仕分け", icon: Mail, permission: "view:mailSorter" },
  { href: "/issued-invoices", label: "発行請求書", icon: FileText, permission: "view:issuedInvoices" },
  { href: "/received-invoices", label: "受領請求書", icon: ReceiptText, permission: "view:receivedInvoices" },
  { href: "/payments", label: "入金・支払い", icon: WalletCards, permission: "view:payments" },
  { href: "/partners", label: "取引先", icon: Users, permission: "view:partners" },
  { href: "/reports", label: "集計", icon: BarChart3, permission: "view:reports" },
];

function scopedHref(pathname: string, searchParams: { toString(): string }, company: CompanyScope) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("company", company);
  return `${pathname}?${params.toString()}`;
}

function navHref(href: string, company: CompanyScope) {
  return `${href}?company=${href === "/mail-sorter" ? mailSorterCompany : company}`;
}

function optionsForPath(pathname: string) {
  return pathname === "/mail-sorter" ? companyOptions.filter((option) => option.value === mailSorterCompany) : companyOptions;
}

export function CompanySwitch() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const options = optionsForPath(pathname);
  const company = pathname === "/mail-sorter" ? mailSorterCompany : companyFromParam(searchParams.get("company"));

  return (
    <div className={`grid ${options.length === 1 ? "grid-cols-1" : "grid-cols-2"} gap-2 rounded-xl border bg-muted/30 p-1`}>
      {options.map((option) => (
        <Button
          key={option.value}
          asChild
          size="xs"
          variant={company === option.value ? "default" : "ghost"}
          className="h-8 w-full rounded-lg px-2 text-xs"
        >
          <Link href={scopedHref(pathname, searchParams, option.value)}>{option.shortLabel}</Link>
        </Button>
      ))}
    </div>
  );
}

export function MobileCompanySwitch() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const options = optionsForPath(pathname);
  const company = pathname === "/mail-sorter" ? mailSorterCompany : companyFromParam(searchParams.get("company"));

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
          <Link href={scopedHref(pathname, searchParams, option.value)}>{option.shortLabel}</Link>
        </Button>
      ))}
    </div>
  );
}

export function MobileAppNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const company = companyFromParam(searchParams.get("company"));
  const allowedNav = nav.filter((item) => canRole(role, item.permission));
  const primaryHrefs = ["/dashboard", "/projects", "/mail-sorter", "/received-invoices"];
  const primaryItems = primaryHrefs
    .map((href) => allowedNav.find((item) => item.href === href))
    .filter((item): item is (typeof nav)[number] => Boolean(item));
  const moreItems = allowedNav.filter((item) => !primaryHrefs.includes(item.href));
  const moreActive = moreItems.some((item) => pathname === item.href);

  return (
    <nav className={`grid h-16 ${moreItems.length ? "grid-cols-5" : "grid-cols-4"} items-stretch gap-1 px-2 py-1.5`}>
      {primaryItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={navHref(item.href, company)}
            title={item.label}
            className={`flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 transition ${
              active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="max-w-full truncate text-[10px] leading-tight">{item.label}</span>
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
          <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-44">
            {moreItems.map((item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem key={item.href} asChild>
                  <Link href={navHref(item.href, company)} className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {item.label}
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
  const company = companyFromParam(searchParams.get("company"));

  return (
    <nav className="flex w-full flex-col gap-1">
      {nav.filter((item) => canRole(role, item.permission)).map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={navHref(item.href, company)}
            title={item.label}
            className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm transition ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="min-w-0 truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function ScopedBrandLink({ compact = false, role }: { compact?: boolean; role: UserRole }) {
  const searchParams = useSearchParams();
  const company = companyFromParam(searchParams.get("company"));
  const href = defaultPathForRole(role);

  return (
    <Link href={navHref(href, company)} className={compact ? "font-semibold" : "flex items-center gap-3 rounded-xl px-1"}>
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
