import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { AppNav, CompanySwitch, MobileAppNav, MobileCompanySwitch, ScopedBrandLink } from "@/components/app/company-switch";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UndoButton } from "@/components/app/undo-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { can, roleLabel } from "@/lib/rbac";
import { readDataForRequest as readData } from "@/lib/store";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "GUEST") redirect("/guest-invoices");
  const canUndoChanges = can(user, "undo:changes");
  const data = canUndoChanges ? await readData() : null;
  const canUndo = Boolean(data?.auditLogs.some((log) => log.action !== "UNDO_ACTION" && !log.undoneAt && log.beforeStateJson));

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r bg-background px-4 py-5 lg:flex lg:flex-col">
        <ScopedBrandLink role={user.role} />
        <div className="mt-6 w-full">
          <CompanySwitch />
        </div>
        <div className="mt-6 w-full">
          <AppNav role={user.role} />
        </div>
        <div className="mt-auto w-full space-y-2">
          <ThemeToggle />
          {canUndoChanges ? <UndoButton disabled={!canUndo} /> : null}
          <div className="flex w-full items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar className="h-10 w-10 ring-4 ring-primary/10">
                <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{user.name}</div>
                <div className="truncate text-xs text-muted-foreground" title={`${user.name} / ${roleLabel(user.role)}`}>
                  {roleLabel(user.role)}
                </div>
              </div>
            </div>
            <form action={logoutAction}>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" title="ログアウト">
                <LogOut className="h-5 w-5" />
                <span className="sr-only">ログアウト</span>
              </Button>
            </form>
          </div>
        </div>
      </aside>
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <ScopedBrandLink compact role={user.role} />
          <div className="flex min-w-0 items-center gap-2">
            <MobileCompanySwitch />
            <ThemeToggle compact />
            {canUndoChanges ? <UndoButton compact disabled={!canUndo} /> : null}
            <form action={logoutAction}>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" title="ログアウト">
                <LogOut className="h-4 w-4" />
                <span className="sr-only">ログアウト</span>
              </Button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1760px] px-3 py-4 pb-24 sm:px-7 sm:py-6 lg:px-8 lg:pb-6">{children}</main>
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
          <MobileAppNav role={user.role} />
        </div>
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
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border bg-card px-4 py-4 shadow-sm sm:mb-6 sm:px-5 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-wrap gap-2">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
