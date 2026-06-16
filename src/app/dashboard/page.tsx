import { redirect } from "next/navigation";
import { BarChart3, FileCheck2, FolderKanban, ReceiptText } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { yen } from "@/lib/format";
import { can, defaultPathForRole } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { paidForIssued, projectMoney, readData, scopedProjectsForUser } from "@/lib/store";
import { DashboardTable } from "./dashboard-table";

const MONTHS_JP = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function buildMonthlyData(
  invoices: Array<{ issueDate: string; total: number }>,
  year: number,
) {
  const byMonth = Array.from({ length: 12 }, () => 0);
  for (const inv of invoices) {
    const d = new Date(inv.issueDate);
    if (d.getFullYear() === year) {
      byMonth[d.getMonth()] += inv.total;
    }
  }
  return byMonth;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company: CompanyScope = companyFromParam(params.company);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:dashboard")) redirect(defaultPathForRole(user.role));
  const data = await readData();
  const projects = user ? scopedProjectsForUser(data, user) : [];
  const clients = data.clients
    .filter((client) => !client.deletedAt && partnerMatchesCompany(client, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"));
  const stageOptions = selectOptionsFor(data, "PROJECT_STAGE", company);
  const rows = projects
    .filter((project) => matchesCompany(project, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((project, index) => ({
      id: project.id,
      index: project.sortOrder ?? index + 1,
      name: project.name,
      clientId: project.clientId,
      clientName: data.clients.find((client) => client.id === project.clientId)?.companyName ?? "",
      company: companyFromParam(project.company),
      stage: project.stage ?? "",
      billingTotal: project.contractAmount ?? 0,
      billingCount: project.billingCount ?? 1,
      createdRounds: data.issuedInvoices
        .filter((invoice) => !invoice.deletedAt && invoice.projectId === project.id && invoice.internalMemo?.startsWith("INSTALLMENT:"))
        .map((invoice) => Number(invoice.internalMemo?.replace("INSTALLMENT:", "")))
        .filter((round) => Number.isFinite(round)),
    }));

  const projectIds = new Set(rows.map((row) => row.id));
  const issued = data.issuedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId));
  const received = data.receivedInvoices.filter((invoice) => !invoice.deletedAt && projectIds.has(invoice.projectId));
  const paidIncome = issued.reduce((sum, invoice) => sum + paidForIssued(data, invoice.id), 0);
  const issuedTotal = issued.reduce((sum, invoice) => sum + invoice.total, 0);
  const receivedTotal = received.reduce((sum, invoice) => sum + invoice.total, 0);
  const grossProfit = rows.reduce((sum, row) => sum + projectMoney(data, row.id).grossProfit, 0);
  const createdInstallments = rows.reduce((sum, row) => sum + row.createdRounds.length, 0);
  const expectedInstallments = rows.reduce((sum, row) => sum + row.billingCount, 0);
  const progress = expectedInstallments > 0 ? Math.round((createdInstallments / expectedInstallments) * 100) : 0;

  const thisYear = new Date().getFullYear();
  const issuedByMonth = buildMonthlyData(issued, thisYear);
  const receivedByMonth = buildMonthlyData(received, thisYear);
  const maxMonthly = Math.max(...issuedByMonth, ...receivedByMonth, 1);

  return (
    <AppShell>
      <PageHeader title="ダッシュボード" description="案件、請求、支払いの状態を一覧で確認できます。" />

      <div className="mb-7 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard accent="blue" icon={FolderKanban} label="案件数" progress={Math.min(100, rows.length * 6)} value={`${rows.length}件`} />
        <MetricCard accent="sky" icon={ReceiptText} label="発行請求合計" progress={Math.min(100, Math.round(issuedTotal / Math.max(rows.reduce((sum, row) => sum + row.billingTotal, 1), 1) * 100))} value={yen.format(issuedTotal)} />
        <MetricCard accent="indigo" icon={FileCheck2} label="入金済み" progress={Math.min(100, Math.round((paidIncome / Math.max(issuedTotal, 1)) * 100))} value={yen.format(paidIncome)} />
        <MetricCard accent="slate" icon={BarChart3} label="粗利" progress={Math.max(0, Math.min(100, Math.round((grossProfit / Math.max(paidIncome, 1)) * 100)))} value={yen.format(grossProfit)} />
      </div>

      <div className="mb-7 grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>月別請求推移（{thisYear}年）</CardTitle>
              <div className="mt-2 text-2xl font-semibold">{yen.format(issuedTotal)}</div>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">進捗 {progress}%</div>
          </CardHeader>
          <CardContent>
            <div className="mb-5 flex gap-5 text-xs">
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-blue-500" />発行請求</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-sky-400" />受領請求</span>
            </div>
            <RevenueChart issuedByMonth={issuedByMonth} receivedByMonth={receivedByMonth} maxMonthly={maxMonthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>請求バランス</CardTitle>
            <div className="text-sm text-muted-foreground">発行・受領・入金の比較</div>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <BalanceRow color="bg-blue-500" label="発行請求" value={issuedTotal} max={Math.max(issuedTotal, receivedTotal, 1)} />
              <BalanceRow color="bg-sky-400" label="受領請求" value={receivedTotal} max={Math.max(issuedTotal, receivedTotal, 1)} />
              <BalanceRow color="bg-indigo-500" label="入金済み" value={paidIncome} max={Math.max(issuedTotal, receivedTotal, 1)} />
            </div>
          </CardContent>
        </Card>
      </div>

      <DashboardTable
        canEdit={Boolean(user && can(user, "manage:projects"))}
        clients={clients.map((client) => ({ id: client.id, companyName: client.companyName }))}
        stageOptions={stageOptions.map((option) => ({ label: option.label, value: option.value }))}
        rows={rows}
      />
    </AppShell>
  );
}

function MetricCard({
  accent,
  icon: Icon,
  label,
  progress,
  value,
}: {
  accent: "blue" | "indigo" | "sky" | "slate";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  progress: number;
  value: string;
}) {
  const tone = {
    blue: { bar: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
    indigo: { bar: "bg-indigo-500", bg: "bg-indigo-50", text: "text-indigo-700" },
    sky: { bar: "bg-sky-400", bg: "bg-sky-50", text: "text-sky-700" },
    slate: { bar: "bg-slate-500", bg: "bg-slate-50", text: "text-slate-700" },
  }[accent];

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className={`grid h-10 w-10 place-items-center rounded-lg ${tone.bg} ${tone.text}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <div className="text-xl font-semibold">{value}</div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueChart({
  issuedByMonth,
  receivedByMonth,
  maxMonthly,
}: {
  issuedByMonth: number[];
  receivedByMonth: number[];
  maxMonthly: number;
}) {
  const toPercent = (v: number) => Math.max(v > 0 ? 4 : 0, Math.round((v / maxMonthly) * 100));

  return (
    <div className="relative h-72 overflow-hidden rounded-lg border bg-gradient-to-b from-white to-muted/20 p-5">
      <div className="absolute inset-x-5 top-5 bottom-10 grid grid-rows-5">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="border-t" />)}
      </div>
      <div className="relative flex h-full items-end gap-1 pb-8">
        {issuedByMonth.map((issued, index) => (
          <div key={index} className="group relative flex h-full flex-1 flex-col items-end justify-end gap-0.5" title={`${MONTHS_JP[index]}: 発行 ${yen.format(issued)} / 受領 ${yen.format(receivedByMonth[index])}`}>
            <div className="w-full rounded-t bg-blue-500/70 transition-all" style={{ height: `${toPercent(issued)}%` }} />
            <div className="w-full rounded-t bg-sky-400/70 transition-all" style={{ height: `${toPercent(receivedByMonth[index])}%` }} />
          </div>
        ))}
      </div>
      <div className="absolute inset-x-5 bottom-3 flex justify-between text-[10px] text-muted-foreground">
        {MONTHS_JP.map((m) => <span key={m}>{m}</span>)}
      </div>
    </div>
  );
}

function BalanceRow({ color, label, max, value }: { color: string; label: string; max: number; value: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{yen.format(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(4, Math.min(100, Math.round((value / max) * 100)))}%` }} />
      </div>
    </div>
  );
}
