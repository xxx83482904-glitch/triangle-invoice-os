"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ThemePreference, useTheme } from "@/components/app/theme-provider";

const options: Array<{ icon: typeof Sun; label: string; value: ThemePreference }> = [
  { icon: Sun, label: "ライト", value: "light" },
  { icon: Moon, label: "ダーク", value: "dark" },
  { icon: Monitor, label: "自動", value: "system" },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const Icon = mounted && resolvedTheme === "dark" ? Moon : Sun;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={compact ? "icon" : "sm"}
          className={compact ? "h-9 w-9 rounded-lg" : "w-full justify-start gap-2"}
          title="テーマ切替"
        >
          <Icon className="h-4 w-4" />
          {compact ? <span className="sr-only">テーマ切替</span> : <span>テーマ</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {options.map((option) => {
          const OptionIcon = option.icon;
          const active = mounted && theme === option.value;
          return (
            <DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)} className="gap-2">
              <OptionIcon className="h-4 w-4" />
              <span className="flex-1">{option.label}</span>
              {active ? <Check className="h-4 w-4" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
