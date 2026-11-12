"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect, useSyncExternalStore } from "react";
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
import { can, roleLabel, type UserAccess } from "@/lib/rbac";
import { sidebarAttribute, sidebarMediaQuery, sidebarStorageKey } from "@/lib/sidebar-preference";
import { cx } from "@/utils/cx";

const iconButton = "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-tile focus-visible:outline-2 focus-visible:outline-ring";

function sidebarExpanded() {
  const preference = sidebarAttribute(document.documentElement.getAttribute("data-sidebar"));
  return preference === "expanded" || (preference === null && window.matchMedia(sidebarMediaQuery).matches);
}

function subscribeSidebar(listener: () => void) {
  const media = window.matchMedia(sidebarMediaQuery);
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-sidebar"] });
  media.addEventListener("change", listener);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", listener);
  };
}

export function AppSidebar({ name, access, canUndo }: { name: string; access: UserAccess; canUndo: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const expanded = useSyncExternalStore(subscribeSidebar, sidebarExpanded, () => false);
  const groups = sidebarNavigation(pathname, new URLSearchParams(params.toString()), access);
  const person = `${name} / ${roleLabel(access.role)}`;

  useLayoutEffect(() => {
    // Development remounts can clear the attribute set before paint.
    if (sidebarAttribute(document.documentElement.getAttribute("data-sidebar"))) return;
    try {
      const saved = sidebarAttribute(window.localStorage.getItem(sidebarStorageKey));
      if (saved) document.documentElement.setAttribute("data-sidebar", saved);
    } catch { /* Storage may be unavailable. */ }
  }, []);

  function toggleCollapsed() {
    const next = sidebarExpanded() ? "collapsed" : "expanded";
    document.documentElement.setAttribute("data-sidebar", next);
    try { window.localStorage.setItem(sidebarStorageKey, next); } catch { /* The current session still works without storage. */ }
  }

  return (
    <aside className="app-sidebar hidden shrink-0 flex-col lg:flex" aria-label="ワークスペース">
      <div className="app-sidebar-row flex shrink-0 items-center gap-2">
        <div className="app-sidebar-row flex min-w-0 items-center gap-2">
          <ScopedBrandLink compact access={access} />
          <div data-sidebar-collapsed>
            {/* Reset the popup when its trigger is hidden. */}
            <Popover key={expanded ? "expanded" : "collapsed"}>
              <PopoverTrigger asChild>
                <button type="button" className={iconButton} title="対象会社" aria-label="対象会社"><Building2 className="size-4" aria-hidden /></button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-48 p-2"><CompanySwitch role={access.role} /></PopoverContent>
            </Popover>
          </div>
          <div data-sidebar-expanded className="min-w-0">
            <p className="text-body-medium text-text-primary">TRIANGLE</p>
            <MobileCompanySwitch role={access.role} />
          </div>
        </div>
        <div className="app-sidebar-row app-sidebar-tools ml-auto flex shrink-0 items-center">
          <ThemeToggle compact />
          <button
            type="button"
            className={iconButton}
            onClick={toggleCollapsed}
            title={expanded ? "メニューを畳む" : "メニューを開く"}
            aria-label={expanded ? "メニューを畳む" : "メニューを開く"}
            aria-expanded={expanded}
            aria-controls="app-sidebar-nav"
          >
            <PanelLeftOpen data-sidebar-collapsed className="size-[18px]" aria-hidden />
            <PanelLeftClose data-sidebar-expanded className="size-[18px]" aria-hidden />
          </button>
        </div>
      </div>

      <div className="app-sidebar-search mt-3 shrink-0">
        <div data-sidebar-expanded><AppSearchButton /></div>
        <div data-sidebar-collapsed><AppSearchButton compact /></div>
      </div>

      <nav id="app-sidebar-nav" aria-label="メインメニュー" className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2 [scrollbar-width:thin]">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5 pt-3">
            <span data-sidebar-collapsed className="mx-auto mb-1 h-px w-6 bg-separator-border" aria-hidden />
            <p data-sidebar-expanded className="px-2 pb-1 text-caption-1-medium text-text-tertiary">{group.label}</p>
            {group.items.map((item) => {
              const Icon = navigationIcon(item.icon);
              const selected = item.active && (!item.children || !expanded);
              const bankItem = item.href.split("?")[0] === "/banking/accounts";
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    aria-current={selected ? "page" : undefined}
                    aria-label={item.label}
                    title={item.label}
                    data-active={item.active}
                    data-has-children={Boolean(item.children)}
                    className="app-sidebar-link flex min-h-9 items-center gap-2 rounded-2lg p-2 text-body-medium text-text-secondary transition-colors hover:bg-tile hover:text-text-primary focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
                    <span data-sidebar-expanded className="flex-1 truncate">{item.label}</span>
                    {bankItem && <ChevronDown data-sidebar-expanded className={cx("size-4 shrink-0", !item.children && "-rotate-90")} aria-hidden />}
                  </Link>
                  {item.children && (
                    <div data-sidebar-expanded className="ms-[17px] mt-0.5 mb-1 flex flex-col gap-0.5 border-s border-separator-border ps-2">
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

      <div className="app-sidebar-row flex shrink-0 items-center gap-2 border-t border-separator-border pt-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background-tertiary-default text-caption-1-medium text-text-primary" title={person} aria-label={person}>{Array.from(name)[0] || "利"}</span>
        <Link href="/account" data-sidebar-expanded className="min-w-0 flex-1 rounded-md hover:bg-background-secondary-hover" title={`${person} / パスワードの変更`}><p className="truncate text-body-medium text-text-primary">{name}</p><p className="truncate text-caption-1-regular text-text-tertiary">{roleLabel(access.role)}・パスワード変更</p></Link>
        {can(access, "undo:changes") && <UndoButton compact disabled={!canUndo} />}
        <form action={logoutAction}><Button variant="ghost" size="icon" className="size-9 rounded-lg" title={`${person} / ログアウト`} aria-label="ログアウト"><LogOut className="size-4" aria-hidden /></Button></form>
      </div>
    </aside>
  );
}
