"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { AppSearchButton } from "@/components/app/app-command-palette";
import { CompanySwitch, MobileCompanySwitch, ScopedBrandLink } from "@/components/app/company-switch";
import { navigationIcon } from "@/components/app/navigation-icon";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { UndoButton } from "@/components/app/undo-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { sidebarNavigation } from "@/lib/app-navigation";
import { canRole, roleLabel } from "@/lib/rbac";
import type { UserRole } from "@/lib/types";
import { cx } from "@/utils/cx";

const storageKey = "triangle-invoice-os-sidebar";
const iconButton = "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-tile focus-visible:outline-2 focus-visible:outline-ring";

export function AppSidebar({ name, role, canUndo }: { name: string; role: UserRole; canUndo: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const groups = sidebarNavigation(pathname, new URLSearchParams(params.toString()), role);
  const person = `${name} / ${roleLabel(role)}`;

  useEffect(() => {
    // Match the server's expanded shell before applying the browser preference.
    const frame = window.requestAnimationFrame(() => {
      try { setCollapsed(localStorage.getItem(storageKey) === "collapsed"); } catch { /* Storage may be unavailable. */ }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(storageKey, next ? "collapsed" : "expanded"); } catch { /* The current session still works without storage. */ }
  }

  return (
    <aside className="app-sidebar hidden shrink-0 flex-col lg:flex" data-collapsed={collapsed} aria-label="ワークスペース">
      <div className={cx("flex shrink-0 items-center gap-2", collapsed && "flex-col")}>
        <div className={cx("flex min-w-0 items-center gap-2", collapsed && "flex-col")}>
          <ScopedBrandLink compact role={role} />
          {collapsed ? (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={iconButton} title="対象会社" aria-label="対象会社"><Building2 className="size-4" aria-hidden /></button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-48 p-2"><CompanySwitch role={role} /></PopoverContent>
            </Popover>
          ) : (
            <div className="min-w-0">
              <p className="text-body-medium text-text-primary">TRIANGLE</p>
              <MobileCompanySwitch role={role} />
            </div>
          )}
        </div>
        <div className={cx("flex shrink-0 items-center", collapsed ? "flex-col gap-1" : "ml-auto")}>
          <ThemeToggle compact />
          <button
            type="button"
            className={iconButton}
            onClick={toggleCollapsed}
            title={collapsed ? "メニューを開く" : "メニューを畳む"}
            aria-label={collapsed ? "メニューを開く" : "メニューを畳む"}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar-nav"
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
          </button>
        </div>
      </div>

      <div className={cx("mt-3 shrink-0", collapsed && "flex justify-center")}><AppSearchButton compact={collapsed} /></div>

      <nav id="app-sidebar-nav" aria-label="メインメニュー" className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2 [scrollbar-width:thin]">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5 pt-3">
            {collapsed ? <span className="mx-auto mb-1 h-px w-6 bg-separator-border" aria-hidden /> : <p className="px-2 pb-1 text-caption-1-medium text-text-tertiary">{group.label}</p>}
            {group.items.map((item) => {
              const Icon = navigationIcon(item.icon);
              const selected = item.active && (!item.children || collapsed);
              const bankItem = item.href.split("?")[0] === "/banking/accounts";
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    aria-current={selected ? "page" : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cx(
                      "flex min-h-9 items-center gap-2 rounded-2lg p-2 text-body-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      collapsed && "justify-center",
                      selected ? "bg-primary text-primary-foreground" : "text-text-secondary hover:bg-tile hover:text-text-primary",
                      item.active && !selected && "bg-tile text-text-primary",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
                    {!collapsed && <><span className="flex-1 truncate">{item.label}</span>{bankItem && <ChevronDown className={cx("size-4 shrink-0", !item.children && "-rotate-90")} aria-hidden />}</>}
                  </Link>
                  {item.children && !collapsed && (
                    <div className="ms-[17px] mt-0.5 mb-1 flex flex-col gap-0.5 border-s border-separator-border ps-2">
                      {item.children.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          prefetch={false}
                          aria-current={child.active ? "page" : undefined}
                          className={cx(
                            "rounded-lg px-2 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                            child.active ? "bg-primary text-body-medium text-primary-foreground" : "text-body-regular text-text-secondary hover:bg-tile hover:text-text-primary",
                          )}
                        >{child.label}</Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={cx("flex shrink-0 items-center gap-2 border-t border-separator-border pt-3", collapsed && "flex-col")}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background-tertiary-default text-caption-1-medium text-text-primary" title={person} aria-label={collapsed ? person : undefined}>{Array.from(name)[0] || "利"}</span>
        {!collapsed && <div className="min-w-0 flex-1" title={person}><p className="truncate text-body-medium text-text-primary">{name}</p><p className="truncate text-caption-1-regular text-text-tertiary">{roleLabel(role)}</p></div>}
        {canRole(role, "undo:changes") && <UndoButton compact disabled={!canUndo} />}
        <form action={logoutAction}><Button variant="ghost" size="icon" className="size-9 rounded-lg" title={`${person} / ログアウト`} aria-label="ログアウト"><LogOut className="size-4" aria-hidden /></Button></form>
      </div>
    </aside>
  );
}
