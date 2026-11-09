import { companyFromParam, matchesCompany } from "@/lib/company";
import { uploadedFileNameFromUrl } from "@/lib/files";
import { can, canAccessCompany } from "@/lib/rbac";
import type { AppData, User } from "@/lib/types";

// Import viewers can open originals attached to live shipments, even outside their assigned projects.
// This branch grants no access to unassigned paperwork, other companies, or deleted rows.
export function canViewImportFile(data: AppData, user: Pick<User, "role" | "featureAccess">, name: string) {
  if (!can(user, "view:imports") || !name || /[\\/\x00]/.test(name) || name === "." || name === "..") return false;
  const shipments = new Map((data.importShipments ?? []).filter((row) => !row.deletedAt && canAccessCompany(user, companyFromParam(row.company)))
    .map((row) => [row.id, companyFromParam(row.company)]));
  const matches = (url?: string) => Boolean(url && uploadedFileNameFromUrl(url) === name);
  return data.mailDocuments.some((row) => !row.deletedAt && row.importShipmentId && shipments.get(row.importShipmentId) === companyFromParam(row.company) && matches(row.fileUrl))
    || data.receivedInvoices.some((row) => {
      const company = row.importShipmentId ? shipments.get(row.importShipmentId) : undefined;
      return Boolean(company && !row.deletedAt && matches(row.fileUrl)
        && data.projects.some((project) => project.id === row.projectId && !project.deletedAt && matchesCompany(project, company)));
    });
}
