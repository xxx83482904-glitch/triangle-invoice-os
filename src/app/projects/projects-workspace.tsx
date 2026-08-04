"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  FileText,
  FolderKanban,
  Plus,
  ReceiptText,
  Search,
  Upload,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { createProject, updateProjectInline } from "@/app/actions";
import { CreatableSelect } from "@/components/app/creatable-select";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, percent, yen } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/types";

type Company = "CHINA" | "JAPAN";
type WorkFilter = "all" | "needsAction" | "uninvoiced" | "unpaidIncome" | "unpaidExpense" | "missingContract" | "completed";

type Option = {
  label: string;
  value: string;
};

export type ProjectWorkspaceRow = {
  billingCount: number;
  clientId: string;
  clientName: string;
  company: Company;
  contractAmount: number;
  contractExtractedAmount?: number;
  contractExtractedBillingCount?: number;
  contractFileUrl?: string;
  contractOriginalFileName?: string;
  contractUploadedAt?: string;
  endDate?: string;
  grossProfit: number;
  grossProfitRate: number;
  id: string;
  index: number;
  invoicedAmount: number;
  issuedCount: number;
  memo?: string;
  name: string;
  paidExpenseAmount: number;
  paidIncomeAmount: number;
  receivedCount: number;
  receivedInvoiceTotal: number;
  stage: string;
  startDate?: string;
  status: ProjectStatus;
  unpaidExpenseAmount: number;
  unpaidIncomeAmount: number;
  updatedAt: string;
};

