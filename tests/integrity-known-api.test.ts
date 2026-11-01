import assert from "node:assert/strict";
import test from "node:test";
import { integrityKnownFixture } from "./integrity-known-fixture";
import { admin } from "./document-fixture";
import { acknowledgeIntegrity } from "../src/lib/integrity-acknowledgements";
import { integrityReport, type IntegrityIssue } from "../src/lib/integrity";
import { agentBatchSchema, listAgentResource } from "../src/lib/agent-api";
import { generateAgentTokenSecret, issueAgentToken, verifyAgentToken } from "../src/lib/agent-tokens";
import type { AppData, ApiTokenScope } from "../src/lib/types";

function auth(data: AppData, scopes: ApiTokenScope[]) {
  const secret = generateAgentTokenSecret(); issueAgentToken(data, admin, { name: "synthetic-read-only", scopes, expiresInDays: 1, hash: secret.hash, prefix: secret.prefix });
  const result = verifyAgentToken(data, `Bearer ${secret.plain}`); if (!result.ok) throw new Error("Synthetic token authentication failed"); return result.auth;
}
test("agent integrity defaults exclude known issues, includeKnown returns metadata, counts and scoped pagination without writes", () => {
  const data = integrityKnownFixture(), reader = auth(data, ["integrity:read"]), first = integrityReport(data, "JAPAN").issues.find((row) => row.kind === "reviewed_guess")!;
  acknowledgeIntegrity(data, admin, "JAPAN", { mode: "ISSUE", kind: first.kind, reason: "合成確認", targets: [{ id: first.id, fingerprint: first.fingerprint }] });
  const before = structuredClone(data), defaults = listAgentResource(data, reader, "integrity", {}), all = listAgentResource(data, reader, "integrity", { includeKnown: "1" });
  assert.equal((defaults.items as IntegrityIssue[]).some((row) => row.known), false); assert.equal(all.total, defaults.total + 1);
  const known = (all.items as IntegrityIssue[]).find((row) => row.known)!.known!;
  assert.equal(known.reason, "合成確認"); assert.equal(known.createdByName, "合成管理者"); assert.ok(known.createdAt);
  const extras = all as unknown as { knownTotal: number; knownCounts: Record<string, number>; counts: Record<string, number>; unresolvedTotal: number };
  assert.equal(extras.knownTotal, 1); assert.equal(extras.knownCounts.reviewed_guess, 1); assert.equal(extras.counts.reviewed_guess, 2); assert.equal(extras.unresolvedTotal, defaults.total);
  assert.equal(listAgentResource(data, reader, "integrity", { kind: "reviewed_guess" }).total, 2);
  assert.equal(listAgentResource(data, reader, "integrity", { kind: "reviewed_guess", includeKnown: "1" }).total, 3);
  const paged = listAgentResource(data, reader, "integrity", { kind: "reviewed_guess", includeKnown: "1", limit: "1" }); assert.equal(paged.items.length, 1); assert.equal(paged.nextCursor, "1");
  assert.deepEqual(listAgentResource(data, reader, "integrity", { includeKnown: "0" }).items, defaults.items); assert.deepEqual(data, before);
});
test("includeKnown is validated and cannot bypass agent scope/company permissions or create a write operation", () => {
  const data = integrityKnownFixture(), reader = auth(data, ["integrity:read"]), bankingOnly = auth(data, ["bank:read"]), before = structuredClone(data);
  assert.throws(() => listAgentResource(data, reader, "integrity", { includeKnown: "true" as "1" }));
  assert.throws(() => listAgentResource(data, bankingOnly, "integrity", { includeKnown: "1" }), /integrity:read/);
  assert.throws(() => listAgentResource(data, reader, "integrity", { company: "CHINA", includeKnown: "1" }), /会社/);
  assert.equal(agentBatchSchema.safeParse({ operations: [{ op: "integrity.acknowledge", payload: {} }] }).success, false); assert.deepEqual(data, before);
});
