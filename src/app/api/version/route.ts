import { runningBuildSha } from "@/lib/build-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ build: runningBuildSha() }, { headers: { "Cache-Control": "no-store" } });
}
