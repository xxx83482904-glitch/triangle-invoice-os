"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { CommandPalette, CommandPaletteItem, CommandPaletteSection } from "@/components/base/command-palette/command-palette";
import { Kbd } from "@/components/base/kbd/kbd";
import { DirectionProvider } from "@/components/foundations/direction/direction";
import { navigationIcon } from "@/components/app/navigation-icon";
import { commandNavigation } from "@/lib/app-navigation";
import { requestAppNavigation } from "@/lib/navigation-intent";
import type { UserRole } from "@/lib/types";
import { cx } from "@/utils/cx";

const OpenPaletteContext = createContext<(() => void) | null>(null);

export function AppCommandPaletteProvider({ role, children }: { role: UserRole; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  function changeOpen(next: boolean) {
    if (next) setQuery("");
    setOpen(next);
  }

  return (
    <DirectionProvider locale="ja-JP">
      <OpenPaletteContext.Provider value={() => changeOpen(true)}>
        {children}
        <AppCommandPalette role={role} open={open} onOpenChange={changeOpen} query={query} onQueryChange={setQuery} />
      </OpenPaletteContext.Provider>
    </DirectionProvider>
  );
}

export function AppCommandPalette({ role, open, onOpenChange, query, onQueryChange }: {
  role: UserRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const screens = commandNavigation(pathname, new URLSearchParams(params.toString()), role);

  return (
    <CommandPalette
      isOpen={open}
      onOpenChange={onOpenChange}
      inputValue={query}
      onInputChange={onQueryChange}
      placeholder="画面名で検索"
      emptyState="該当する画面はありません"
      aria-label="検索・移動"
      footer={<span className="text-caption-1-regular">↑↓で選ぶ・Enterで開く・Escで閉じる</span>}
      className="rounded-[24px] border-border-button-white bg-background-primary-default/95 shadow-dropdown backdrop-blur-xl"
      onAction={(key) => {
        const screen = screens.find((item) => item.href === key);
        onOpenChange(false);
        if (screen && requestAppNavigation(screen.href)) router.push(screen.href);
      }}
    >
      <CommandPaletteSection title="画面へ移動">
        {screens.map((screen) => (
          <CommandPaletteItem key={screen.href} id={screen.href} icon={navigationIcon(screen.icon)} description={screen.group}>
            {screen.label}
          </CommandPaletteItem>
        ))}
      </CommandPaletteSection>
    </CommandPalette>
  );
}

export function AppSearchButton({ compact = false }: { compact?: boolean }) {
  const openPalette = useContext(OpenPaletteContext);
  return (
    <button
      type="button"
      onClick={() => openPalette?.()}
      aria-label="検索・移動"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+k Meta+k"
      title="検索・移動（Ctrl K / ⌘ K）"
      className={cx(
        "flex shrink-0 cursor-pointer items-center gap-2 text-text-secondary transition-colors hover:bg-background-tertiary-hover focus-visible:outline-2 focus-visible:outline-ring",
        compact ? "size-9 justify-center rounded-lg" : "w-full rounded-full bg-background-tertiary-default p-2",
      )}
    >
      <Search className="size-[18px] shrink-0" aria-hidden />
      {!compact && <><span className="flex-1 text-start text-body-medium">検索・移動</span><Kbd>Ctrl K</Kbd></>}
    </button>
  );
}
