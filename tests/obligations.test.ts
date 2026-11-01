import assert from "node:assert/strict";
import test from "node:test";
import { taxObligations } from "../src/lib/tax-obligations";
import { obligationsFixture } from "./obligations-fixture";
import { classifyObligationParty, inferObligationKind } from "../src/lib/obligation-classification";
import { applyObligationMutation, updateVendorObligationKind, type ObligationMutation } from "../src/lib/obligation-edits";
import { admin, timestamp } from "./document-fixture";
import { assertJapanData } from "../src/lib/japan-storage";
import { integrityReport } from "../src/lib/integrity";
import { listAgentResource } from "../src/lib/agent-api";
import { generateAgentTokenSecret, issueAgentToken, verifyAgentToken } from "../src/lib/agent-tokens";
import { vendorObligationCandidates, runVendorObligationReport } from "../scripts/migrations/vendor-obligation-kind-report.mjs";
import type { AppData, User, Vendor } from "../src/lib/types";

const today = "2026-11-01";
const view = (data: AppData) => taxObligations(data, "JAPAN", today);
const create = (data: AppData, extra: Partial<Extract<ObligationMutation, { action: "create" }>> = {}) => applyObligationMutation(data, admin, "JAPAN", { action: "create", title: "合成港都税の加算金", party: "合成港都税事務所", amount: 3400, dueDate: "2026-11-12", memo: "電話で確認した合成未納", ...extra }, today);
const mutate = (data: AppData, input: ObligationMutation) => applyObligationMutation(data, admin, "JAPAN", input, today);
const exclude = (data: AppData, id: string) => mutate(data, { action: "exclude", id, version: view(data).items.find((row) => row.id === id)!.version, reason: "一覧の対象ではないと原本で確認" });
const financial = (data: AppData) => ({ vendors: data.vendors, received: data.receivedInvoices, mail: data.mailDocuments, payments: data.payments, banks: data.bankTransactions, reconciliations: data.bankReconciliations, projects: data.projects });

test("ordinary utility and delivery invoices are not tax obligations even when OCR and memo mention tax", () => {
  const data = obligationsFixture();
  const ids = taxObligations(data, "JAPAN", "2026-11-01").items.map((row) => row.id);
  for (const id of ["received:gas", "received:delivery", "received:none", "mail:mail-gas"]) assert.ok(!ids.includes(id), id);
  for (const id of ["received:tax", "received:pension", "received:inferred", "received:explicit", "mail:mail-tax"]) assert.ok(ids.includes(id), id);
});

test("explicit vendor kinds override names and unset uses only normalized party names", () => {
  assert.equal(classifyObligationParty("合成県税事務所", { companyName: "合成県税事務所", obligationKind: "NONE" }), undefined);
  assert.deepEqual(classifyObligationParty("普通の会社", { companyName: "普通の会社", obligationKind: "SOCIAL_INSURANCE" }), { kind: "SOCIAL_INSURANCE", basis: "VENDOR", evidence: "普通の会社" });
  assert.equal(inferObligationKind("合成　年 金 事 務 所")?.kind, "SOCIAL_INSURANCE");
  for (const name of ["合成東京ガス", "合成佐川急便", "合成制作会社", "", "納付書"]) assert.equal(inferObligationKind(name), undefined);
  const rows = view(obligationsFixture()).items;
  assert.equal(rows.find((row) => row.id === "received:inferred")!.classification.basis, "NAME");
  assert.equal(rows.find((row) => row.id === "received:explicit")!.classification.basis, "VENDOR");
});

test("mail matches vendor names exactly and honors NONE without using document wording", () => {
  const data = obligationsFixture(), mail = data.mailDocuments[0];
  data.vendors.find((row) => row.id === "tax")!.obligationKind = "NONE";
  assert.ok(!view(data).items.some((row) => row.id === "mail:mail-tax"));
  mail.senderName = "合成県税事務所";
  assert.equal(view(data).items.find((row) => row.id === "mail:mail-tax")!.classification.basis, "NAME");
  mail.senderName = ""; mail.title = "税務署 法人税"; mail.ocrText = "年金事務所";
  assert.ok(!view(data).items.some((row) => row.id === "mail:mail-tax"));
});

