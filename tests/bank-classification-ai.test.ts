import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions, saveBankEdits, sourceKey } from "../src/lib/banking";
import { prepareClassificationAi, validateClassificationAi } from "../src/lib/bank-classification-ai";
import { requestClassificationAi, runClassificationAi } from "../src/lib/bank-classification-ai-service";
import type { ClassificationAiPayload } from "../src/lib/bank-classification-ai-types";

const office = "0000-0001", scope = { batch: 0 };
function setup() {
  const data = fixture();
  data.users.push({ id: "admin", name: "Test admin", email: "admin@example.invalid", passwordHash: "not-a-real-secret", role: "ADMIN", accessStatus: "ACTIVE", createdAt: timestamp, updatedAt: timestamp });
  mergeBankMasters(data, "JAPAN", office, [{ id: "card", name: "Private card 1234567", serviceName: "Card", isManual: false }], [
    { id: "travel", name: "旅費交通費", group: "EXPENSE", available: true },
    { id: "supplies", name: "消耗品費", group: "EXPENSE", available: true },
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
    { id: "sub", parentSourceId: "travel", name: "Private subcategory", group: "EXPENSE", available: true },
  ]);
  mergeBankTransactions(data, "JAPAN", office, ["JRW SHINKANSEN", "エスライド", "テストコンビニ", "振込手数料"].map((content, i) => ({ id: String(i), connected_account_id: "card", date: "2026-10-01", value: 1200, side: "EXPENSE" as const, content, memo: "PRIVATE SOURCE MEMO", journalizing_status: "none" })), { start: "2026-10-01", end: "2026-10-31" });
  data.bankTransactions.forEach((row) => { row.memo = "PRIVATE INTERNAL MEMO"; });
  return data;
}
const prepare = (data = setup()) => prepareClassificationAi(data, "admin", "JAPAN", scope);
function answer(payload: ClassificationAiPayload) {
  const travel = payload.categories.find((row) => row.name === "旅費交通費")!.ref;
  const supplies = payload.categories.find((row) => row.name === "消耗品費")!.ref;
  return { decisions: payload.transactions.map((row) => ({ bankRef: row.ref, categoryRef: row.content.includes("コンビニ") ? supplies : travel, confidence: row.content.includes("コンビニ") ? "low" as const : "medium" as const, reason: row.content.includes("コンビニ") ? "購入内容が不明なため消耗品費と仮定しています。用途は未確認です" : "交通サービスの利用候補です", quote: row.content })) };
}

test("AI classification scopes bank/card rows, protects edits and rules, and only exposes masked minimal data", () => {
  const data = setup();
  data.bankTransactions[0].content += " contact@example.com 1234567 sk-secret_token";
  const before = JSON.stringify(data), prepared = prepare(data), text = JSON.stringify(prepared.preview.payload);
  assert.equal(prepared.rows.length, 3);
  assert.equal(prepared.preview.payload.transactions[0].accountKind, "CARD");
  for (const secret of ["Private card", "1234567", "example.com", "sk-secret", "PRIVATE", "Private subcategory", "issuedInvoices", "bankAccountId", office]) assert.ok(!text.includes(secret), secret);
  assert.equal(JSON.stringify(data), before);
  for (const variant of ["manual", "reviewed", "missing", "excluded", "transfer", "classified"] as const) {
    const changed = setup(), row = changed.bankTransactions[0];
    if (variant === "manual") row.classificationSource = "MANUAL";
    if (variant === "reviewed") row.reviewed = true;
    if (variant === "missing") row.sourceMissing = true;
    if (variant === "excluded") row.sourceStatus = "excluded";
    if (variant === "transfer") row.treatment = "TRANSFER";
    if (variant === "classified") row.categoryId = sourceKey("JAPAN", office, "category", "travel");
    assert.ok(!prepare(changed).rows.some((item) => item.id === row.id), variant);
  }
});

