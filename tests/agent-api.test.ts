import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions, sourceKey } from "../src/lib/banking";
import { agentCan, agentTokenViews, generateAgentTokenSecret, issueAgentToken, revokeAgentToken, verifyAgentToken } from "../src/lib/agent-tokens";
import { agentBatchSchema, agentRequestHash, findAgentRequest, listAgentResource, recordAgentRequest, runAgentOperations, type AgentBatchInput } from "../src/lib/agent-api";
import type { ApiTokenScope, AppData } from "../src/lib/types";

const office = "office", today = "2026-10-08";
const cat = (id: string) => sourceKey("JAPAN", office, "category", id);
const user = (id: string, role: "ADMIN" | "DESIGNER", accessStatus: "ACTIVE" | "PENDING" = "ACTIVE") => ({ id, name: id, email: `${id}@example.invalid`, passwordHash: "unused", role, accessStatus, createdAt: timestamp, updatedAt: timestamp });
function setup() {
  const data = fixture();
  data.users.push(user("admin", "ADMIN"), user("designer", "DESIGNER"), user("pending", "ADMIN", "PENDING"));
  mergeBankMasters(data, "JAPAN", office, [{ id: "bank", name: "テスト 三菱UFJ銀行", serviceName: "三菱UFJ銀行", isManual: false }], [
    { id: "misc", name: "雑費", group: "EXPENSE", available: true }, { id: "fees", name: "支払手数料", group: "EXPENSE", available: true }, { id: "sales", name: "売上高", group: "INCOME", available: true },
  ]);
  mergeBankTransactions(data, "JAPAN", office, [
    { id: "unknown", connected_account_id: "bank", date: "2026-10-05", value: 3300, side: "EXPENSE", content: "用途不明 テスト", journalizing_status: "none" },
    { id: "income", connected_account_id: "bank", date: today, value: 12000, side: "INCOME", content: "Test customer INV-001", journalizing_status: "none" },
  ], { start: "2026-10-01", end: "2026-10-31" });
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; });
  return data;
}
const scopesAll: ApiTokenScope[] = ["bank:read", "integrity:read", "bank:write", "reconcile:write", "payments:write", "received:write", "mail:write", "partners:write"];
function issue(data: AppData, scopes: ApiTokenScope[], userId = "admin") {
  const secret = generateAgentTokenSecret();
  const issued = issueAgentToken(data, admin, { userId, name: "test", scopes, expiresInDays: 30, hash: secret.hash, prefix: secret.prefix });
  return { plain: secret.plain, id: issued.id };
}
function authFor(data: AppData, plain: string) {
  const verified = verifyAgentToken(data, `Bearer ${plain}`);
  if (!verified.ok) throw new Error(verified.error);
  return verified.auth;
}
const find = (data: AppData, sourceId: string) => data.bankTransactions.find((row) => row.sourceId === sourceId)!;
const request = (operations: AgentBatchInput["operations"], extra: Partial<AgentBatchInput> = {}) => agentBatchSchema.parse({ operations, ...extra });
const statusOf = (verification: ReturnType<typeof verifyAgentToken>) => verification.ok ? 200 : verification.status;

test("tokens are hashed, scoped to the user's own permissions and rejected when missing, revoked, expired or orphaned", () => {
  const data = setup();
  const { plain, id } = issue(data, ["bank:read", "bank:write"]);
  assert.ok(plain.startsWith("tri_")); assert.equal(JSON.stringify(data).includes(plain), false);
  const view = agentTokenViews(data)[0];
  assert.deepEqual([view.status, view.userName, "tokenHash" in view], ["ACTIVE", "admin", false]);
  const verified = verifyAgentToken(data, `Bearer ${plain}`);
  assert.ok(verified.ok && verified.auth.user.id === "admin");
  assert.ok(verified.ok && agentCan(verified.auth, "bank:write") && !agentCan(verified.auth, "reconcile:write"));
  assert.equal(statusOf(verifyAgentToken(data, undefined)), 401);
  assert.equal(statusOf(verifyAgentToken(data, "Bearer tri_wrong")), 401);
  assert.equal(statusOf(verifyAgentToken(data, `Bearer ${plain}`, new Date("2027-01-01T00:00:00Z"))), 401);
  // A designer cannot receive a token that exceeds their own role.
  assert.throws(() => issue(data, ["bank:write"], "designer"), /スコープ/);
  assert.throws(() => issue(data, ["bank:read"], "pending"), /利用者/);
  assert.throws(() => issueAgentToken(data, { id: "designer", role: "DESIGNER" }, { name: "x", scopes: ["bank:read"], expiresInDays: 1, hash: "a".repeat(64), prefix: "tri_aaaaaaaa" }), /権限/);
  revokeAgentToken(data, admin, id, data.apiTokens![0].updatedAt);
  assert.equal(statusOf(verifyAgentToken(data, `Bearer ${plain}`)), 401);
  assert.equal(agentTokenViews(data)[0].status, "REVOKED");
  // A token whose user later loses access is refused as well.
  const second = issue(data, ["bank:read"]);
  data.users.find((row) => row.id === "admin")!.accessStatus = "REJECTED";
  assert.equal(statusOf(verifyAgentToken(data, `Bearer ${second.plain}`)), 403);
});