test("ambiguous same-name vendors never choose an arbitrary first explicit kind", () => {
  const data = obligationsFixture(); data.vendors.push({ ...data.vendors[0], id: "tax-duplicate", obligationKind: "NONE" });
  assert.ok(!view(data).items.some((row) => row.id === "mail:mail-tax"));
  data.vendors.reverse(); assert.ok(!view(data).items.some((row) => row.id === "mail:mail-tax"));
  data.vendors.find((row) => row.id === "tax-duplicate")!.obligationKind = "TAX";
  assert.ok(view(data).items.some((row) => row.id === "mail:mail-tax"));
});

test("vendor classification editing preserves every other field and rejects stale, foreign and unauthorized edits", () => {
  const data = obligationsFixture(), before = structuredClone(data);
  const result = updateVendorObligationKind(data, admin, "JAPAN", { id: "gas", updatedAt: timestamp, obligationKind: "NONE" });
  const gas = data.vendors.find((row) => row.id === "gas")!;
  assert.equal(gas.obligationKind, "NONE"); assert.ok(gas.updatedAt > timestamp);
  const expected = structuredClone(before); expected.vendors.find((row) => row.id === "gas")!.obligationKind = "NONE"; expected.vendors.find((row) => row.id === "gas")!.updatedAt = result.updatedAt;
  assert.deepEqual(data, expected);
  assert.throws(() => updateVendorObligationKind(data, admin, "JAPAN", { id: "gas", updatedAt: timestamp, obligationKind: "TAX" }), /更新/);
  for (const role of ["MAIL_EDITOR", "BILLING_EDITOR", "CHIEF_DESIGNER"] as const) assert.throws(() => updateVendorObligationKind(data, { id: "admin", role }, "JAPAN", { id: "gas", updatedAt: result.updatedAt, obligationKind: "TAX" }), /権限/);
  assert.throws(() => updateVendorObligationKind(data, admin, "CHINA", { id: "gas", updatedAt: result.updatedAt, obligationKind: "TAX" }), /日本/);
  updateVendorObligationKind(data, { id: "admin", role: "ACCOUNTING" }, "JAPAN", { id: "gas", updatedAt: gas.updatedAt, obligationKind: "UNSET" });
  assert.equal(Object.hasOwn(gas, "obligationKind"), false);
});

test("deleted vendors, archived/rejected/deleted invoices, foreign projects and nonpayable debt documents stay out", () => {
  for (const patch of [{ status: "ARCHIVED" }, { status: "REJECTED" }, { deletedAt: timestamp }, { projectId: "missing" }] as const) {
    const data = obligationsFixture(); Object.assign(data.receivedInvoices[0], patch); assert.ok(!view(data).items.some((row) => row.id === "received:tax"));
  }
  const data = obligationsFixture(); data.vendors[0].deletedAt = timestamp;
  assert.ok(!view(data).items.some((row) => row.id === "received:tax"));
  delete data.vendors[0].deletedAt; data.receivedInvoices[0].debtGroupId = "group";
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "latest", issueDate: "2026-10-20", debtRole: "REMINDER" });
  assert.ok(!view(data).items.some((row) => row.id === "received:tax")); assert.ok(view(data).items.some((row) => row.id === "received:latest"));
  data.projects[0].company = "CHINA";
  assert.equal(view(data).items.filter((row) => row.source === "received").length, 0);
});

