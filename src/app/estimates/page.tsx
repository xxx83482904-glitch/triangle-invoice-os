import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app/shell";
import { EstimatesWorkspace } from "@/components/app/estimates-workspace";
import { getCurrentUser } from "@/lib/auth";
import { matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { can, companyForUser, defaultPathForRole } from "@/lib/rbac";
import { readDataForRequest } from "@/lib/store";

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:estimates")) redirect(defaultPathForRole(user.role));
  const params = await searchParams;
  const company = companyForUser(user, params.company);
  const data = await readDataForRequest();
  const projects = visibleProjects(data, user).filter((p) => matchesCompany(p, company));
  const ids = new Set(projects.map((p) => p.id));
  const estimates = data.estimates.filter((e) => !e.deletedAt && ids.has(e.projectId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <AppShell><PageHeader title="見積書" /><EstimatesWorkspace key={company} company={company} estimates={estimates}
    initialId={params.document} canEdit={can(user, "manage:estimates")}
    projects={projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, updatedAt: p.updatedAt }))}
    clients={data.clients.filter((c) => !c.deletedAt && partnerMatchesCompany(c, company)).map((c) => ({ id: c.id, name: c.companyName }))} />
  </AppShell>;
}