test("AI targets reject unauthorized users, foreign IDs, malformed scopes and invalid batches", () => {
  for (const role of ["BILLING_EDITOR", "MAIL_EDITOR", "DESIGNER"] as const) {
    const data = setup(); data.users[0].role = role;
    assert.throws(() => prepare(data));
  }
  const data = setup();
  assert.throws(() => prepareClassificationAi(data, "unknown", "JAPAN", scope));
  assert.throws(() => prepareClassificationAi(data, "admin", "CHINA", { ids: [data.bankTransactions[0].id], batch: 0 }));
  for (const invalid of [{ ids: [], batch: 0 }, { batch: -1 }, { batch: 1 }, { batch: 0, payload: "forged" }]) assert.throws(() => prepareClassificationAi(data, "admin", "JAPAN", invalid));
});

test("AI batches are deterministic, limited to 50 and preserve page/selected boundaries", () => {
  const data = setup(), base = data.bankTransactions[0];
  data.bankTransactions = Array.from({ length: 120 }, (_, i) => ({ ...base, id: `row-${String(i).padStart(3, "0")}` }));
  const first = prepare(data), second = prepareClassificationAi(data, "admin", "JAPAN", { batch: 1 });
  assert.equal(first.rows.length, 50); assert.equal(first.preview.total, 120); assert.equal(second.rows.length, 50);
  assert.ok(second.rows.every((row) => !first.rows.some((firstRow) => firstRow.id === row.id)));
  assert.deepEqual(prepareClassificationAi(data, "admin", "JAPAN", { ids: [data.bankTransactions[75].id], batch: 0 }).rows.map((row) => row.id), [data.bankTransactions[75].id]);
  assert.equal(prepareClassificationAi(data, "admin", "JAPAN", { batch: 2 }).rows.length, 20);
});

test("category availability, office and company are enforced even for a fabricated AI choice", () => {
  const data = setup(), category = data.accountingCategories.find((row) => row.name === "旅費交通費")!;
  data.accountingCategories.push({ ...category, id: "foreign-company", company: "CHINA" }, { ...category, id: "disabled", available: false }, { ...category, id: "deleted", deletedAt: "2026-01-01" }, { ...category, id: "other-office", officeCode: "9999-9999" });
  const prepared = prepare(data);
  assert.ok(prepared.categories.every((row) => !["foreign-company", "disabled", "deleted", "other-office"].includes(row.id)));
  const output = answer(prepared.preview.payload); output.decisions[0].categoryRef = "C999";
  assert.throws(() => validateClassificationAi(prepared, output, "model"));
});

test("AI assigns a category to every row including uncertain purchases without saving anything", () => {
  const data = setup(), before = JSON.stringify(data), prepared = prepare(data);
  const result = validateClassificationAi(prepared, answer(prepared.preview.payload), "model");
  assert.equal(result.suggested, 3); assert.equal(result.lowConfidence, 1);
  assert.ok(result.rows.every((row) => row.categoryId && !row.reviewed && row.classificationReason?.startsWith("AI候補")));
  const uncertain = result.rows.find((row) => row.content.includes("コンビニ"))!;
  assert.equal(uncertain.categoryId, sourceKey("JAPAN", office, "category", "supplies"));
  assert.match(uncertain.classificationReason!, /要確認・推定/);
  assert.ok(result.rows.every((row) => row.updatedAt === data.bankTransactions.find((original) => original.id === row.id)!.updatedAt));
  assert.equal(JSON.stringify(data), before);
  const chosen = result.rows.find((row) => row.categoryId)!;
  saveBankEdits(data, admin, "JAPAN", [{ id: chosen.id, updatedAt: chosen.updatedAt, categoryId: chosen.categoryId, treatment: "NORMAL", reviewed: false, memo: "User saved" }]);
  assert.equal(data.bankTransactions.find((row) => row.id === chosen.id)!.classificationSource, "MANUAL");
});