test("real payments determine partial and complete amounts, ignoring canceled and wrong-side records", () => {
  const data = obligationsFixture(), tax = data.receivedInvoices[0]; tax.status = "PAID";
  data.payments = [{ id: "part", type: "EXPENSE", receivedInvoiceId: tax.id, amount: 4000, paymentDate: today, createdById: "admin", createdAt: timestamp, updatedAt: timestamp }, { id: "wrong", type: "INCOME", receivedInvoiceId: tax.id, amount: 10000, paymentDate: today, createdById: "admin", createdAt: timestamp, updatedAt: timestamp }, { id: "canceled", type: "EXPENSE", receivedInvoiceId: tax.id, amount: 10000, deletedAt: timestamp, paymentDate: today, createdById: "admin", createdAt: timestamp, updatedAt: timestamp }];
  assert.equal(view(data).items.find((row) => row.id === "received:tax")!.outstanding, 6000);
  data.payments[0].amount = 10000; tax.status = "SCHEDULED";
  assert.ok(!view(data).items.some((row) => row.id === "received:tax")); assert.equal(view(data).paidRecently[0].paidAt, today);
});

test("processed and valid-linked mail stays out; broken linkage remains visible without editing its flags", () => {
  const data = obligationsFixture(), mail = data.mailDocuments[0];
  mail.mailProcessed = true; assert.ok(!view(data).items.some((row) => row.id === "mail:mail-tax"));
  mail.mailProcessed = false; mail.relatedReceivedInvoiceId = "tax"; assert.ok(!view(data).items.some((row) => row.id === "mail:mail-tax"));
  data.receivedInvoices[0].deletedAt = timestamp; assert.ok(view(data).items.some((row) => row.id === "mail:mail-tax"));
  assert.equal(mail.relatedReceivedInvoiceId, "tax"); assert.equal(mail.mailProcessed, false);
});

test("exclude and restore keep source rows unchanged and record both decisions with reason, actor and time", () => {
  const data = obligationsFixture(), before = structuredClone(financial(data)), total = view(data).outstandingTotal;
  const result = exclude(data, "received:tax");
  assert.equal(view(data).outstandingTotal, total - 10000); assert.equal(view(data).excluded.length, 1);
  const exclusion = data.obligationExclusions![0]; assert.equal(exclusion.createdById, "admin"); assert.ok(exclusion.reason); assert.ok(exclusion.createdAt);
  mutate(data, { action: "restoreExclusion", id: result.id, version: result.updatedAt, reason: "税金であると確認した" });
  assert.equal(view(data).excluded.length, 0); assert.equal(view(data).outstandingTotal, total);
  assert.equal(exclusion.restoreReason, "税金であると確認した"); assert.equal(exclusion.restoredById, "admin"); assert.ok(exclusion.restoredAt! > exclusion.createdAt);
  assert.deepEqual(financial(data), before);
  exclude(data, "received:tax"); assert.equal(data.obligationExclusions!.length, 2);
});

test("excluded snapshots remain restorable when source disappears or changes classification", () => {
  const data = obligationsFixture(), first = exclude(data, "received:tax");
  data.receivedInvoices[0].deletedAt = timestamp; data.vendors[0].obligationKind = "NONE";
  const summary = view(data); assert.equal(summary.excluded.length, 1); assert.equal(summary.excluded[0].current, undefined); assert.ok(summary.excluded[0].snapshot.title);
  mutate(data, { action: "restoreExclusion", id: first.id, version: first.updatedAt, reason: "除外記録を解除" });
  assert.equal(view(data).excluded.length, 0); assert.ok(!view(data).items.some((row) => row.id === "received:tax"));
});

test("exclude requires reason and current evidence and refuses duplicate or foreign targets", () => {
  const data = obligationsFixture(), row = view(data).items.find((row) => row.id === "received:tax")!, before = structuredClone(data);
  assert.throws(() => mutate(data, { action: "exclude", id: row.id, version: row.version, reason: " " }), /理由/);
  assert.throws(() => mutate(data, { action: "exclude", id: row.id, version: "stale", reason: "確認" }), /更新/); assert.deepEqual(data, before);
  data.receivedInvoices[0].total += 1; assert.throws(() => mutate(data, { action: "exclude", id: row.id, version: row.version, reason: "確認" }), /更新/);
  exclude(data, row.id); const after = structuredClone(data);
  assert.throws(() => mutate(data, { action: "exclude", id: row.id, version: row.version, reason: "確認" }), /更新/); assert.deepEqual(data, after);
});

