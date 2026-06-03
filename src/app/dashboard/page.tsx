import Link from "next/link";
import { BarChart3, FileCheck2, FolderKanban, ReceiptText } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany, type CompanyScope } from "@/lib/company";
import { yen } from "@/lib/format";
import { can } from "@/lib/rbac";
import { selectOptionsFor } from "@/lib/select-options";
import { paidForIssued, projectMoney, readData, scopedProjectsForUser } from "@/lib/store";
import { DashboardTable } from "./dashboard-table";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company: CompanyScope = companyFromParam(params.company);
  const user = await getCurrentUser();
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
      stage: project.stage ?? "制作资料",
      billingTotal: project.contractAmount ?? 0,
      billingCount: project.billingCount ?? 1,
      createdRounds: data.issuedInvoices
        .filter((invoice) => !invoice.deletedAt && invoice.projectId === project.id && invoice.internalMemo?.startsWith("INSTALLMENT:"))
        .map((invoice) => Number(invoice.internalMemo?.replace("INSTALLMENT:", "")))
        .filter((round) => Number.isFinite(round)),
    }));

  const counts = {
    CHINA: projects.filter((project) => matchesCompany(project, "CHINA")).length,
    JAPAN: projects.filter((project) => matchesCompany(project, "JAPAN")).length,
  };
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

  return (
    <AppShell>
      <PageHeader title="Dashboard" description="案件、請求、支払いの状態を一覧で確認できます。">
        <Button asChild size="sm" variant={company === "CHINA" ? "default" : "outline"}>
          <Link href="/dashboard?company=CHINA">中国支社 {counts.CHINA}</Link>
        </Button>
        <Button asChild size="sm" variant={company === "JAPAN" ? "default" : "outline"}>
          <Link href="/dashboard?company=JAPAN">日本本社 {counts.JAPAN}</Link>
        </Button>
      </PageHeader>

      <div className="mb-7 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard accent="cyan" icon={FolderKanban} label="Projects" progress={Math.min(100, rows.length * 6)} value={`${rows.length}件`} />
        <MetricCard accent="orange" icon={ReceiptText} label="Issued Total" progress={Math.min(100, Math.round(issuedTotal / Math.max(rows.reduce((sum, row) => sum + row.billingTotal, 1), 1) * 100))} value={yen.format(issuedTotal)} />
        <MetricCard accent="purple" icon={FileCheck2} label="Paid Income" progress={Math.min(100, Math.round((paidIncome / Math.max(issuedTotal, 1)) * 100))} value={yen.format(paidIncome)} />
        <MetricCard accent="green" icon={BarChart3} label="Gross Profit" progress={Math.max(0, Math.min(100, Math.round((grossProfit / Math.max(paidIncome, 1)) * 100)))} value={yen.format(grossProfit)} />
      </div>

      <div className="mb-7 grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Total Revenue</CardTitle>
              <div className="mt-2 text-3xl font-semibold">{yen.format(issuedTotal)}</div>
            </div>
            <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Progress {progress}%</div>
          </CardHeader>
          <CardContent>
            <div className="mb-5 flex gap-5 text-xs">
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-cyan-400" />請求</span>
              <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-violet-500" />支払い</span>
            </div>
            <RevenueChart issuedTotal={issuedTotal} receivedTotal={receivedTotal} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Balance</CardTitle>
            <div className="text-sm text-muted-foreground">請求と受領請求書のバランス</div>
          </CardHeader>
          <CardContent>
            <div className="space-y-5">
              <BalanceRow color="bg-cyan-400" label="発行請求" value={issuedTotal} max={Math.max(issuedTotal, receivedTotal, 1)} />
              <BalanceRow color="bg-violet-500" label="受領請求" value={receivedTotal} max={Math.max(issuedTotal, receivedTotal, 1)} />
              <BalanceRow color="bg-emerald-500" label="入金済み" value={paidIncome} max={Math.max(issuedTotal, receivedTotal, 1)} />
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
  accent: "cyan" | "green" | "orange" | "purple";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  progress: number;
  value: string;
}) {
  const tone = {
    cyan: { bar: "bg-cyan-400", bg: "bg-cyan-50", text: "text-cyan-700" },
    green: { bar: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
    orange: { bar: "bg-orange-400", bg: "bg-orange-50", text: "text-orange-700" },
    purple: { bar: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-700" },
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
        <div className="text-2xl font-semibold">{value}</div>
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

function RevenueChart({ issuedTotal, receivedTotal }: { issuedTotal: number; receivedTotal: number }) {
  const issuedPoints = [0.1, 0.18, 0.12, 0.32, 0.22, 0.5, 0.42, 0.68, 0.54, 0.72, 0.88, 0.76].map((value) => Math.max(6, value * (issuedTotal ? 100 : 40)));
  const receivedPoints = [0.05, 0.12, 0.2, 0.26, 0.24, 0.35, 0.4, 0.48, 0.45, 0.56, 0.62, 0.66].map((value) => Math.max(6, value * (receivedTotal ? 100 : 35)));

  return (
    <div className="relative h-72 overflow-hidden rounded-lg border bg-gradient-to-b from-white to-muted/20 p-5">
      <div className="absolute inset-x-5 top-5 bottom-10 grid grid-rows-5">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="border-t" />)}
      </div>
      <div className="relative flex h-full items-end gap-2 pb-8">
        {issuedPoints.map((point, index) => (
          <div key={index} className="flex h-full flex-1 items-end gap-1">
            <div className="w-full rounded-t bg-cyan-400/70" style={{ height: `${point}%` }} />
            <div className="w-full rounded-t bg-violet-500/70" style={{ height: `${receivedPoints[index]}%` }} />
          </div>
        ))}
      </div>
      <div className="absolute inset-x-5 bottom-3 flex justify-between text-xs text-muted-foreground">
        {["Jan", "Mar", "May", "Jul", "Sep", "Nov"].map((month) => <span key={month}>{month}</span>)}
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
