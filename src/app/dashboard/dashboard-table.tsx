"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";
import { updateProjectInline } from "@/app/actions";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { percent, yen } from "@/lib/format";
import type { ProjectStatus } from "@/lib/types";

type DashboardRow = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  status: ProjectStatus;
  issuedCount: number;
  receivedCount: number;
  invoicedAmount: number;
  paidIncomeAmount: number;
  unpaidIncomeAmount: number;
  receivedInvoiceTotal: number;
  paidExpenseAmount: number;
  unpaidExpenseAmount: number;
  grossProfit: number;
  grossProfitRate: number;
  overdueAmount: number;
  nextIncomeDue: string;
  nextPaymentDue: string;
};

type SortKey =
  | "name"
  | "clientName"
  | "status"
  | "invoicedAmount"
  | "unpaidIncomeAmount"
  | "receivedInvoiceTotal"
  | "unpaidExpenseAmount"
  | "grossProfit"
  | "nextIncomeDue";

type SortDirection = "asc" | "desc";

const statusOptions: { value: ProjectStatus; label: string }[] = [
  { value: "PLANNING", label: "計画中" },
  { value: "IN_PROGRESS", label: "進行中" },
  { value: "WAITING", label: "保留" },
  { value: "COMPLETED", label: "完了" },
  { value: "ARCHIVED", label: "アーカイブ" },
];

export function DashboardTable({
  canEdit,
  clients,
  rows,
  totals,
}: {
  canEdit: boolean;
  clients: { id: string; name: string }[];
  rows: DashboardRow[];
  totals: {
    invoiced: number;
    income: number;
    unpaidIncome: number;
    received: number;
    expense: number;
    unpaidExpense: number;
    profit: number;
  };
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("unpaidIncomeAmount");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      const result =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), "ja");
      return sortDirection === "asc" ? result : -result;
    });
  }, [rows, sortDirection, sortKey]);

  const changeSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("desc");
  };

  return (
    <Card>
      <CardContent className="p-0">
        <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow>
              <SortableHead className="w-[21%]" label="案件" sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[15%]" label="クライアント" sortKey="clientName" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[9%]" label="状態" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[14%] text-right" label="売上" sortKey="invoicedAmount" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[10%] text-right" label="未入金" sortKey="unpaidIncomeAmount" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[14%] text-right" label="支払い" sortKey="receivedInvoiceTotal" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[10%] text-right" label="未払い" sortKey="unpaidExpenseAmount" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[10%] text-right" label="粗利" sortKey="grossProfit" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[12%]" label="次の期限" sortKey="nextIncomeDue" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) =>
              editingId === row.id ? (
                <EditRow key={row.id} clients={clients} row={row} onCancel={() => setEditingId(null)} />
              ) : (
                <TableRow key={row.id}>
                  <TableCell className="align-top">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <Link href={`/projects/${row.id}`} className="font-medium leading-snug hover:underline">
                          {row.name}
                        </Link>
                        <div className="mt-1 text-xs text-muted-foreground">
                          発行 {row.issuedCount}件 / 受領 {row.receivedCount}件
                        </div>
                      </div>
                      {canEdit ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={() => setEditingId(row.id)}
                          aria-label={`${row.name}を編集`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm">{row.clientName}</TableCell>
                  <TableCell className="align-top">
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="align-top text-right">
                    <AmountStack primary={row.invoicedAmount} secondary={row.paidIncomeAmount} secondaryLabel="入金" />
                  </TableCell>
                  <MoneyCell value={row.unpaidIncomeAmount} attention={row.unpaidIncomeAmount > 0} />
                  <TableCell className="align-top text-right">
                    <AmountStack primary={row.receivedInvoiceTotal} secondary={row.paidExpenseAmount} secondaryLabel="支払" />
                  </TableCell>
                  <MoneyCell value={row.unpaidExpenseAmount} attention={row.unpaidExpenseAmount > 0} />
                  <TableCell className="align-top text-right">
                    <div className={`font-mono text-sm font-medium ${row.grossProfit < 0 ? "text-red-700" : ""}`}>
                      {yen.format(row.grossProfit)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{percent(row.grossProfitRate)}</div>
                  </TableCell>
                  <TableCell className="align-top text-xs leading-5">
                    <DueLine label="入金" value={row.nextIncomeDue} />
                    <DueLine label="支払" value={row.nextPaymentDue} />
                    {row.overdueAmount > 0 ? <div className="font-medium text-red-700">超過 {yen.format(row.overdueAmount)}</div> : null}
                  </TableCell>
                </TableRow>
              ),
            )}
            <TableRow className="bg-muted/50 font-medium">
              <TableCell>合計</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right">
                <AmountStack primary={totals.invoiced} secondary={totals.income} secondaryLabel="入金" />
              </TableCell>
              <MoneyCell value={totals.unpaidIncome} attention={totals.unpaidIncome > 0} />
              <TableCell className="text-right">
                <AmountStack primary={totals.received} secondary={totals.expense} secondaryLabel="支払" />
              </TableCell>
              <MoneyCell value={totals.unpaidExpense} attention={totals.unpaidExpense > 0} />
              <MoneyCell value={totals.profit} attention={totals.profit < 0} />
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function EditRow({
  clients,
  onCancel,
  row,
}: {
  clients: { id: string; name: string }[];
  onCancel: () => void;
  row: DashboardRow;
}) {
  return (
    <TableRow className="bg-muted/40">
      <TableCell colSpan={9} className="p-3">
        <form action={updateProjectInline} className="grid items-end gap-3 md:grid-cols-[2fr_1.4fr_130px_auto]">
          <input type="hidden" name="projectId" value={row.id} />
          <div>
            <div className="mb-1 text-xs text-muted-foreground">案件名</div>
            <Input name="name" defaultValue={row.name} required />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">クライアント</div>
            <Select name="clientId" defaultValue={row.clientId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">状態</div>
            <Select name="status" defaultValue={row.status}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              保存
            </Button>
            <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={onCancel} aria-label="編集をキャンセル">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}

function SortableHead({
  activeKey,
  className,
  direction,
  label,
  onSort,
  sortKey,
}: {
  activeKey: SortKey;
  className?: string;
  direction: SortDirection;
  label: string;
  onSort: (key: SortKey) => void;
  sortKey: SortKey;
}) {
  const active = activeKey === sortKey;
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        className="inline-flex w-full items-center justify-between gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" />
      </button>
    </TableHead>
  );
}

function AmountStack({ primary, secondary, secondaryLabel }: { primary: number; secondary: number; secondaryLabel: string }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-sm">{yen.format(primary)}</div>
      <div className="text-xs text-muted-foreground">
        {secondaryLabel}: {yen.format(secondary)}
      </div>
    </div>
  );
}

function DueLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </div>
  );
}

function MoneyCell({ value, attention }: { value: number; attention?: boolean }) {
  return (
    <TableCell className={`align-top text-right font-mono text-sm ${attention ? "font-semibold text-amber-700" : ""}`}>
      {yen.format(value)}
    </TableCell>
  );
}