test("manual 3400-yen entry is additional, optional deadline stays empty and source accounting is unchanged", () => {
  const data = obligationsFixture(), before = structuredClone(financial(data)), total = view(data).outstandingTotal;
  const created = create(data, { dueDate: "" });
  const row = view(data).items.find((row) => row.id === `manual:${created.id}`)!;
  assert.equal(row.outstanding, 3400); assert.equal(row.dueDate, ""); assert.equal(row.classification.basis, "MANUAL"); assert.equal(view(data).outstandingTotal, total + 3400);
  assert.equal(data.manualObligations![0].history[0].byId, "admin"); assert.deepEqual(financial(data), before);
});

test("manual pay/reopen/cancel/restore follow valid transitions, preserve history and require reasons", () => {
  const data = obligationsFixture(), before = structuredClone(financial(data)), created = create(data), row = data.manualObligations![0];
  mutate(data, { action: "pay", id: created.id, version: row.updatedAt, reason: "合成納付確認", paymentDate: today });
  assert.equal(row.status, "PAID"); assert.equal(row.paidAt, today); assert.ok(!view(data).items.some((item) => item.id === `manual:${row.id}`)); assert.equal(view(data).manualInactive.length, 1);
  assert.throws(() => mutate(data, { action: "cancel", id: row.id, version: row.updatedAt, reason: "取消" }), /現在の状態/);
  mutate(data, { action: "reopen", id: row.id, version: row.updatedAt, reason: "支払未了と判明" }); assert.equal(row.status, "OPEN"); assert.equal(row.paidAt, undefined);
  mutate(data, { action: "cancel", id: row.id, version: row.updatedAt, reason: "書類の登録へ移した" }); assert.equal(row.status, "CANCELED");
  mutate(data, { action: "restoreManual", id: row.id, version: row.updatedAt, reason: "登録を戻す" }); assert.equal(row.status, "OPEN");
  assert.deepEqual(row.history.map((entry) => entry.action), ["CREATE", "PAY", "REOPEN", "CANCEL", "RESTORE"]); assert.deepEqual(financial(data), before);
});

test("invalid manual inputs leave the entire data unchanged", () => {
  const data = obligationsFixture(), before = structuredClone(data);
  for (const extra of [{ title: " " }, { party: " " }, { amount: 0 }, { amount: -1 }, { amount: 1.5 }, { amount: Infinity }, { amount: NaN }, { amount: 1e13 }, { dueDate: "2026-02-30" }, { memo: "x".repeat(2001) }]) assert.throws(() => create(data, extra));
  assert.deepEqual(data, before); const created = create(data), after = structuredClone(data);
  for (const input of [{ action: "pay", id: created.id, version: "stale", reason: "確認", paymentDate: today }, { action: "pay", id: created.id, version: created.updatedAt, reason: " ", paymentDate: today }, { action: "pay", id: created.id, version: created.updatedAt, reason: "確認", paymentDate: "2026-11-02" }, { action: "pay", id: created.id, version: created.updatedAt, reason: "確認", paymentDate: "2026-02-30" }, { action: "reopen", id: created.id, version: created.updatedAt, reason: "確認" }] as ObligationMutation[]) assert.throws(() => mutate(data, input));
  assert.deepEqual(data, after);
});

test("excluded manual entries must be restored before payment; foreign records cannot be altered", () => {
  const data = obligationsFixture(), created = create(data); exclude(data, `manual:${created.id}`);
  assert.throws(() => mutate(data, { action: "pay", id: created.id, version: created.updatedAt, reason: "確認", paymentDate: today }), /先に/);
  data.manualObligations![0].company = "CHINA"; assert.throws(() => mutate(data, { action: "cancel", id: created.id, version: created.updatedAt, reason: "確認" }), /更新/);
  data.obligationExclusions![0].company = "CHINA"; assert.equal(view(data).excluded.length, 0);
  assert.equal(view(data).manualInactive.length, 0); assert.throws(() => assertJapanData(data), /中国/);
});

