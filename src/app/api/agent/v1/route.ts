import { describeAgentApi } from "@/lib/agent-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Discovery only: no data and no authentication state is returned here.
export async function GET() {
  return Response.json(describeAgentApi(), { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
