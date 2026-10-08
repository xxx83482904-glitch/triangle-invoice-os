import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { bankSyncBusy, queueBankSync, runBankSync } from "@/lib/banking-sync";
import { bankingError, moneyForwardConfig } from "@/lib/moneyforward-client";
import { readData } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "ログインが必要です" }, 401);
  if (!can(user, "view:banking")) return json({ error: "権限がありません" }, 403);
  const company = new URL(request.url).searchParams.get("company");
  if (company !== "JAPAN" && company !== "CHINA") return json({ error: "会社の指定が必要です" }, 400);
  const state = (await readData()).bankSyncStates.find((row) => row.company === company);
  return json({ state: state || null, busy: bankSyncBusy(state), configured: Boolean(moneyForwardConfig(company)) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "ログインが必要です" }, 401);
  if (!can(user, "manage:banking")) return json({ error: "権限がありません" }, 403);
  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(request.url).origin;
  if (!origin || origin !== expectedOrigin) return json({ error: "送信元が一致しません" }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "入力形式が不正です" }, 400);
  const company = new URL(request.url).searchParams.get("company");
  if (company !== "JAPAN" && company !== "CHINA") return json({ error: "会社の指定が必要です" }, 400);
  try {
    const text = await request.text();
    if (text.length > 2000) return json({ error: "入力が大きすぎます" }, 413);
    const job = await queueBankSync(company, JSON.parse(text), user);
    after(() => runBankSync(job));
    return json({ success: true, runId: job.runId }, 202);
  } catch (error) { return json({ error: bankingError(error) }, 400); }
}
