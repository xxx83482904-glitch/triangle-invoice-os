import { redirect } from "next/navigation";
import { HelpCircle, LogOut, Search } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { AppNav, CompanySwitch, MobileCompanySwitch, ScopedBrandLink } from "@/components/app/company-switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/rbac";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "GUEST") redirect("/guest-invoices");

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[96px] border-r bg-sidebar px-5 py-7 lg:flex lg:flex-col lg:items-center">
        <ScopedBrandLink />
        <div className="mt-12 w-full">
          <CompanySwitch />
        </div>
        <div className="mt-8">
          <AppNav />
        </div>
        <div className="mt-auto flex w-full flex-col items-center gap-5">
          <form action={logoutAction}>
            <Button variant="ghost" size="icon" className="h-11 w-11 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent" title="ログアウト">
              <LogOut className="h-5 w-5" />
              <span className="sr-only">ログアウト</span>
            </Button>
          </form>
          <div className="flex flex-col items-center gap-2">
            <Avatar className="h-10 w-10 ring-4 ring-primary/10">
              <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="max-w-[72px] truncate text-center text-[10px] text-muted-foreground" title={`${user.name} / ${roleLabel(user.role)}`}>
              {roleLabel(user.role)}
            </div>
          </div>
        </div>
      </aside>
      <div className="lg:pl-[96px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <ScopedBrandLink compact />
          <MobileCompanySwitch />
        </header>
        <main className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-7 lg:px-10">{children}</main>
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
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="hidden h-10 w-[min(360px,32vw)] items-center gap-3 rounded-lg border bg-card px-4 text-muted-foreground shadow-sm xl:flex">
          <Search className="h-4 w-4 text-foreground" />
          <span className="text-xs">Search</span>
        </div>
        {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
        <Button variant="outline" size="icon" className="h-10 w-10 rounded-full bg-card">
          <HelpCircle className="h-4 w-4" />
          <span className="sr-only">ヘルプ</span>
        </Button>
      </div>
    </div>
  );
}
