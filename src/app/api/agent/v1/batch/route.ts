import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { agentBatchSchema, agentRequestHash, AgentError, findAgentRequest, recordAgentRequest, runAgentOperations, type AgentBatchOutcome, type AgentOperationResult } from "@/lib/agent-api";
import { touchAgentToken, verifyAgentToken } from "@/lib/agent-tokens";
import { mutateData, readData } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 1_000_000;

function revalidate() {
  for (const path of ["/banking", "/banking/reconcile", "/banking/integrity", "/received-invoices", "/issued-invoices", "/mail-sorter", "/documents", "/partners", "/projects", "/dashboard"]) revalidatePath(path);
}

// Every operation calls the same library functions as the screens. Nothing is saved on a dry run or on a
// failed batch; the audit log records origin "agent" with the token id, never the token itself.
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "本文が大きすぎます" }, { status: 413, headers });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return Response.json({ error: "JSON を解釈できません" }, { status: 400, headers }); }
  const data = await readData();
  const verified = verifyAgentToken(data, request.headers.get("authorization"));
  if (!verified.ok) return Response.json({ error: verified.error }, { status: verified.status, headers });
  const parsed = agentBatchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "本文が不正です", issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) }, { status: 400, headers });
  const auth = verified.auth, batch = parsed.data, requestHash = agentRequestHash(batch);
  const origin = { kind: "agent" as const, tokenId: auth.token.id, reason: batch.reason };
  try {
    if (batch.idempotencyKey && !batch.dryRun) {
      const previous = findAgentRequest(data, auth.token.id, batch.idempotencyKey);
      if (previous) return previous.requestHash === requestHash
        ? Response.json({ ...(previous.result as AgentBatchOutcome), replayed: true, applied: true }, { headers })
        : Response.json({ error: "同じ idempotencyKey が別の内容で使われています" }, { status: 409, headers });
    }
    // Rehearse on a copy first: the response can describe every failure without touching the store.
    const rehearsal = runAgentOperations(structuredClone(data), auth, batch, { stopOnFailure: batch.atomicity === "batch" });
    if (batch.dryRun) return Response.json({ ...rehearsal, dryRun: true, applied: false }, { headers });
    if (batch.atomicity === "batch") {
      if (rehearsal.failed) return Response.json({ ...rehearsal, applied: false }, { status: 422, headers });
      const outcome = await mutateData(auth.user.id, "AGENT_BATCH", "AgentBatch", randomUUID(), (live) => {
        const result = runAgentOperations(live, auth, batch, { stopOnFailure: true });
        if (result.failed) throw new AgentError(409, `保存時に失敗しました: ${result.results.find((row) => row.status === "failed")?.error}`);
        touchAgentToken(live, auth.token.id);
        if (batch.idempotencyKey) recordAgentRequest(live, auth.token.id, batch.idempotencyKey, requestHash, result);
        return result;
      }, undefined, { origin });
      revalidate();
      return Response.json({ ...outcome, applied: true }, { headers });
    }
    const results: AgentOperationResult[] = [];
    for (const [index, operation] of batch.operations.entries()) {
      try {
        const result = await mutateData(auth.user.id, "AGENT_OPERATION", "AgentBatch", randomUUID(), (live) => {
          const outcome = runAgentOperations(live, auth, { ...batch, operations: [operation] }, { stopOnFailure: true });
          if (outcome.failed) throw new AgentError(422, outcome.results[0].error || "操作に失敗しました");
          touchAgentToken(live, auth.token.id);
          return outcome.results[0];
        }, undefined, { origin });
        results.push({ ...result, index });
      } catch (error) {
        results.push({ index, op: operation.op, status: "failed", targetId: operation.target.id, error: error instanceof Error ? error.message : "操作に失敗しました" });
      }
    }
    const outcome: AgentBatchOutcome = { company: rehearsal.company, dryRun: false, atomicity: "row", results, succeeded: results.filter((row) => row.status === "succeeded").length, failed: results.filter((row) => row.status === "failed").length, skipped: 0 };
    if (batch.idempotencyKey) await mutateData(auth.user.id, "AGENT_REQUEST_RECORD", "AgentRequest", batch.idempotencyKey, (live) => { recordAgentRequest(live, auth.token.id, batch.idempotencyKey!, requestHash, outcome); return { recorded: true }; }, undefined, { undoable: false, origin });
    revalidate();
    return Response.json({ ...outcome, applied: outcome.succeeded > 0 }, { headers });
  } catch (error) {
    if (error instanceof AgentError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: error instanceof Error ? error.message : "処理に失敗しました" }, { status: 500, headers });
  }
}
