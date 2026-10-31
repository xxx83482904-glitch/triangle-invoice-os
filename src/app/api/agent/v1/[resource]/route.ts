import { ZodError } from "zod";
import { AgentError, isAgentResource, listAgentResource } from "@/lib/agent-api";
import { verifyAgentToken } from "@/lib/agent-tokens";
import { uploadedFileExists } from "@/lib/files";
import { readData } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!isAgentResource(resource)) return Response.json({ error: "リソースが見つかりません" }, { status: 404, headers });
  const data = await readData();
  const verified = verifyAgentToken(data, request.headers.get("authorization"));
  if (!verified.ok) return Response.json({ error: verified.error }, { status: verified.status, headers });
  try {
    const result = listAgentResource(data, verified.auth, resource, Object.fromEntries(new URL(request.url).searchParams), { fileExists: uploadedFileExists });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof AgentError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError) return Response.json({ error: "絞り込み条件が不正です", issues: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) }, { status: 400, headers });
    return Response.json({ error: error instanceof Error ? error.message : "読み取りに失敗しました" }, { status: 500, headers });
  }
}
