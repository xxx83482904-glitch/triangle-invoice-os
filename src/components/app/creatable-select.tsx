"use client";

import { Check, ChevronDown, Plus, X } from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CompanyScope } from "@/lib/company";
import type { SelectOptionGroup } from "@/lib/types";

type Option = {
  label: string;
  value: string;
};

type CreateConfig =
  | { kind: "client"; company: CompanyScope }
  | { kind: "vendor"; company: CompanyScope }
  | { kind: "select-option"; company: CompanyScope; group: SelectOptionGroup };

export function CreatableSelect({
  className,
  create,
  defaultValue,
  name,
  options,
  placeholder = "選択",
  searchPlaceholder = "検索または作成",
}: {
  className?: string;
  create?: CreateConfig;
  defaultValue?: string;
  name: string;
  options: Option[];
  placeholder?: string;
  required?: boolean;
  searchPlaceholder?: string;
}) {
  const [items, setItems] = useState(options);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(defaultValue ?? "");
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = items.find((item) => item.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.label.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle));
  }, [items, query]);
  const canCreate = Boolean(create && query.trim() && !items.some((item) => item.label === query.trim() || item.value === query.trim()));

  function selectItem(next: Option) {
    setValue(next.value);
    setQuery("");
    setOpen(false);
  }

  function createItem() {
    if (!create || !query.trim()) return;
    const label = query.trim();
    startTransition(async () => {
      const response = await fetch("/api/dropdown-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...create, label }),
      });
      if (!response.ok) return;
      const next = (await response.json()) as Option;
      setItems((current) => [...current, next]);
      selectItem(next);
    });
  }

  return (
    <div ref={rootRef} className={cn("relative", className)} onBlur={(event) => {
      if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <input name={name} value={value} readOnly type="hidden" />
      <button
        type="button"
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-[16px] outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 lg:h-8 lg:px-2.5 lg:text-sm"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1 text-left">
          {selected ? (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
              <span className="truncate">{selected.label}</span>
              <X
                className="h-3 w-3"
                onClick={(event) => {
                  event.stopPropagation();
                  setValue("");
                }}
              />
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-48 rounded-lg border bg-popover p-1 shadow-lg">
          <Input
            autoFocus
            value={query}
            placeholder={searchPlaceholder}
            className="mb-1"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (canCreate) createItem();
              }
            }}
          />
          <div className="max-h-64 overflow-y-auto">
            {filtered.map((item) => (
              <button
                key={item.value}
                type="button"
                className={cn(
                  "flex min-h-10 w-full items-center justify-between rounded-md px-2 py-2 text-left text-[16px] hover:bg-accent lg:min-h-0 lg:py-1.5 lg:text-sm",
                  item.value === value && "bg-accent",
                )}
                onClick={() => selectItem(item)}
              >
                <span className="truncate">{item.label}</span>
                {item.value === value ? <Check className="h-4 w-4" /> : null}
              </button>
            ))}
            {canCreate ? (
              <Button type="button" variant="ghost" size="sm" className="mt-1 w-full justify-start gap-2" disabled={isPending} onClick={createItem}>
                <Plus className="h-4 w-4" />
                「{query.trim()}」を作成
              </Button>
            ) : null}
            {!filtered.length && !canCreate ? <div className="px-2 py-2 text-sm text-muted-foreground">候補がありません</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
