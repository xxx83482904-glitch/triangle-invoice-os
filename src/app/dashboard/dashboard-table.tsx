"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";
import { updateProjectInline } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Company = "CHINA" | "JAPAN";

type DashboardRow = {
  company: Company;
  id: string;
  index: number;
  name: string;
  stage: string;
};

type SortKey = "index" | "name" | "company" | "stage";
type SortDirection = "asc" | "desc";

const companyOptions: { label: string; value: Company }[] = [
  { label: "中国", value: "CHINA" },
  { label: "日本", value: "JAPAN" },
];

const stageOptions = ["制作资料", "施工中", "待拍摄"];

export function DashboardTable({ canEdit, rows }: { canEdit: boolean; rows: DashboardRow[] }) {
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
    setSortDirection(key === "index" ? "asc" : "desc");
  };

  return (
    <Card>
      <CardContent className="p-0">
        <Table className="w-full table-fixed">
          <TableHeader>
            <TableRow>
              <SortableHead className="w-16" label="#" sortKey="index" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[58%]" label="案件名" sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[14%]" label="会社" sortKey="company" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortableHead className="w-[16%]" label="状態" sortKey="stage" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <TableHead className="w-20 text-right">編集</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) =>
              editingId === row.id ? (
                <EditRow key={row.id} row={row} onCancel={() => setEditingId(null)} />
              ) : (
                <TableRow key={row.id}>
                  <TableCell className="text-muted-foreground">{row.index}</TableCell>
                  <TableCell>
                    <Link href={`/projects/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CompanyBadge company={row.company} />
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={row.stage} />
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

function EditRow({ onCancel, row }: { onCancel: () => void; row: DashboardRow }) {
  return (
    <TableRow className="bg-muted/40">
      <TableCell colSpan={5} className="p-3">
        <form action={updateProjectInline} className="grid items-end gap-3 md:grid-cols-[1fr_130px_140px_auto]">
          <input type="hidden" name="projectId" value={row.id} />
          <div>
            <div className="mb-1 text-xs text-muted-foreground">案件名</div>
            <Input name="name" defaultValue={row.name} required />
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
