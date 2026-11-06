"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Ellipsis, LoaderCircle } from "lucide-react";
import { navigationIcon } from "@/components/app/navigation-icon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { companyFromParam, companyOptions, mailSorterCompany, type CompanyScope } from "@/lib/company";
import { companyForUser, defaultPathForRole } from "@/lib/rbac";
import { mobileNavigation, navHref, navigationActive, navigationCompany, workflowNavigation } from "@/lib/app-navigation";
import type { UserRole } from "@/lib/types";

function scopedHref(pathname: string, searchParams: { toString(): string }, company: CompanyScope) {
  const params = new URLSearchParams(searchParams.toString());
  if (pathname.startsWith("/banking") && params.get("company") !== company) { params.delete("account"); params.delete("transaction"); params.delete("analysisThrough"); params.delete("invoice"); params.delete("page"); }
  params.set("company", company);
  return `${pathname}?${params.toString()}`;
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
        const Icon = navigationIcon(item.href);
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
            <span className="max-w-full truncate text-[10px] leading-tight">{item.label}</span>
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
              const Icon = navigationIcon(item.href);
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

export function WorkflowNav({ role, compact = false }: { role: UserRole; compact?: boolean }) {
  const pathname = usePathname(), searchParams = useSearchParams();
  const items = workflowNavigation(pathname, new URLSearchParams(searchParams.toString()), role);
  if (items.length < 2) return null;
  return <nav aria-label="関連画面" className={`${compact ? "" : "mb-6"} flex min-w-0 flex-wrap gap-1 rounded-xl bg-muted p-1 lg:hidden`}>
    {items.map((item) => <Link key={item.href} href={item.href} prefetch={false} aria-current={item.active ? "page" : undefined}
      className={`relative inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm transition lg:min-h-9 focus-visible:outline-2 focus-visible:outline-ring ${item.active ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/60 hover:text-foreground"}`}>
      {item.label}<NavLinkPending />
    </Link>)}
  </nav>;
}

export function ScopedBrandLink({ compact = false, role }: { compact?: boolean; role: UserRole }) {
  const searchParams = useSearchParams();
  const company = navigationCompany(role, searchParams.get("company"));
  const href = defaultPathForRole(role);

  return (
    <Link href={navHref(href, company)} prefetch={false} aria-label="TRIANGLE Invoice OS" title={compact ? "TRIANGLE Invoice OS" : undefined} className={compact ? "font-medium" : "flex items-center gap-3 rounded-xl px-1"}>
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
