import type { DocumentRow } from "@/lib/documents";

export function compareProjects(a: { projectId?: string; projectName?: string }, b: { projectId?: string; projectName?: string }) {
  if (!a.projectId && b.projectId) return 1;
  if (a.projectId && !b.projectId) return -1;
  return (a.projectName || "").localeCompare(b.projectName || "", "ja", { numeric: true }) || (a.projectId || "").localeCompare(b.projectId || "");
}

export function orderDocuments(rows: DocumentRow[], sort: string) {
  return [...rows].sort((a, b) => (sort === "project" ? compareProjects(a, b) :
    sort === "amount-desc" ? (b.total || 0) - (a.total || 0) :
    sort === "name" ? a.counterpart.localeCompare(b.counterpart, "ja") : 0) ||
    (sort === "date-asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) || a.id.localeCompare(b.id));
}

export function groupDocuments(rows: DocumentRow[], sort: string, limit: number) {
  const groups = new Map<string, DocumentRow[]>();
  for (const row of rows.slice(0, limit)) {
    const key = sort === "project" ? `project:${row.projectId || "none"}` : row.month;
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  return [...groups];
}
