import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth";
import { companyFromParam, matchesCompany, partnerMatchesCompany } from "@/lib/company";
import { importShipmentViews, unassignedImportDocuments } from "@/lib/import-shipment-views";
import { importToday } from "@/lib/import-shipments";
import { assertCompanyAccess, can } from "@/lib/rbac";
import { defaultPathForUser } from "@/lib/app-navigation";
import { readDataForRequest as readData } from "@/lib/store";
import { ShipmentDetail } from "./shipment-detail";

export default async function ImportShipmentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const company = companyFromParam(typeof search.company === "string" ? search.company : undefined);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user, "view:imports")) redirect(defaultPathForUser(user));
  assertCompanyAccess(user, company);
  const data = await readData(), today = importToday();
  const view = importShipmentViews(data, company, today).find((row) => row.id === id);
  if (!view) notFound();
  const clients = data.clients.filter((row) => !row.deletedAt && partnerMatchesCompany(row, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"))
    .map((row) => ({ value: row.id, label: row.companyName }));
  const projects = data.projects.filter((row) => !row.deletedAt && matchesCompany(row, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "ja"))
    .map((row) => ({ value: row.id, label: row.name, clientId: row.clientId }));
  const vendors = data.vendors.filter((row) => !row.deletedAt && partnerMatchesCompany(row, company))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.companyName.localeCompare(b.companyName, "ja"))
    .map((row) => ({ value: row.id, label: row.companyName }));
  return <AppShell><ShipmentDetail key={`${company}:${id}`} view={view} today={today} company={company}
    canEdit={can(user, "manage:imports")} clients={clients} projects={projects} vendors={vendors}
    unassigned={unassignedImportDocuments(data, company)} /></AppShell>;
}
