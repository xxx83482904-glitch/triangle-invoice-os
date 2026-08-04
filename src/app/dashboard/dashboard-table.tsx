"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, FilePlus2, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createInstallmentInvoice, updateProjectInline } from "@/app/actions";
import { CreatableSelect } from "@/components/app/creatable-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { yen } from "@/lib/format";

type Company = "CHINA" | "JAPAN";

type DashboardRow = {
  billingCount: number;
  billingTotal: number;
  clientId: string;
  clientName: string;
  company: Company;
  createdRounds: number[];
  id: string;
  index: number;
  name: string;
  stage: string;
};

type ProjectClient = {
  companyName: string;
  id: string;
};

type Choice = {
  label: string;
  value: string;
};

type SortKey = "index" | "name" | "clientName" | "company" | "stage" | "billingTotal" | "billingCount";
type SortDirection = "asc" | "desc";

const companyOptions: { label: string; value: Company }[] = [
  { label: "中国", value: "CHINA" },
  { label: "日本", value: "JAPAN" },
];

export function DashboardTable({
  canEdit,
  clients,
  rows,
  stageOptions,
}: {
  canEdit: boolean;
  clients: ProjectClient[];
  rows: DashboardRow[];
  stageOptions: Choice[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

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
    setSortDirection(key === "index" || key === "name" || key === "clientName" ? "asc" : "desc");
  };

  return (
    <Card>
      <CardContent className="p-0">
        <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow>
              <SortableHead className="w-[27%]" label="案件" sortKey="index" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[15%]" label="クライアント" sortKey="clientName" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[8%]" label="会社" sortKey="company" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[9%]" label="状態" sortKey="stage" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[13%] text-right" label="請求総額" sortKey="billingTotal" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[6%] text-right" label="回数" sortKey="billingCount" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <TableHead className="w-[14%]">請求書作成</TableHead>
              <TableHead className="w-12 text-right">編集</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) =>
              editingId === row.id ? (
                <EditRow key={row.id} clients={clients} row={row} stageOptions={stageOptions} onCancel={() => setEditingId(null)} />
              ) : (
                <TableRow key={row.id}>
                  <TableCell>
                    <ProjectIdentity row={row} />
                  </TableCell>
                  <TableCell>
                    <div className="truncate text-xs">{row.clientName || "-"}</div>
                  </TableCell>
                  <TableCell>
                    <CompanyBadge company={row.company} />
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={row.stage} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{yen.format(row.billingTotal)}</TableCell>
                  <TableCell className="text-right">{row.billingCount}回</TableCell>
                  <TableCell>
                    <InstallmentButtons canEdit={canEdit} row={row} />
                  </TableCell>
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
      </CardContent>
    </Card>
  );
}

function EditRow({
  clients,
  onCancel,
  row,
  stageOptions,
}: {
  clients: ProjectClient[];
  onCancel: () => void;
  row: DashboardRow;
  stageOptions: Choice[];
}) {
  return (
    <TableRow className="bg-muted/40">
      <TableCell colSpan={8} className="p-2">
        <form action={updateProjectInline} className="grid items-end gap-2 lg:grid-cols-[1fr_170px_110px_120px_140px_90px_auto]">
          <input type="hidden" name="projectId" value={row.id} />
          <input type="hidden" name="returnPath" value="/dashboard" />
          <div>
            <div className="mb-1 text-xs text-muted-foreground">案件名</div>
            <Input name="name" defaultValue={row.name} required className="h-7 text-xs" />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">クライアント</div>
            <CreatableSelect
              name="clientId"
              defaultValue={row.clientId}
              options={clients.map((client) => ({ label: client.companyName, value: client.id }))}
              create={{ kind: "client", company: row.company }}
              required
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">会社</div>
            <Select name="company" defaultValue={row.company}>
              <SelectTrigger className="h-7 w-full text-xs">
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
            <CreatableSelect
              name="stage"
              defaultValue={row.stage}
              options={stageOptions}
              create={{ kind: "select-option", company: row.company, group: "PROJECT_STAGE" }}
              required
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">請求総額</div>
            <Input name="contractAmount" type="number" min="0" step="1" defaultValue={row.billingTotal} required className="h-7 text-xs" />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">請求回数</div>
            <Input name="billingCount" type="number" min="1" max="12" step="1" defaultValue={row.billingCount} required className="h-7 text-xs" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              保存
            </Button>
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={onCancel} aria-label="編集をキャンセル">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}

function ProjectIdentity({ row }: { row: DashboardRow }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-muted-foreground">No. {row.index}</div>
      <Link href={`/projects/${row.id}`} prefetch={false} className="block truncate text-xs font-medium hover:underline">
        {row.name}
      </Link>
    </div>
  );
}

function InstallmentButtons({ canEdit, row }: { canEdit: boolean; row: DashboardRow }) {
  if (!canEdit) return <span className="text-xs text-muted-foreground">-</span>;
  if (row.billingTotal <= 0) return <span className="text-xs text-muted-foreground">総額を入力</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: row.billingCount }, (_, index) => {
        const round = index + 1;
        const created = row.createdRounds.includes(round);
        return (
          <form key={round} action={createInstallmentInvoice}>
            <input type="hidden" name="projectId" value={row.id} />
            <input type="hidden" name="round" value={round} />
            <Button type="submit" size="sm" variant={created ? "secondary" : "outline"} disabled={created} className="h-7 px-2 text-xs">
              <FilePlus2 className="mr-1 h-3.5 w-3.5" />
              {round}回目
            </Button>
          </form>
        );
      })}
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
        className="inline-flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" />
      </button>
    </TableHead>
  );
}