test("missing/duplicate/invented refs, invented evidence and masked evidence reject the entire AI result", () => {
  const prepared = prepare();
  for (const variant of ["missing", "duplicate", "foreign", "quote", "masked", "extra", "null-category", "missing-category", "blank-category"] as const) {
    const output = answer(prepared.preview.payload);
    if (variant === "missing") output.decisions.pop();
    if (variant === "duplicate") output.decisions[1] = output.decisions[0];
    if (variant === "foreign") output.decisions[0].bankRef = "B99";
    if (variant === "quote") output.decisions[0].quote = "Invented evidence";
    if (variant === "masked") output.decisions[0].quote = "[NUMBER]";
    if (variant === "extra") Object.assign(output.decisions[0], { paid: true });
    if (variant === "null-category") Object.assign(output.decisions[0], { categoryRef: null });
    if (variant === "missing-category") Object.assign(output.decisions[0], { categoryRef: undefined });
    if (variant === "blank-category") output.decisions[0].categoryRef = "";
    assert.throws(() => validateClassificationAi(prepared, output, "model"), variant);
  }
  const output = answer(prepared.preview.payload);
  const low = { ...output, decisions: output.decisions.map((row) => ({ ...row, confidence: "low" })) };
  const result = validateClassificationAi(prepared, low, "model");
  assert.equal(result.suggested, prepared.rows.length);
  assert.equal(result.lowConfidence, prepared.rows.length);
  assert.ok(result.rows.every((row) => row.categoryId && !row.reviewed && row.classificationReason?.includes("要確認・推定")));
});

test("all confidence levels retain categories; blank or masked descriptions require uncertain proposals", () => {
  for (const confidence of ["high", "medium", "low", "unknown"] as const) {
    const prepared = prepare(), output = answer(prepared.preview.payload);
    const result = validateClassificationAi(prepared, { decisions: output.decisions.map((row) => ({ ...row, confidence })) }, "model");
    assert.equal(result.rows.filter((row) => row.categoryId).length, prepared.rows.length);
    assert.equal(result.lowConfidence, confidence === "low" || confidence === "unknown" ? prepared.rows.length : 0);
  }
  for (const content of ["", "123456789 contact@example.com"]) {
    const data = setup(); data.bankTransactions[0].content = content;
    const prepared = prepare(data), output = answer(prepared.preview.payload);
    for (const confidence of ["low", "unknown"] as const) {
      const decisions = output.decisions.map((row) => ({ ...row, quote: "", confidence }));
      const result = validateClassificationAi(prepared, { decisions }, "model");
      assert.ok(result.rows.every((row) => row.categoryId && !row.reviewed));
      for (const invalid of ["Invented evidence", "[NUMBER]"]) assert.throws(() => validateClassificationAi(prepared, { decisions: decisions.map((row) => ({ ...row, quote: invalid })) }, "model"));
    }
    assert.throws(() => validateClassificationAi(prepared, { decisions: output.decisions.map((row) => ({ ...row, quote: "", confidence: "high" })) }, "model"));
  }
});

test("missing per-office categories fail clearly rather than returning unclassified rows", () => {
  const data = setup();
  data.bankTransactions[0].officeCode = "9999-9999";
  assert.throws(() => prepare(data), /使用できる勘定科目/);
  data.accountingCategories = [];
  assert.throws(() => prepare(data), /使用できる勘定科目/);
});

function serviceFixture() {
  const data = setup(), prepared = prepare(data);
  const input = { scope, revision: prepared.preview.revision, model: "test-model", consent: true };
  let calls = 0, audit = "", during = () => {};
  const deps: NonNullable<Parameters<typeof runClassificationAi>[3]> = {
    read: async () => structuredClone(data),
    mutate: async (_user, action, _type, _id, change, _before, options) => {
      assert.equal(action, "BANK_AI_CLASSIFICATION_REQUEST"); assert.equal(options?.undoable, false);
      const draft = structuredClone(data), result = change(draft); audit = JSON.stringify(result); Object.assign(data, draft); return result;
    },
    config: async () => ({ openAiApiKey: "fake-key", ocrAiModel: "test-model", openAiSource: "env", ocrAiModelSource: "env", googleVisionApiKey: "", googleVisionSource: "none" }),
    request: async (payload) => { calls++; during(); return answer(payload); },
  };
  return { data, input, deps, calls: () => calls, audit: () => audit, during: (fn: () => void) => { during = fn; } };
}