test("every new mutation checks management permissions and Japanese company scope", () => {
  for (const role of ["CHIEF_DESIGNER", "PROJECT_MANAGER", "MAIL_EDITOR", "BILLING_EDITOR", "DESIGNER", "GUEST"] as const) {
    const data = obligationsFixture(), before = structuredClone(data);
    assert.throws(() => applyObligationMutation(data, { id: "admin", role }, "JAPAN", { action: "create", title: "合成", party: "合成", amount: 1, dueDate: "", memo: "" }), /権限/);
    assert.deepEqual(data, before);
  }
  const data = obligationsFixture(); assert.throws(() => applyObligationMutation(data, admin, "CHINA", { action: "create", title: "合成", party: "合成", amount: 1, dueDate: "", memo: "" }), /日本/);
});

test("read-only aggregation leaves missing legacy collections absent and integrity issues remain independent", () => {
  const data = obligationsFixture(); data.mailDocuments[0].relatedReceivedInvoiceId = "broken";
  const before = structuredClone(data); view(data); assert.deepEqual(data, before);
  const issues = integrityReport(data, "JAPAN", { today }); exclude(data, "received:tax"); create(data);
  assert.ok(issues.issues.length > 0);
  const after = integrityReport(data, "JAPAN", { today });
  assert.deepEqual({ ...after, generatedAt: "" }, { ...issues, generatedAt: "" });
});

test("agent vendor reads expose saved obligation kinds without side effects and enforce existing scopes", () => {
  const data = obligationsFixture(); data.users = [{ ...admin, name: "合成管理者", email: "admin@example.invalid", passwordHash: "unused", createdAt: timestamp, updatedAt: timestamp } as User];
  const secret = generateAgentTokenSecret(); issueAgentToken(data, admin, { userId: "admin", name: "合成検証", scopes: ["bank:read"], expiresInDays: 1, hash: secret.hash, prefix: secret.prefix });
  const result = verifyAgentToken(data, `Bearer ${secret.plain}`); assert.ok(result.ok);
  if (!result.ok) return;
  const before = structuredClone(data), rows = listAgentResource(data, result.auth, "vendors", {}).items as Vendor[];
  assert.equal(rows.find((row) => row.id === "tax")!.obligationKind, "TAX"); assert.equal(rows.find((row) => row.id === "none")!.obligationKind, "NONE"); assert.equal(rows.find((row) => row.id === "gas")!.obligationKind, undefined);
  assert.throws(() => listAgentResource(data, result.auth, "integrity", {}), /スコープ/); assert.deepEqual(data, before);
});

test("initial classification report is dry-run only, excludes explicit/deleted/foreign vendors and agrees with name inference", () => {
  const data = obligationsFixture(); data.vendors.push({ ...data.vendors[4], id: "deleted", deletedAt: timestamp }, { ...data.vendors[4], id: "foreign", company: "CHINA" });
  const before = structuredClone(data), report = vendorObligationCandidates(data);
  assert.deepEqual(report.candidates.map((row: { id: string }) => row.id), ["inferred"]);
  for (const row of report.candidates) assert.equal(row.proposedValue, inferObligationKind(row.name)?.kind);
  assert.deepEqual(data, before);
  for (const name of ["合成年金事務所", "合成税務署", "合成　協会けんぽ", "合成市役所", "合成佐川急便", "合成東京ガス", "納付書"]) {
    const candidate = vendorObligationCandidates({ vendors: [{ id: "test", company: "JAPAN", companyName: name }] }).candidates[0]; assert.equal(candidate?.proposedValue, inferObligationKind(name)?.kind);
  }
  const logs: string[] = []; let reads = 0;
  const io = { read: () => { reads++; return JSON.stringify(data); }, log: (message: string) => { logs.push(message); } };
  runVendorObligationReport(["--data", "synthetic.json", "--json"], io); assert.equal(reads, 1); assert.equal(JSON.parse(logs[0]).dryRun, true);
  for (const args of [["--apply"], ["--restore", "backup"], [], ["--data", "synthetic.json", "--out", "report.json"]]) assert.throws(() => runVendorObligationReport(args, io));
  assert.equal(reads, 1); assert.throws(() => vendorObligationCandidates({ appEdition: "CHINA" }), /日本/);
});
