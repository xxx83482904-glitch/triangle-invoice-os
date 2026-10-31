import { getCurrentUser } from "@/lib/auth";
import { companyFromParam } from "@/lib/company";
import { uploadedFileExists } from "@/lib/files";
import { integrityKinds, integrityReport } from "@/lib/integrity";
import { can, canAccessCompany } from "@/lib/rbac";
import { readData } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

// Same report as /banking/integrity, as JSON for scripts and agents. Read-only.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "ログインしてください" }, { status: 401, headers });
  if (!can(user, "view:banking")) return Response.json({ error: "権限がありません" }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const company = companyFromParam(params.get("company"));
  if (!canAccessCompany(user, company)) return Response.json({ error: "権限がありません" }, { status: 403, headers });
  const kind = params.get("kind") || "all";
  if (kind !== "all" && !Object.hasOwn(integrityKinds, kind)) return Response.json({ error: "種類が不正です", kinds: Object.keys(integrityKinds) }, { status: 400, headers });
  const report = integrityReport(await readData(), company, { fileExists: uploadedFileExists });
  return Response.json(kind === "all" ? report : { ...report, issues: report.issues.filter((issue) => issue.kind === kind) }, { headers });
}
