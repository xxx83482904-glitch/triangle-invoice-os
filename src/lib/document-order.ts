import type { DocumentRow } from "@/lib/documents";
import { entityNameKey, splitBillingProjectName } from "@/lib/billing-project-name";

export const documentCounterpartKey = (row: DocumentRow) => row.counterpartId || `name:${entityNameKey(row.counterpart)}`;

export type DocumentProjectOption = { value: string; label: string; clientId?: string; clientName?: string };
export function documentProjectOptions(projects: DocumentProjectOption[], selected: string) {
  const groups = new Map<string, DocumentProjectOption[]>();
  for (const project of projects) {
    const { projectName } = splitBillingProjectName(project.label);
    const key = project.clientId && projectName ? JSON.stringify([project.clientId, entityNameKey(projectName)]) : project.value;
    const group = groups.get(key);
    if (group) group.push(project); else groups.set(key, [project]);
  }
  return [...groups.values()].map((group) => {
    // Presentation only: opening a select never changes the document's stored project ID.
    const project = group.find((p) => p.value === selected) || group.find((p) => !splitBillingProjectName(p.label).billingLabel) || group[0];
    const { projectName } = splitBillingProjectName(project.label);
    return { ...project, label: projectName || `案件名未設定 / ${project.label}` };
  });
}

export function compareProjects(a: { projectId?: string; projectName?: string }, b: { projectId?: string; projectName?: string }) {
  if (!a.projectId && b.projectId) return 1;
  if (a.projectId && !b.projectId) return -1;
  return (a.projectName || "").localeCompare(b.projectName || "", "ja", { numeric: true }) || (a.projectId || "").localeCompare(b.projectId || "");
}

export function orderDocuments(rows: DocumentRow[], sort: string) {
  return [...rows].sort((a, b) => (sort === "project" ? compareProjects(a, b) :
    sort === "amount-desc" ? (b.total || 0) - (a.total || 0) :
    sort === "name" || sort === "client" ? a.counterpart.localeCompare(b.counterpart, "ja") || documentCounterpartKey(a).localeCompare(documentCounterpartKey(b)) : 0) ||
    (sort === "date-asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) || a.id.localeCompare(b.id));
}

export function groupDocuments(rows: DocumentRow[], sort: string, limit: number) {
  const groups = new Map<string, DocumentRow[]>();
  for (const row of rows.slice(0, limit)) {
    const key = sort === "client" ? `counterpart:${documentCounterpartKey(row)}` : sort === "project" ? `project:${row.projectId || "none"}` : row.month;
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  return [...groups];
}