test("reads honour scope, filters and paging without changing data", () => {
  const data = setup(), auth = authFor(data, issue(data, ["bank:read"]).plain), wide = authFor(data, issue(data, ["integrity:read"]).plain), before = JSON.stringify(data);
  const all = listAgentResource(data, auth, "bank-transactions", {}, { today });
  assert.equal(all.total, 2); assert.equal((all.items[0] as { classification: { kind: string } }).classification.kind, "UNAVAILABLE");
  assert.equal(listAgentResource(data, auth, "bank-transactions", { side: "INCOME" }, { today }).total, 1);
  assert.equal(listAgentResource(data, auth, "bank-transactions", { q: "用途不明", reviewed: "false" }, { today }).total, 1);
  assert.equal(listAgentResource(data, auth, "bank-transactions", { start: "2026-10-06" }, { today }).total, 1);
  const paged = listAgentResource(data, auth, "bank-transactions", { limit: "1" }, { today });
  assert.deepEqual([paged.items.length, paged.nextCursor], [1, "1"]);
  assert.equal(listAgentResource(data, auth, "bank-transactions", { limit: "1", cursor: "1" }, { today }).nextCursor, undefined);
  assert.equal(listAgentResource(data, auth, "issued-invoices", { status: "ISSUED" }, { today }).total, 2);
  assert.equal(listAgentResource(data, auth, "categories", {}, { today }).total, 3);
  assert.throws(() => listAgentResource(data, auth, "bank-transactions", { company: "CHINA" }, { today }), /会社スコープ/);
  assert.throws(() => listAgentResource(data, auth, "integrity", {}, { today }), /integrity:read/);
  const integrity = listAgentResource(data, wide, "integrity", {}, { today });
  assert.ok("counts" in integrity); assert.equal(integrity.total, (integrity.items as unknown[]).length);
  assert.throws(() => listAgentResource(data, wide, "bank-transactions", {}, { today }), /bank:read/);
  assert.throws(() => listAgentResource(data, auth, "bank-transactions", { limit: "5000" }, { today }));
  assert.equal(JSON.stringify(data), before);
});

test("a rehearsal on a copy reports per-row changes and failures while the real data stays untouched", () => {
  const data = setup(), auth = authFor(data, issue(data, scopesAll).plain), before = JSON.stringify(data);
  const unknown = find(data, "unknown");
  const outcome = runAgentOperations(structuredClone(data), auth, request([
    { op: "bank.classify", target: { id: unknown.id }, expect: { updatedAt: unknown.updatedAt }, payload: { categoryId: cat("misc"), reviewed: true, memo: "agent" } },
    { op: "bank.classify", expect: { transactionDate: today, amount: 12000, content: "test customer inv-001" }, payload: { categoryId: cat("sales") } },
    { op: "bank.classify", target: { id: unknown.id }, expect: { updatedAt: "stale" }, payload: { memo: "x" } },
    { op: "bank.classify", target: { id: "nope" }, payload: {} },
  ], { atomicity: "row" }), { today });
  assert.deepEqual(outcome.results.map((row) => row.status), ["succeeded", "succeeded", "failed", "failed"]);
  assert.deepEqual([outcome.succeeded, outcome.failed, outcome.skipped], [2, 2, 0]);
  assert.equal(outcome.results[0].changes!.length, 1);
  assert.equal(outcome.results[0].changes![0].collection, "bankTransactions");
  assert.equal((outcome.results[0].changes![0].after as { memo: string }).memo, "agent");
  assert.equal((outcome.results[0].changes![0].before as { memo: string }).memo, "");
  assert.equal(outcome.results[1].targetId, find(data, "income").id);
  assert.match(outcome.results[2].error!, /expect\.updatedAt/); assert.match(outcome.results[3].error!, /見つかりません/);
  assert.equal(JSON.stringify(data), before);
  // Batch atomicity stops at the first failure and skips the rest.
  const stopped = runAgentOperations(structuredClone(data), auth, request([
    { op: "bank.classify", target: { id: "nope" }, payload: {} }, { op: "bank.classify", target: { id: unknown.id }, payload: { memo: "later" } },
  ]), { today, stopOnFailure: true });
  assert.deepEqual(stopped.results.map((row) => row.status), ["failed", "skipped"]);
});

