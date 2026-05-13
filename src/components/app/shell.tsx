import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Building2,
  FileText,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { logoutAction } from "@/app/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getCurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/rbac";

const nav = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/projects", label: "案件", icon: Building2 },
  { href: "/issued-invoices", label: "発行請求書", icon: FileText },
  { href: "/received-invoices", label: "受領請求書", icon: ReceiptText },
  { href: "/payments", label: "入金・支払い", icon: WalletCards },
  { href: "/partners", label: "取引先", icon: ArrowDownToLine },
  { href: "/reports", label: "レポート", icon: BarChart3 },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r bg-background px-5 py-6 lg:block">
        <Link href="/dashboard" className="block">
          <div className="text-lg font-semibold tracking-tight">TRIANGLE Invoice OS</div>
          <div className="mt-1 text-xs text-muted-foreground">Project finance cockpit</div>
        </Link>
        <Separator className="my-5" />
        <nav className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Button key={item.href} asChild variant="ghost" className="w-full justify-start gap-3">
                <Link href={item.href}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="absolute bottom-5 left-5 right-5">
          <Separator className="mb-4" />
          <div className="mb-4 flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{roleLabel(user.role)}</div>
            </div>
          </div>
          <form action={logoutAction}>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2">
              <LogOut className="h-4 w-4" />
              ログアウト
            </Button>
          </form>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <Link href="/dashboard" className="font-semibold">
            TRIANGLE Invoice OS
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/issued-invoices">
              <ArrowUpFromLine className="mr-2 h-4 w-4" />
              請求
            </Link>
          </Button>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}
