"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, FileText, Pencil, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { updateProjectInline } from "@/app/actions";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, yen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/types";

type Company = "CHINA" | "JAPAN";

type ProjectListRow = {
  billingCount: number;
  billingTotal: number;
  clientId: string;
  clientName: string;
  company: Company;
  contractExtractedAmount?: number;
  contractExtractedBillingCount?: number;
  contractFileUrl?: string;
  contractOriginalFileName?: string;
  contractUploadedAt?: string;
  grossProfit: number;
  id: string;
  index: number;
  invoicedAmount: number;
  name: string;
  paidExpenseAmount: number;
  paidIncomeAmount: number;
  stage: string;
  status: ProjectStatus;
  unpaidIncomeAmount: number;
  updatedAt: string;
};

type ProjectClient = {
  companyName: string;
  id: string;
};

type SortKey = "index" | "name" | "clientName" | "company" | "billingTotal" | "unpaidIncomeAmount" | "grossProfit" | "updatedAt";
type SortDirection = "asc" | "desc";

const companyOptions: { label: string; value: Company }[] = [
  { label: "中国", value: "CHINA" },
  { label: "日本", value: "JAPAN" },
];

const stageOptions = ["制作资料", "施工中", "待拍摄"];

export function ProjectsTable({ canEdit, clients, rows }: { canEdit: boolean; clients: ProjectClient[]; rows: ProjectListRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
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
    setSortDirection(key === "index" || key === "name" || key === "clientName" || key === "company" ? "asc" : "desc");
  };

  return (
    <Table className="w-full table-fixed">
      <TableHeader>
        <TableRow>
          <SortableHead className="w-[20%]" label="案件" sortKey="index" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
          <SortableHead className="w-[13%]" label="クライアント" sortKey="clientName" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
          <SortableHead className="w-[10%]" label="会社/状態" sortKey="company" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
          <SortableHead className="w-[12%] text-right" label="請求設定" sortKey="billingTotal" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
          <SortableHead className="w-[15%]" label="入金状況" sortKey="unpaidIncomeAmount" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
          <SortableHead className="w-[12%]" label="支払い・粗利" sortKey="grossProfit" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
          <TableHead className="w-[10%]">契約書</TableHead>
          <SortableHead className="w-[6%]" label="更新" sortKey="updatedAt" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
          <TableHead className="w-12 text-right">編集</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.map((row) =>
          editingId === row.id ? (
            <EditRow key={row.id} clients={clients} row={row} onCancel={() => setEditingId(null)} />
          ) : (
            <TableRow key={row.id}>
              <TableCell>
                <ProjectIdentity row={row} />
              </TableCell>
              <TableCell>
                <div className="truncate text-sm">{row.clientName || "-"}</div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  <CompanyBadge company={row.company} />
                  <StageBadge stage={row.stage} />
                </div>
                <div className="mt-1">
                  <StatusBadge status={row.status} />
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="font-mono text-sm">{yen.format(row.billingTotal)}</div>
                <div className="text-xs text-muted-foreground">{row.billingCount}回請求</div>
              </TableCell>
              <TableCell>
                <div className="text-sm">請求 {yen.format(row.invoicedAmount)}</div>
                <div className="text-sm">入金 {yen.format(row.paidIncomeAmount)}</div>
                <div className={row.unpaidIncomeAmount > 0 ? "text-sm font-medium text-amber-700" : "text-sm text-muted-foreground"}>
                  未入金 {yen.format(row.unpaidIncomeAmount)}
                </div>
              </TableCell>
              <TableCell>
                <div className="text-sm">支払済 {yen.format(row.paidExpenseAmount)}</div>
                <div className="text-sm font-medium">粗利 {yen.format(row.grossProfit)}</div>
              </TableCell>
              <TableCell>
                <ContractUpload canEdit={canEdit} row={row} />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatDate(row.updatedAt)}</TableCell>
              <TableCell className="text-right">
                {canEdit ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setEditingId(row.id)}
                    aria-label={`${row.name}を編集`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ),
        )}
      </TableBody>
    </Table>
  );
}

function ProjectIdentity({ row }: { row: ProjectListRow }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">No. {row.index}</div>
      <Link href={`/projects/${row.id}`} className="block truncate font-medium hover:underline">
        {row.name}
      </Link>
    </div>
  );
}

function EditRow({ clients, onCancel, row }: { clients: ProjectClient[]; onCancel: () => void; row: ProjectListRow }) {
  return (
    <TableRow className="bg-muted/40">
      <TableCell colSpan={9} className="p-3">
        <form action={updateProjectInline} className="grid items-end gap-3 md:grid-cols-[1fr_180px_120px_130px_150px_100px_auto]">
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
                    {client.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">会社</div>
            <Select name="company" defaultValue={row.company}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {companyOptions.map((company) => (
                  <SelectItem key={company.value} value={company.value}>
                    {company.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">状態</div>
            <Select name="stage" defaultValue={row.stage}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stageOptions.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {stage}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">請求総額</div>
            <Input name="contractAmount" type="number" min="0" step="1" defaultValue={row.billingTotal} required />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">請求回数</div>
            <Input name="billingCount" type="number" min="1" max="12" step="1" defaultValue={row.billingCount} required />
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

function ContractUpload({ canEdit, row }: { canEdit: boolean; row: ProjectListRow }) {
  return (
    <div className="space-y-1">
      {row.contractFileUrl ? (
        <a className="inline-flex items-center gap-1 text-xs font-medium underline" href={row.contractFileUrl} target="_blank">
          <FileText className="h-3.5 w-3.5" />
          契約書
        </a>
      ) : (
        <div className="text-xs text-muted-foreground">未登録</div>
      )}
      {row.contractExtractedAmount || row.contractExtractedBillingCount ? (
        <div className="text-[11px] leading-tight text-muted-foreground">
          {row.contractExtractedAmount ? yen.format(row.contractExtractedAmount) : "-"} / {row.contractExtractedBillingCount ?? row.billingCount}回
        </div>
      ) : null}
      {canEdit ? (
        <form action="/api/uploads/contracts" method="post" encType="multipart/form-data">
          <input type="hidden" name="projectId" value={row.id} />
          <input type="hidden" name="company" value={row.company} />
          <label className={cn(buttonVariants({ variant: "outline", size: "xs" }), "mt-1 cursor-pointer")}>
            <Upload className="h-3 w-3" />
            {row.contractFileUrl ? "差替" : "登録"}
            <input
              className="sr-only"
              type="file"
              name="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
            />
          </label>
        </form>
      ) : null}
    </div>
  );
}

function CompanyBadge({ company }: { company: Company }) {
  return (
    <Badge variant="outline" className={company === "CHINA" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-800"}>
      {company === "CHINA" ? "中国" : "日本"}
    </Badge>
  );
}

function StageBadge({ stage }: { stage: string }) {
  const tone =
    stage === "施工中"
      ? "border-blue-300 bg-blue-100 text-blue-800"
      : stage === "待拍摄"
        ? "border-violet-300 bg-violet-100 text-violet-800"
        : "border-orange-300 bg-orange-100 text-orange-800";
  return (
    <Badge variant="outline" className={tone}>
      {stage}
    </Badge>
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
        className="inline-flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" />
      </button>
    </TableHead>
  );
}