export function ProjectsWorkspace({
  canEdit,
  clients,
  company,
  rows,
  showFinancials,
  stageOptions,
  statusOptions,
}: {
  canEdit: boolean;
  clients: Option[];
  company: Company;
  rows: ProjectWorkspaceRow[];
  showFinancials: boolean;
  stageOptions: Option[];
  statusOptions: Option[];
}) {
  const [activeId, setActiveId] = useState(rows[0]?.id ?? "");
  const [clientFilter, setClientFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(rows.length === 0);
  const [workFilter, setWorkFilter] = useState<WorkFilter>("needsAction");

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (clientFilter !== "all" && row.clientId !== clientFilter) return false;
        if (!matchesFilter(row, workFilter, showFinancials)) return false;
        if (!normalizedQuery) return true;
        return [row.name, row.clientName, row.stage, row.memo, row.contractOriginalFileName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => {
        const priority = projectPriority(b, showFinancials) - projectPriority(a, showFinancials);
        if (priority !== 0) return priority;
        return String(b.updatedAt).localeCompare(String(a.updatedAt), "ja");
      });
  }, [clientFilter, query, rows, showFinancials, workFilter]);

  const activeRow = filteredRows.find((row) => row.id === activeId) ?? filteredRows[0] ?? rows.find((row) => row.id === activeId) ?? rows[0];
  const summary = useMemo(() => buildSummary(rows, showFinancials), [rows, showFinancials]);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <SummaryTile icon={FolderKanban} label="案件" value={`${summary.total}件`} />
        <SummaryTile icon={AlertTriangle} label="要対応" value={`${summary.needsAction}件`} tone={summary.needsAction > 0 ? "warn" : "neutral"} />
        {showFinancials ? (
          <>
            <SummaryTile icon={ReceiptText} label="未請求" value={yen.format(summary.uninvoicedAmount)} tone={summary.uninvoicedAmount > 0 ? "warn" : "neutral"} />
            <SummaryTile icon={WalletCards} label="未入金" value={yen.format(summary.unpaidIncomeAmount)} tone={summary.unpaidIncomeAmount > 0 ? "danger" : "neutral"} />
          </>
        ) : (
          <>
            <SummaryTile icon={FileText} label="契約書なし" value={`${summary.missingContract}件`} tone={summary.missingContract > 0 ? "warn" : "neutral"} />
            <SummaryTile icon={CheckCircle2} label="完了" value={`${summary.completed}件`} />
          </>
        )}
      </section>

      <section className="rounded-lg border bg-card text-card-foreground">
        <div className="border-b p-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-2 md:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="案件名・クライアント・段階を検索"
                  className="pl-9"
                />
              </div>
              <Select value={clientFilter} onValueChange={setClientFilter}>
                <SelectTrigger className="w-full md:w-[220px]">
                  <SelectValue placeholder="クライアント" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全クライアント</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.value} value={client.value}>
                      {client.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canEdit ? (
              <Button type="button" onClick={() => setShowCreate((current) => !current)}>
                <Plus className="h-4 w-4" />
                案件追加
              </Button>
            ) : null}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {filterOptions(showFinancials).map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors lg:min-h-8",
                  workFilter === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => setWorkFilter(option.value)}
              >
                {option.label}
                <Badge variant="outline" className={workFilter === option.value ? "border-primary-foreground/40 text-primary-foreground" : ""}>
                  {countForFilter(rows, option.value, showFinancials)}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        {showCreate && canEdit ? (
          <div className="border-b bg-muted/30 p-3">
            <CreateProjectForm company={company} clients={clients} stageOptions={stageOptions} statusOptions={statusOptions} />
          </div>
        ) : null}

        <div className="grid min-h-[620px] lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
              <span>{filteredRows.length}件表示</span>
              <span>要対応順</span>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {filteredRows.map((row) => (
                <ProjectListItem
                  key={row.id}
                  active={row.id === activeRow?.id}
                  row={row}
                  showFinancials={showFinancials}
                  onSelect={() => setActiveId(row.id)}
                />
              ))}
              {filteredRows.length === 0 ? (
                <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-4 text-center">
                  <BriefcaseBusiness className="h-10 w-10 text-muted-foreground" />
                  <div>
                    <div className="font-medium">条件に合う案件がありません</div>
                    <p className="mt-1 text-sm text-muted-foreground">検索やフィルターを戻すと一覧に表示されます。</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setClientFilter("all");
                      setWorkFilter("all");
                    }}
                  >
                    条件をリセット
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="min-w-0 bg-muted/20">
            {activeRow ? (
              <ProjectDetailPanel
                canEdit={canEdit}
                clients={clients}
                company={company}
                row={activeRow}
                showFinancials={showFinancials}
                stageOptions={stageOptions}
                statusOptions={statusOptions}
              />
            ) : (
              <div className="p-4 text-sm text-muted-foreground">案件を選択してください。</div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

function CreateProjectForm({
  clients,
  company,
  stageOptions,
  statusOptions,
}: {
  clients: Option[];
  company: Company;
  stageOptions: Option[];
  statusOptions: Option[];
}) {
  return (
    <form action={createProject} className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_150px_150px_120px_120px]">
      <input type="hidden" name="company" value={company} />
      <div className="space-y-1">
        <Label>案件名</Label>
        <Input name="name" required />
      </div>
      <div className="space-y-1">
        <Label>クライアント</Label>
        <CreatableSelect name="clientId" options={clients} placeholder="選択" create={{ kind: "client", company }} required />
      </div>
      <div className="space-y-1">
        <Label>ステータス</Label>
        <CreatableSelect
          name="status"
          defaultValue={statusOptions.find((option) => option.value === "IN_PROGRESS")?.value ?? statusOptions[0]?.value ?? "IN_PROGRESS"}
          options={statusOptions}
          create={{ kind: "select-option", company, group: "PROJECT_STATUS" }}
          required
        />
      </div>
      <div className="space-y-1">
        <Label>段階</Label>
        <CreatableSelect
          name="stage"
          defaultValue={stageOptions[0]?.value ?? "制作资料"}
          options={stageOptions}
          create={{ kind: "select-option", company, group: "PROJECT_STAGE" }}
          required
        />
      </div>
      <div className="space-y-1">
        <Label>契約金額</Label>
        <Input name="contractAmount" type="number" min="0" step="1" required />
      </div>
      <div className="space-y-1">
        <Label>請求回数</Label>
        <Input name="billingCount" type="number" min="1" max="12" step="1" defaultValue={1} required />
      </div>
      <div className="space-y-1 md:col-span-2 xl:col-span-2">
        <Label>メモ</Label>
        <Input name="memo" placeholder="必要ならメモ" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:col-span-2 xl:col-span-2">
        <div className="space-y-1">
          <Label>開始日</Label>
          <Input name="startDate" type="date" />
        </div>
        <div className="space-y-1">
          <Label>終了日</Label>
          <Input name="endDate" type="date" />
        </div>
      </div>
      <div className="md:col-span-2 xl:col-span-2">
        <Button className="w-full">追加</Button>
      </div>
    </form>
  );
}

function ProjectListItem({
  active,
  onSelect,
  row,
  showFinancials,
}: {
  active: boolean;
  onSelect: () => void;
  row: ProjectWorkspaceRow;
  showFinancials: boolean;
}) {
  const uninvoicedAmount = Math.max(row.contractAmount - row.invoicedAmount, 0);
  const actionLabels = projectActionLabels(row, showFinancials);

  return (
    <article
      role="button"
      tabIndex={0}
      className={cn(
        "block w-full border-b px-3 py-3 text-left transition-colors hover:bg-muted/60",
        active ? "bg-primary/5 ring-1 ring-inset ring-primary/30" : "bg-background",
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">No. {row.index}</span>
            <CompanyBadge company={row.company} />
            <StatusBadge status={row.status} />
          </div>
          <div className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">{row.name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{row.clientName || "クライアント未設定"} / {row.stage || "段階未設定"}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted-foreground">更新</div>
          <div className="text-xs font-medium">{formatDate(row.updatedAt)}</div>
        </div>
      </div>

      {showFinancials ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <MiniAmount label="未請求" value={uninvoicedAmount} hot={uninvoicedAmount > 0} />
          <MiniAmount label="未入金" value={row.unpaidIncomeAmount} hot={row.unpaidIncomeAmount > 0} />
          <MiniAmount label="粗利" value={row.grossProfit} hot={row.grossProfit < 0} />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{row.issuedCount}件 請求書</span>
          <span>{row.receivedCount}件 受領請求書</span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {actionLabels.length > 0 ? (
          actionLabels.map((label) => <ActionBadge key={label}>{label}</ActionBadge>)
        ) : (
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            順調
          </Badge>
        )}
      </div>
    </article>
  );
}

function ProjectDetailPanel({
  canEdit,
  clients,
  company,
  row,
  showFinancials,
  stageOptions,
  statusOptions,
}: {
  canEdit: boolean;
  clients: Option[];
  company: Company;
  row: ProjectWorkspaceRow;
  showFinancials: boolean;
  stageOptions: Option[];
  statusOptions: Option[];
}) {
  const uninvoicedAmount = Math.max(row.contractAmount - row.invoicedAmount, 0);

  return (
    <div className="sticky top-0 space-y-4 p-3 lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto">
      <div className="rounded-lg border bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={row.status} />
              <CompanyBadge company={row.company} />
            </div>
            <h2 className="mt-2 line-clamp-3 text-lg font-semibold leading-tight">{row.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{row.clientName || "クライアント未設定"}</p>
          </div>
          <Button asChild size="icon" variant="outline" aria-label="案件詳細を開く">
            <Link href={`/projects/${row.id}?company=${company}`} prefetch={false}>
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button asChild variant="outline" className="justify-start">
            <Link href={`/guest-invoices?company=${company}`} prefetch={false}>
              <ReceiptText className="h-4 w-4" />
              請求作成
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-start">
            <Link href={`/received-invoices?company=${company}`} prefetch={false}>
              <WalletCards className="h-4 w-4" />
              支払い確認
            </Link>
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {projectActionLabels(row, showFinancials).map((label) => (
            <ActionBadge key={label}>{label}</ActionBadge>
          ))}
          {projectActionLabels(row, showFinancials).length === 0 ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              次の対応なし
            </Badge>
          ) : null}
        </div>
      </div>

      {showFinancials ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CircleDollarSign className="h-4 w-4" />
              金額の流れ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressLine label="請求" done={row.invoicedAmount} remaining={uninvoicedAmount} total={row.contractAmount} doneLabel="請求済み" remainingLabel="未請求" />
            <ProgressLine label="入金" done={row.paidIncomeAmount} remaining={row.unpaidIncomeAmount} total={row.invoicedAmount} doneLabel="入金済み" remainingLabel="未入金" />
            <ProgressLine label="支払い" done={row.paidExpenseAmount} remaining={row.unpaidExpenseAmount} total={row.receivedInvoiceTotal} doneLabel="支払済み" remainingLabel="未払い" />
            <Separator />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InfoLine label="契約金額" value={yen.format(row.contractAmount)} />
              <InfoLine label="請求回数" value={`${row.billingCount}回`} />
              <InfoLine label="粗利" value={yen.format(row.grossProfit)} strong={row.grossProfit < 0} />
              <InfoLine label="粗利率" value={percent(row.grossProfitRate)} strong={row.grossProfitRate < 0} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" />
            契約書
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {row.contractFileUrl ? (
            <a className="inline-flex items-center gap-2 font-medium underline" href={row.contractFileUrl} target="_blank">
              <FileText className="h-4 w-4" />
              {row.contractOriginalFileName || "契約書を表示"}
            </a>
          ) : (
            <p className="text-muted-foreground">契約書は未登録です。</p>
          )}
          {row.contractExtractedAmount || row.contractExtractedBillingCount ? (
            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              OCR: {row.contractExtractedAmount ? yen.format(row.contractExtractedAmount) : "-"} / {row.contractExtractedBillingCount ?? row.billingCount}回
            </div>
          ) : null}
          {canEdit ? (
            <form action="/api/uploads/contracts" method="post" encType="multipart/form-data">
              <input type="hidden" name="projectId" value={row.id} />
              <input type="hidden" name="company" value={row.company} />
              <label className={cn(buttonVariants({ variant: "outline" }), "w-full cursor-pointer")}>
                <Upload className="h-4 w-4" />
                {row.contractFileUrl ? "契約書を差し替え" : "契約書を登録"}
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
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">案件編集</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectEditForm clients={clients} company={company} row={row} stageOptions={stageOptions} statusOptions={statusOptions} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">案件情報</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <InfoLine label="段階" value={row.stage || "-"} />
            <InfoLine label="期間" value={`${formatDate(row.startDate)} - ${formatDate(row.endDate)}`} />
            <p className="whitespace-pre-wrap text-muted-foreground">{row.memo || "メモはありません。"}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProjectEditForm({
  clients,
  company,
  row,
  stageOptions,
  statusOptions,
}: {
  clients: Option[];
  company: Company;
  row: ProjectWorkspaceRow;
  stageOptions: Option[];
  statusOptions: Option[];
}) {
  return (
    <form key={row.id} action={updateProjectInline} className="space-y-3">
      <input type="hidden" name="projectId" value={row.id} />
      <input type="hidden" name="company" value={row.company} />
      <input type="hidden" name="returnPath" value="/projects" />
      <div className="space-y-1">
        <Label>案件名</Label>
        <Input name="name" defaultValue={row.name} required />
      </div>
      <div className="space-y-1">
        <Label>クライアント</Label>
        <CreatableSelect name="clientId" defaultValue={row.clientId} options={clients} create={{ kind: "client", company }} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>ステータス</Label>
          <Select name="status" defaultValue={row.status}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>段階</Label>
          <CreatableSelect name="stage" defaultValue={row.stage} options={stageOptions} create={{ kind: "select-option", company, group: "PROJECT_STAGE" }} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>契約金額</Label>
          <Input name="contractAmount" type="number" min="0" step="1" defaultValue={row.contractAmount} required />
        </div>
        <div className="space-y-1">
          <Label>請求回数</Label>
          <Input name="billingCount" type="number" min="1" max="12" step="1" defaultValue={row.billingCount} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>開始日</Label>
          <Input name="startDate" type="date" defaultValue={row.startDate ?? ""} />
        </div>
        <div className="space-y-1">
          <Label>終了日</Label>
          <Input name="endDate" type="date" defaultValue={row.endDate ?? ""} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>メモ</Label>
        <Textarea name="memo" defaultValue={row.memo ?? ""} rows={4} />
      </div>
      <Button className="w-full">保存</Button>
    </form>
  );
}

function ProgressLine({
  done,
  doneLabel,
  label,
  remaining,
  remainingLabel,
  total,
}: {
  done: number;
  doneLabel: string;
  label: string;
  remaining: number;
  remainingLabel: string;
  total: number;
}) {
  const donePercent = progressPercent(done, total);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{yen.format(total)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${donePercent}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <span>{doneLabel}: {yen.format(done)}</span>
        <span className={remaining > 0 ? "text-right font-medium text-amber-700" : "text-right text-muted-foreground"}>
          {remainingLabel}: {yen.format(remaining)}
        </span>
      </div>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: typeof FolderKanban;
  label: string;
  tone?: "neutral" | "warn" | "danger";
  value: string;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-border bg-card text-card-foreground";
  return (
    <div className={cn("rounded-lg border p-3", toneClass)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-lg font-semibold">{value}</div>
        </div>
        <Icon className="h-5 w-5 shrink-0" />
      </div>
    </div>
  );
}

function MiniAmount({ hot, label, value }: { hot?: boolean; label: string; value: number }) {
  return (
    <div className={cn("min-w-0 rounded-lg border px-2 py-1.5", hot ? "border-amber-200 bg-amber-50 text-amber-800" : "bg-muted/30")}>
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate font-mono font-medium">{yen.format(value)}</div>
    </div>
  );
}

function InfoLine({ label, strong, value }: { label: string; strong?: boolean; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("break-words font-medium", strong ? "text-red-700" : "")}>{value}</div>
    </div>
  );
}

function ActionBadge({ children }: { children: string }) {
  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
      {children}
    </Badge>
  );
}

function CompanyBadge({ company }: { company: Company }) {
  return (
    <Badge variant="outline" className={company === "CHINA" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-800"}>
      {company === "CHINA" ? "中国" : "日本"}
    </Badge>
  );
}

function projectActionLabels(row: ProjectWorkspaceRow, showFinancials: boolean) {
  const labels: string[] = [];
  if (!row.contractFileUrl) labels.push("契約書なし");
  if (showFinancials && Math.max(row.contractAmount - row.invoicedAmount, 0) > 0) labels.push("未請求");
  if (showFinancials && row.unpaidIncomeAmount > 0) labels.push("未入金");
  if (showFinancials && row.unpaidExpenseAmount > 0) labels.push("未払い");
  if (row.status === "WAITING") labels.push("待機中");
  return labels;
}

function projectPriority(row: ProjectWorkspaceRow, showFinancials: boolean) {
  return projectActionLabels(row, showFinancials).length;
}

function matchesFilter(row: ProjectWorkspaceRow, filter: WorkFilter, showFinancials: boolean) {
  const uninvoicedAmount = Math.max(row.contractAmount - row.invoicedAmount, 0);
  if (filter === "all") return true;
  if (filter === "needsAction") return projectPriority(row, showFinancials) > 0;
  if (filter === "uninvoiced") return showFinancials && uninvoicedAmount > 0;
  if (filter === "unpaidIncome") return showFinancials && row.unpaidIncomeAmount > 0;
  if (filter === "unpaidExpense") return showFinancials && row.unpaidExpenseAmount > 0;
  if (filter === "missingContract") return !row.contractFileUrl;
  if (filter === "completed") return row.status === "COMPLETED";
  return true;
}

function filterOptions(showFinancials: boolean): Array<{ label: string; value: WorkFilter }> {
  const options: Array<{ label: string; value: WorkFilter }> = [
    { label: "要対応", value: "needsAction" },
    { label: "すべて", value: "all" },
    { label: "契約書なし", value: "missingContract" },
  ];
  if (showFinancials) {
    options.splice(
      2,
      0,
      { label: "未請求", value: "uninvoiced" },
      { label: "未入金", value: "unpaidIncome" },
      { label: "未払い", value: "unpaidExpense" },
    );
  }
  options.push({ label: "完了", value: "completed" });
  return options;
}

function countForFilter(rows: ProjectWorkspaceRow[], filter: WorkFilter, showFinancials: boolean) {
  return rows.filter((row) => matchesFilter(row, filter, showFinancials)).length;
}

function buildSummary(rows: ProjectWorkspaceRow[], showFinancials: boolean) {
  return rows.reduce(
    (summary, row) => {
      const uninvoicedAmount = Math.max(row.contractAmount - row.invoicedAmount, 0);
      summary.total += 1;
      summary.needsAction += projectPriority(row, showFinancials) > 0 ? 1 : 0;
      summary.uninvoicedAmount += uninvoicedAmount;
      summary.unpaidIncomeAmount += row.unpaidIncomeAmount;
      summary.missingContract += row.contractFileUrl ? 0 : 1;
      summary.completed += row.status === "COMPLETED" ? 1 : 0;
      return summary;
    },
    {
      completed: 0,
      missingContract: 0,
      needsAction: 0,
      total: 0,
      uninvoicedAmount: 0,
      unpaidIncomeAmount: 0,
    },
  );
}

function progressPercent(done: number, total: number) {
  if (total <= 0) return done > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}
