import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { AppNav, CompanySwitch, MobileCompanySwitch, ScopedBrandLink } from "@/components/app/company-switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getCurrentUser } from "@/lib/auth";
import { roleLabel } from "@/lib/rbac";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "GUEST") redirect("/guest-invoices");

  return (
    <div className="min-h-screen bg-muted/20">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r bg-background px-4 py-5 lg:block">
        <ScopedBrandLink />
        <Separator className="my-4" />
        <CompanySwitch />
        <Separator className="my-4" />
        <AppNav />
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
          <ScopedBrandLink compact />
          <MobileCompanySwitch />
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