test("operations call the same library rules: guesses need acknowledgement, reconciliation creates payments, cancel needs a reason", () => {
  const data = setup(), auth = authFor(data, issue(data, scopesAll).plain);
  const unknown = find(data, "unknown"), income = find(data, "income");
  const guess = runAgentOperations(data, auth, request([{ op: "bank.classify", target: { id: unknown.id }, payload: { categoryId: cat("misc"), reviewed: true, classificationConfidence: "GUESS", classificationReason: "候補" } }]), { today });
  assert.match(guess.results[0].error!, /推測/);
  const confirmed = runAgentOperations(data, auth, request([
    { op: "reconcile.confirm", target: { id: income.id }, payload: { invoiceKind: "issued", invoiceId: "issued-1", amount: 12000 } },
    { op: "payment.record", payload: { kind: "received", invoiceId: "received-1", amount: 8000, paymentDate: "2026-10-01", method: "振込" }, reason: "手入力" },
    { op: "vendor.create", payload: { companyName: "株式会社テスト新規" } },
    { op: "project.create", payload: { name: "新規案件" } },
  ]), { today, stopOnFailure: true });
  assert.deepEqual(confirmed.results.map((row) => row.status), ["succeeded", "succeeded", "succeeded", "succeeded"]);
  assert.equal(data.bankReconciliations.length, 1); assert.equal(data.payments.length, 2);
  assert.ok(confirmed.results[0].changes!.some((change) => change.collection === "payments" && change.before === null));
  assert.equal(data.vendors.at(0)!.companyName, "株式会社テスト新規"); assert.equal(data.projects.at(0)!.clientId, "client");
  const payment = data.payments.find((row) => row.receivedInvoiceId === "received-1")!;
  const cancel = runAgentOperations(data, auth, request([{ op: "payment.cancel", target: { id: payment.id }, payload: {} }]), { today });
  assert.match(cancel.results[0].error!, /理由/);
  const second = runAgentOperations(data, auth, request([
    { op: "payment.cancel", target: { id: payment.id }, payload: {}, reason: "二重登録" },
    { op: "vendor.create", payload: { companyName: "株式会社テスト新規" } },
    { op: "reconcile.remove", target: { id: data.bankReconciliations[0].id }, payload: {} },
    { op: "received.update", target: { id: "received-1" }, payload: { dueDate: "2026-11-30" } },
  ], { atomicity: "row" }), { today });
  assert.deepEqual(second.results.map((row) => row.status), ["succeeded", "failed", "succeeded", "succeeded"]);
  assert.match(second.results[1].error!, /同名/);
  assert.ok(payment.deletedAt); assert.ok(data.bankReconciliations[0].deletedAt);
  assert.equal(data.receivedInvoices[0].dueDate, "2026-11-30");
  // A token without the write scope is refused before any library call.
  const reader = authFor(data, issue(data, ["bank:read"]).plain);
  const denied = runAgentOperations(structuredClone(data), reader, request([{ op: "bank.classify", target: { id: unknown.id }, payload: { memo: "x" } }]), { today });
  assert.match(denied.results[0].error!, /bank:write/);
});

test("idempotency entries replay by key and detect a different body; the schema bounds the batch", () => {
  const data = setup();
  const first = request([{ op: "bank.classify", target: { id: "a" }, payload: { memo: "1" } }], { idempotencyKey: "key-00000001" });
  const same = request([{ op: "bank.classify", target: { id: "a" }, payload: { memo: "1" } }], { idempotencyKey: "key-00000001", dryRun: true });
  const other = request([{ op: "bank.classify", target: { id: "a" }, payload: { memo: "2" } }], { idempotencyKey: "key-00000001" });
  assert.equal(agentRequestHash(first), agentRequestHash(same)); assert.notEqual(agentRequestHash(first), agentRequestHash(other));
  const entry = recordAgentRequest(data, "token", "key-00000001", agentRequestHash(first), { ok: true }, new Date("2026-10-01T00:00:00Z"));
  assert.equal(findAgentRequest(data, "token", "key-00000001", new Date("2026-10-02T00:00:00Z"))?.id, entry.id);
  assert.equal(findAgentRequest(data, "other-token", "key-00000001", new Date("2026-10-02T00:00:00Z")), undefined);
  assert.equal(findAgentRequest(data, "token", "key-00000001", new Date("2026-10-09T00:00:00Z")), undefined);
  recordAgentRequest(data, "token", "key-00000002", "h", {}, new Date("2026-10-09T00:00:00Z"));
  assert.deepEqual(data.agentRequests!.map((row) => row.idempotencyKey), ["key-00000002"]);
  assert.equal(agentBatchSchema.safeParse({ operations: [] }).success, false);
  assert.equal(agentBatchSchema.safeParse({ operations: [{ op: "bank.delete" }] }).success, false);
  assert.equal(agentBatchSchema.safeParse({ operations: Array.from({ length: 201 }, () => ({ op: "bank.classify" })) }).success, false);
  assert.equal(agentBatchSchema.parse({ operations: [{ op: "bank.classify" }] }).atomicity, "batch");
});
