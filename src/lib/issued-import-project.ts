import { randomUUID } from "node:crypto";
import { companyFromParam, type CompanyScope } from "@/lib/company";
import { visibleProjects } from "@/lib/documents";
import { can } from "@/lib/rbac";
import type { AppData, Project, User } from "@/lib/types";

type ImportHints = { projectName: string; clientName: string; text: string; fileName: string };
const normalizeName = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
const cleanName = (name: string) => name.normalize("NFKC").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160);
const clientKey = (name: string) => normalizeName(name).replace(/(?:御中|様)$/, "");

function containsName(text: string, name: string) {
  const key = normalizeName(name);
  if (key.length < 3) return false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = /[a-z0-9]/i.test(key[0]) ? "(?<![a-z0-9])" : "";
  const end = /[a-z0-9]/i.test(key.at(-1)!) ? "(?![a-z0-9])" : "";
  return new RegExp(boundary + escaped + end, "u").test(text.normalize("NFKC").toLocaleLowerCase().replace(/[^\S\r\n]+/g, ""));
}

// Called inside the invoice mutation, after duplicate checks, so creation is atomic.
export function resolveIssuedImportProject(
  data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope,
  requestedId: string, hints: ImportHints,
) {
  if (!can(user, "manage:issuedInvoices")) throw new Error("権限がありません");
  const projects = visibleProjects(data, user).filter((p) => companyFromParam(p.company) === company);
  if (requestedId) {
    const project = projects.find((p) => p.id === requestedId);
    if (!project) throw new Error("指定した案件に取り込む権限がありません");
    return { project, projectCreated: false, projectMatch: "manual" as const, warnings: [] as string[] };
  }
  const clients = data.clients.filter((c) => !c.deletedAt && companyFromParam(c.company) === company);
  const clientName = cleanName(hints.clientName).replace(/\s*(御中|様)$/, "");
  const projectName = cleanName(hints.projectName);
  const matchedClients = clientName ? clients.filter((c) => clientKey(c.companyName) === clientKey(clientName)) : [];
  const compatible = (p: Project) => !clientName || matchedClients.some((c) => c.id === p.clientId);
  const named = projects.filter((p) => projectName
    ? normalizeName(p.name) === normalizeName(projectName)
    : containsName(hints.text, p.name));
  const candidates = named.filter(compatible);
  if (candidates.length === 1) {
    return { project: candidates[0], projectCreated: false, projectMatch: "name" as const, warnings: [] as string[] };
  }
  // A new explicit project name must not be merged into a different project for the same client.
  if (!projectName && !named.length && matchedClients.length === 1) {
    const sameClient = data.projects.filter((p) => !p.deletedAt && p.status !== "ARCHIVED" &&
      companyFromParam(p.company) === company && p.clientId === matchedClients[0].id);
    if (sameClient.length === 1 && projects.some((p) => p.id === sameClient[0].id)) {
      return { project: sameClient[0], projectCreated: false, projectMatch: "client" as const,
        warnings: ["請求先から案件を自動判定しました。案件名を確認してください。"] };
    }
  }
  if (!can(user, "manage:projects")) throw new Error("案件を特定できません。新規案件を作成する権限が必要です");
  if (!can(user, "manage:clients") && matchedClients.length !== 1) throw new Error("請求先を登録する権限が必要です");
  const warnings = ["案件を自動作成しました。案件名と請求先を確認してください。"];
  if (named.length > 1 || matchedClients.length > 1) warnings.push("同名の候補が複数あるため、既存案件への自動登録を保留しました。");
  const timestamp = new Date().toISOString();
  let client = matchedClients.length === 1 ? matchedClients[0] : undefined;
  if (!client) {
    // Unknown recipients are visibly provisional, never our own company by default.
    const name = matchedClients.length > 1 ? `${clientName}（要確認）` : clientName || "請求先未確認";
    client = clients.find((c) => c.companyName === name && c.memo === "発行請求書OCRから自動作成。請求先要確認。");
    if (!client) {
      client = { id: randomUUID(), company, companyName: name, memo: "発行請求書OCRから自動作成。請求先要確認。", createdAt: timestamp, updatedAt: timestamp };
      data.clients.unshift(client);
    }
  }
  if (!clientName) warnings.push("請求先を抽出できなかったため、請求先未確認として登録しました。");
  const id = randomUUID();
  const fallback = cleanName(hints.fileName.replace(/\.[^.]+$/, "")) || "発行請求書";
  const name = projectName ? projectName + (candidates.length > 1 ? "（OCR確認待ち）" : "")
    : clientName ? `${clientName} 請求案件` : `${fallback}（要確認 ${id.slice(0, 8)}）`;
  // Repeat imports for the same newly identified project reuse it, including parallel requests.
  const reusable = projectName || clientName ? projects.filter((p) => p.clientId === client!.id && p.name === name) : [];
  if (reusable.length === 1) return { project: reusable[0], projectCreated: false, projectMatch: "name" as const, warnings: warnings.slice(1) };
  const project: Project = {
    id, company, name, clientId: client.id, managerId: user.id, memberIds: [user.id],
    status: "PLANNING", contractAmount: 0, billingCount: 1,
    memo: "発行請求書OCRから自動作成。案件名・請求先・契約情報要確認。",
    createdAt: timestamp, updatedAt: timestamp,
  };
  data.projects.unshift(project);
  return { project, projectCreated: true, projectMatch: "created" as const, warnings };
}
