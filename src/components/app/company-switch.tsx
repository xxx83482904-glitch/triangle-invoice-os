"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, Building2, FileText, ReceiptText, Users, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { companyFromParam, companyOptions, type CompanyScope } from "@/lib/company";

const nav = [
  { href: "/dashboard", label: "一覧", icon: Building2 },
  { href: "/projects", label: "案件", icon: Building2 },
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
    <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1">
      {companyOptions.map((option) => (
        <Button
          key={option.value}
          asChild
          size="sm"
          variant={company === option.value ? "default" : "ghost"}
          className="h-8 px-2 text-xs"
        >
          <Link href={scopedHref(pathname, searchParams, option.value)}>{option.label}</Link>
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

export function AppNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const company = companyFromParam(searchParams.get("company"));

  return (
    <nav className="space-y-1">
      {nav.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Button
            key={item.href}
            asChild
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className="w-full justify-start gap-2"
          >
            <Link href={navHref(item.href, company)}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

export function ScopedBrandLink({ compact = false }: { compact?: boolean }) {
  const searchParams = useSearchParams();
  const company = companyFromParam(searchParams.get("company"));

  return (
    <Link href={navHref("/dashboard", company)} className={compact ? "font-semibold" : "block"}>
      <div className="text-base font-semibold tracking-tight">TRIANGLE Invoice OS</div>
      {!compact ? <div className="mt-1 text-xs text-muted-foreground">案件別のお金一覧</div> : null}
    </Link>
  );
}
