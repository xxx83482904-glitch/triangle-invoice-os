"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CompanyScope } from "@/lib/company";

type FilterProps = {
  company: CompanyScope;
  clients: Array<{ id: string; companyName: string }>;
  statusOptions: Array<{ id: string; value: string; label: string }>;
  current: {
    clientId?: string;
    status?: string;
    unpaidIncome?: string;
    unpaidExpense?: string;
  };
};

export function ProjectFilter({ company, clients, statusOptions, current }: FilterProps) {
  const router = useRouter();

  function buildHref(overrides: Record<string, string>) {
    const params = new URLSearchParams({
      company,
      clientId: current.clientId ?? "all",
      status: current.status ?? "all",
      unpaidIncome: current.unpaidIncome ?? "0",
      unpaidExpense: current.unpaidExpense ?? "0",
      ...overrides,
    });
    return `?${params.toString()}`;
  }

  function onChange(key: string, value: string) {
    router.push(buildHref({ [key]: value }));
  }

  return (
    <div className="flex flex-wrap gap-3">
      <input type="hidden" name="company" value={company} />
      <Select value={current.clientId ?? "all"} onValueChange={(v) => onChange("clientId", v)}>
        <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="クライアント" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全クライアント</SelectItem>
          {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.companyName}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={current.status ?? "all"} onValueChange={(v) => onChange("status", v)}>
        <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="ステータス" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全ステータス</SelectItem>
          {statusOptions.map((option) => <SelectItem key={option.id} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={current.unpaidIncome ?? "0"} onValueChange={(v) => onChange("unpaidIncome", v)}>
        <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="未入金" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="0">未入金条件なし</SelectItem>
          <SelectItem value="1">未入金あり</SelectItem>
        </SelectContent>
      </Select>
      <Select value={current.unpaidExpense ?? "0"} onValueChange={(v) => onChange("unpaidExpense", v)}>
        <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="未払い" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="0">未払い条件なし</SelectItem>
          <SelectItem value="1">未払いあり</SelectItem>
        </SelectContent>
      </Select>
      <Button asChild size="sm" variant="ghost">
        <a href={`?company=${company}`}>リセット</a>
      </Button>
    </div>
  );
}
