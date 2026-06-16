"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, Building2, FileText, LayoutGrid, Mail, ReceiptText, Users, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { companyFromParam, companyOptions, type CompanyScope } from "@/lib/company";

const nav = [
  { href: "/dashboard", label: "一覧", icon: LayoutGrid },
  { href: "/projects", label: "案件", icon: Building2 },
  { href: "/mail-sorter", label: "郵便仕分け", icon: Mail },
  { href: "/issued-invoices", label: "発行請求書", icon: FileText },
  { href: "/received-invoices", label: "受領請求書", icon: ReceiptText },
  { href: "/payments", label: "入金・支払い", icon: WalletCards },
  { href: "/partners", label: "取引先", icon: Users },
  { href: "/reports", label: "集計", icon: BarChart3 },
];

function scopedHref(pathname: string, searchParams: { toString(): string }, company: CompanyScope) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("company", company);
  return `${pathname}?${params.toString()}`;
}

function navHref(href: string, company: CompanyScope) {
  return `${href}?company=${company}`;
}

export function CompanySwitch() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const company = companyFromParam(searchParams.get("company"));

  return (
    <div className="grid gap-2">
      {companyOptions.map((option) => (
        <Button
          key={option.value}
          asChild
          size="xs"
          variant={company === option.value ? "default" : "ghost"}
          className="h-7 w-full rounded-lg px-2 text-[10px]"
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
  const company = companyFromParam(searchParams.get("company"));

  return (
    <div className="flex gap-1">
      {companyOptions.map((option) => (
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

// #8: Desktop sidebar nav with tooltips
export function AppNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const company = companyFromParam(searchParams.get("company"));

  return (
    <nav className="flex flex-col items-center gap-3">
      {nav.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>
              <Link
                href={navHref(item.href, company)}
                className={`grid h-11 w-11 place-items-center rounded-lg transition ${
                  active
                    ? "bg-primary/15 text-sidebar-accent-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="sr-only">{item.label}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

// #9: Mobile bottom navigation bar
export function MobileNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const company = companyFromParam(searchParams.get("company"));

  // Show only the 5 most important items on mobile
  const mobileNav = nav.slice(0, 5);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t bg-background/95 backdrop-blur lg:hidden">
      {mobileNav.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={navHref(item.href, company)}
            className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] transition ${
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className={`h-5 w-5 ${active ? "text-primary" : ""}`} />
            <span className="leading-none">{item.label.length > 4 ? item.label.slice(0, 4) : item.label}</span>
          </Link>
        );
      })}
      {/* More menu link */}
      <Link
        href={navHref("/partners", company)}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition"
      >
        <Users className="h-5 w-5" />
        <span className="leading-none">その他</span>
      </Link>
    </nav>
  );
}

export function ScopedBrandLink({ compact = false }: { compact?: boolean }) {
  const searchParams = useSearchParams();
  const company = companyFromParam(searchParams.get("company"));

  return (
    <Link href={navHref("/dashboard", company)} className={compact ? "font-semibold" : "flex flex-col items-center gap-2"}>
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-sm">T</div>
      {!compact ? <div className="sr-only">TRIANGLE Invoice OS</div> : null}
    </Link>
  );
}
