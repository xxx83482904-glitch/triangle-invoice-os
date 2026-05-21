import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Building2, FileText, LogOut, ReceiptText, Users, WalletCards } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getCurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/rbac";

const nav = [
  { href: "/dashboard", label: "一覧", icon: Building2 },
  { href: "/projects", label: "案件", icon: Building2 },
  { href: "/issued-invoices", label: "発行請求書", icon: FileText },
  { href: "/received-invoices", label: "受領請求書", icon: ReceiptText },
  { href: "/payments", label: "入金・支払い", icon: WalletCards },
  { href: "/partners", label: "取引先", icon: Users },
  { href: "/reports", label: "集計", icon: BarChart3 },
];

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "GUEST") redirect("/guest-invoices");

  return (
    <div className="min-h-screen bg-muted/20">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r bg-background px-4 py-5 lg:block">
        <Link href="/dashboard" className="block">
          <div className="text-base font-semibold tracking-tight">TRIANGLE Invoice OS</div>
          <div className="mt-1 text-xs text-muted-foreground">案件別のお金一覧</div>
        </Link>
        <Separator className="my-4" />
        <nav className="space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Button key={item.href} asChild variant="ghost" size="sm" className="w-full justify-start gap-2">
                <Link href={item.href}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="absolute bottom-4 left-4 right-4">
          <Separator className="mb-4" />
          <div className="mb-3 flex items-center gap-3">
            <Avatar className="h-8 w-8">
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
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <Link href="/dashboard" className="font-semibold">
            TRIANGLE Invoice OS
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">一覧</Link>
          </Button>
        </header>
        <main className="mx-auto w-full max-w-[1800px] px-4 py-5 sm:px-6 lg:px-6">{children}</main>
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
    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}
