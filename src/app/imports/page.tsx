import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { importShipmentViews, unassignedImportDocuments } from "@/lib/import-shipment-views";
import { can, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest as readData } from "@/lib/store";
import { ImportsWorkspace } from "./imports-workspace";

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const company = companyFromParam(params.company);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:imports")) redirect(defaultPathForRole(user.role));
  const data = await readData();
  const projects = data.projects
    .filter((project) => !project.deletedAt && matchesCompany(project, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja"))
    .map((project) => ({ label: project.name, value: project.id }));
  const vendors = data.vendors
    .filter((vendor) => !vendor.deletedAt && partnerMatchesCompany(vendor, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"))
    .map((vendor) => ({ label: vendor.companyName, value: vendor.id }));

  return (
    <AppShell>
      <PageHeader title="輸入" description="1回の輸入（便）ごとに、仕入先インボイス・パッキングリスト・AWB/B/L・輸入許可通知書・通関業者の請求書をまとめ、関税と輸入消費税を記録します。" />
      <ImportsWorkspace
        key={`${company}:${params.shipment || ""}`}
        initialId={params.shipment}
        canEdit={can(user, "manage:imports")}
        company={company}
        rows={importShipmentViews(data, company)}
        unassigned={unassignedImportDocuments(data, company)}
        projects={projects}
        vendors={vendors}
      />
    </AppShell>
  );
}
