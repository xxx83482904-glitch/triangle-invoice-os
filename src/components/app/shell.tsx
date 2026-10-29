import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { DesktopAppNav, MobileAppNav, MobileCompanySwitch, ScopedBrandLink, WorkflowNav } from "@/components/app/company-switch";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UndoButton } from "@/components/app/undo-button";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { can, roleLabel } from "@/lib/rbac";
import { readDataForRequest as readData } from "@/lib/store";

export async function AppShell({ children, banking = false }: { children: React.ReactNode; banking?: boolean }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "GUEST") redirect("/guest-invoices");
  const canUndoChanges = can(user, "undo:changes");
  const data = canUndoChanges ? await readData() : null;
  const canUndo = Boolean(data?.auditLogs.some((log) => log.action !== "UNDO_ACTION" && !log.undoneAt && log.beforeStateJson));

  return (
    <div className={`workspace-shell min-h-screen bg-background ${banking ? "banking-ledger-shell" : ""}`}>
      <a href="#main-content" className="sr-only fixed left-3 top-3 z-50 rounded-md bg-background p-3 text-sm focus:not-sr-only">本文へ移動</a>
      <header className="workspace-desktop-header hidden items-center gap-3 border-b px-5 lg:flex">
        <ScopedBrandLink role={user.role} />
        <MobileCompanySwitch role={user.role} />
        <DesktopAppNav role={user.role} />
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle compact />
          {canUndoChanges ? <UndoButton compact disabled={!canUndo} /> : null}
          <form action={logoutAction}><Button variant="ghost" size="icon" title={`${user.name} / ${roleLabel(user.role)} / ログアウト`} aria-label="ログアウト"><LogOut className="size-4" /></Button></form>
        </div>
      </header>
      <div>
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur lg:hidden">
          <ScopedBrandLink compact role={user.role} />
          <div className="flex min-w-0 items-center gap-2">
            <MobileCompanySwitch role={user.role} />
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
        <main id="main-content" tabIndex={-1} className={`workspace-main mx-auto w-full px-3 py-3 pb-28 outline-none lg:px-5 lg:pb-8 ${banking ? "banking-main" : ""}`}>{!banking ? <WorkflowNav role={user.role} compact /> : null}{children}</main>
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
    <div className="workspace-page-header mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b py-3">
      <div className="min-w-0">
        <h1 className="break-words text-xl font-semibold tracking-normal">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? (
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2 md:max-w-[60%]">
          <div className="flex min-w-0 flex-wrap gap-2">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
