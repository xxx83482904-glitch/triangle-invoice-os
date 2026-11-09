import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { MobileAppNav, MobileCompanySwitch, ScopedBrandLink, WorkflowNav } from "@/components/app/company-switch";
import { AppSidebar } from "@/components/app/app-sidebar";
import { AppCommandPaletteProvider, AppSearchButton } from "@/components/app/app-command-palette";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UndoButton } from "@/components/app/undo-button";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { readDataForRequest as readData } from "@/lib/store";

export async function AppShell({ children, banking = false }: { children: React.ReactNode; banking?: boolean }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "GUEST") redirect("/guest-invoices");
  const access = { role: user.role, featureAccess: user.featureAccess };
  const canUndoChanges = can(user, "undo:changes");
  const data = canUndoChanges ? await readData() : null;
  const canUndo = Boolean(data?.auditLogs.some((log) => log.action !== "UNDO_ACTION" && !log.undoneAt && log.beforeStateJson));

  return (
    <AppCommandPaletteProvider access={access}>
      <div className={`workspace-shell min-h-screen bg-background ${banking ? "banking-ledger-shell" : ""}`}>
        <a href="#main-content" className="sr-only fixed left-3 top-3 z-50 rounded-md bg-background p-3 text-sm focus:not-sr-only">本文へ移動</a>
        <AppSidebar name={user.name} access={access} canUndo={canUndo} />
        <div className="workspace-content">
          <header className="workspace-mobile-header sticky top-0 z-20 flex h-14 items-center justify-between border-b px-4 backdrop-blur lg:hidden">
            <ScopedBrandLink compact access={access} />
            <div className="flex min-w-0 items-center gap-2">
              <MobileCompanySwitch role={user.role} />
              <AppSearchButton compact />
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
          <main id="main-content" tabIndex={-1} className={`workspace-main mx-auto w-full px-3 py-3 pb-28 outline-none lg:px-8 lg:py-6 ${banking ? "banking-main" : ""}`}>{!banking ? <WorkflowNav access={access} compact /> : null}{children}</main>
          <div className="workspace-mobile-nav fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
            <MobileAppNav access={access} />
          </div>
        </div>
      </div>
    </AppCommandPaletteProvider>
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
    <div className="workspace-page-header flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="break-words text-[20px] font-medium">{title}</h1>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children ? (
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2 md:max-w-[60%]">
          <div className="flex min-w-0 flex-wrap gap-2">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
