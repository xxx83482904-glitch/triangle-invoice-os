import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/auth";
import { readData } from "@/lib/store";
import { canExportSection, exportQuerySchema, sectionExport, bankExportCsv, documentExportCsv } from "@/lib/section-export";
import { sectionArchive } from "@/lib/section-export-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "ログインしてください" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const parsed = exportQuerySchema.safeParse(Object.fromEntries(params));
  const format = params.get("format") || "preview";
  if (!parsed.success || !["preview", "csv", "zip"].includes(format)) return Response.json({ error: "期間・書き出し条件を確認してください" }, { status: 400, headers });
  if (!canExportSection(user, parsed.data.scope)) return Response.json({ error: "書き出し権限がありません" }, { status: 403, headers });
  const data = await readData();
  const bundle = sectionExport(data, user, parsed.data);
  if (format === "preview") return Response.json(bundle, { headers });
  if (bundle.documents.length + bundle.bank.length > 10000) return Response.json({ error: "1万件を超えています。期間を分けてください" }, { status: 413, headers });
  const filename = `triangle-${parsed.data.scope}-${parsed.data.start}-${parsed.data.end}.${format}`;
  if (format === "csv") return new Response(parsed.data.scope === "banking" ? bankExportCsv(bundle) : documentExportCsv(bundle), { headers: {
    ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`,
  } });
  // The same snapshot drives the list and generated PDFs inside the archive.
  return new Response(Readable.toWeb(sectionArchive(bundle, data, request.signal)) as ReadableStream<Uint8Array>, { headers: {
    ...headers, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`,
  } });
}