test("AI service records only bounded usage; records, amounts, invoices, payments and audit evidence are not classified", async () => {
  const f = serviceFixture(), before = structuredClone(f.data);
  const result = await runClassificationAi("admin", "JAPAN", f.input, f.deps);
  assert.equal(result.suggested, 3); assert.equal(f.calls(), 1); assert.equal(f.data.bankAiUsage?.JAPAN?.count, 1);
  for (const key of ["bankTransactions", "accountingCategories", "issuedInvoices", "receivedInvoices", "payments", "mailDocuments", "bankReconciliations"] as const) assert.deepEqual(f.data[key], before[key]);
  assert.doesNotMatch(f.audit(), /SHINKANSEN|fake-key|1200|PRIVATE/);
  await assert.rejects(runClassificationAi("admin", "JAPAN", f.input, f.deps), /15秒/);
  assert.equal(f.calls(), 1);
});

test("no consent, no key, stale data, wrong model and changed roles fail before AI sends data or spends usage", async () => {
  for (const variant of ["consent", "key", "stale", "model", "role", "deleted", "locked-role"] as const) {
    const f = serviceFixture();
    if (variant === "key") { const config = await f.deps.config(); f.deps.config = async () => ({ ...config, openAiApiKey: "" }); }
    if (variant === "stale") f.data.bankTransactions[0].content += " changed";
    if (variant === "role") f.data.users[0].role = "MAIL_EDITOR";
    if (variant === "deleted") f.data.users[0].deletedAt = "2026-01-01";
    if (variant === "locked-role") { const mutate = f.deps.mutate; f.deps.mutate = async (...args) => { f.data.users[0].role = "MAIL_EDITOR"; return mutate(...args); }; }
    await assert.rejects(runClassificationAi("admin", "JAPAN", { ...f.input, ...(variant === "consent" ? { consent: false } : {}), ...(variant === "model" ? { model: "forged" } : {}) }, f.deps));
    assert.equal(f.calls(), 0); assert.equal(f.data.bankAiUsage, undefined);
  }
});

test("changed source/category/role during AI and provider failures preserve data without applying stale output", async () => {
  for (const variant of ["source", "category", "role", "provider"] as const) {
    const f = serviceFixture();
    if (variant === "source") f.during(() => { f.data.bankTransactions[0].amount++; });
    if (variant === "category") f.during(() => { f.data.accountingCategories[0].available = false; });
    if (variant === "role") f.during(() => { f.data.users[0].role = "MAIL_EDITOR"; });
    if (variant === "provider") f.deps.request = async () => { throw new Error("provider timeout"); };
    await assert.rejects(runClassificationAi("admin", "JAPAN", f.input, f.deps));
    assert.equal(f.data.bankAiUsage?.JAPAN?.count, 1);
    assert.equal(f.data.bankTransactions[0].categoryId, undefined);
  }
});

test("classification provider uses strict output, bounded tokens/timeout, fixed destination and no tools/storage", async () => {
  const payload = prepare().preview.payload;
  await requestClassificationAi(payload, { apiKey: "fake-key", model: "test-model" }, async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false); assert.equal(body.max_completion_tokens, 12000); assert.equal(body.tools, undefined);
    assert.equal(body.response_format.json_schema.strict, true); assert.equal(body.response_format.json_schema.name, "bank_account_categories");
    const decisionSchema = body.response_format.json_schema.schema.properties.decisions.items;
    assert.equal(decisionSchema.properties.categoryRef.type, "string");
    assert.ok(decisionSchema.required.includes("categoryRef"));
    assert.match(body.messages[0].content, /categoryRef must never be null/);
    assert.deepEqual(JSON.parse(body.messages[1].content), payload);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer(payload)) } }] }));
  });
});
