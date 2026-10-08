import assert from "node:assert/strict";
import test from "node:test";
import { fixture, timestamp } from "./document-fixture";
import { authorizeBankAi, maskBankAiText, prepareBankAi, reserveBankAiUsage, validateBankAiResult } from "../src/lib/bank-ai";
import { requestBankAi } from "../src/lib/bank-ai-client";
import { runBankAiReview } from "../src/lib/bank-ai-service";
import { bankDocumentReview } from "../src/lib/bank-review";
import { bankReconciliationOverview } from "../src/lib/bank-reconciliation";
import { restoreUndoState } from "../src/lib/store";
import type { User } from "../src/lib/types";

const today = "2026-10-09";
function setup() {
  const data = fixture();
  data.users.push({ id: "admin", name: "Test admin", email: "admin@example.invalid", passwordHash: "not-a-real-secret", role: "ADMIN", accessStatus: "ACTIVE", createdAt: timestamp, updatedAt: timestamp } as User);
  data.bankAccounts.push({ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "Test bank", serviceName: "Bank", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp });
  data.bankTransactions.push({ id: "expense", company: "JAPAN", officeCode: "office", sourceId: "expense-source", bankAccountId: "bank", side: "EXPENSE", amount: 8000, content: "Test supplier", transactionDate: today, sourceMemo: "DO NOT SEND", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "DO NOT SEND", createdAt: timestamp, updatedAt: timestamp });
  data.bankTransactions.push({ ...data.bankTransactions[0], id: "income", sourceId: "income-source", side: "INCOME", amount: 24000, content: "Test customer INV-001 INV-002" });
  data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.internalMemo = "DO NOT SEND"; row.ocrText = "請求 INV-001 合計 12000\npassword DO NOT SEND"; });
  data.receivedInvoices[0].status = "SCHEDULED"; data.receivedInvoices[0].mailProcessed = false;
  data.receivedInvoices[0].ocrText = "請求 Test supplier 合計 8000\n内部 DO NOT SEND";
  data.mailDocuments[0].mailProcessed = false; data.mailDocuments[0].ocrText = "請求 Test supplier 合計 8000\n御中 contact@example.invalid 1234567\nAPI sk-secret12345678\n領収 https://secret.invalid";
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "orphan", title: "Test supplier 未連携", relatedReceivedInvoiceId: undefined });
  return data;
}
function prepared(data = setup()) { return prepareBankAi(data, "JAPAN", { mode: "transaction", transactionId: "expense" }, today); }
function validOutput() { return { suggestions: [{ bankRef: "B1", invoiceRefs: ["I1"], mailRefs: ["M1"], explanation: "摘要・請求書・郵便物に同じ取引先名があり、関連する可能性があります。", evidence: [{ ref: "B1", quote: "Test supplier" }, { ref: "I1", quote: "Test supplier" }, { ref: "M1", quote: "Test supplier" }] }] }; }

test("AI context includes bank, invoice and postal evidence but not secrets, memos, files or foreign company data", () => {
  const data = setup(), before = JSON.stringify(data), context = prepared(data), text = JSON.stringify(context.preview.payload);
  assert.equal(context.banks.length, 1); assert.equal(context.invoices.length, 1); assert.equal(context.mails.length, 2);
  assert.ok(text.includes("Test supplier")); assert.ok(text.includes("未連携"));
  for (const secret of ["DO NOT SEND", "contact@example.invalid", "1234567", "secret.invalid", "sk-secret", "passwordHash", "/api/files", "INV-CN", "China project", "expense-source"]) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes("[EMAIL]")); assert.ok(text.includes("[NUMBER]"));
  assert.equal(JSON.stringify(data), before);
});

test("permission gate allows active accounting/admin only and rejects forged company", () => {
  const data = setup(); assert.equal(authorizeBankAi(data, "admin", "JAPAN").id, "admin");
  for (const role of ["MAIL_EDITOR", "BILLING_EDITOR", "PROJECT_MANAGER", "GUEST"] as const) { data.users[0].role = role; assert.throws(() => authorizeBankAi(data, "admin", "JAPAN")); }
  data.users[0].role = "ACCOUNTING"; assert.ok(authorizeBankAi(data, "admin", "CHINA"));
  data.users[0].deletedAt = timestamp; assert.throws(() => authorizeBankAi(data, "admin", "JAPAN"));
  data.users[0].deletedAt = undefined; data.users[0].accessStatus = "PENDING"; assert.throws(() => authorizeBankAi(data, "admin", "JAPAN"));
  assert.throws(() => authorizeBankAi(data, "missing", "JAPAN"));
  data.users[0].accessStatus = "ACTIVE"; assert.throws(() => authorizeBankAi(data, "admin", "INVALID" as "JAPAN"));
});

test("income scope does not send unrelated postal receipts and China cannot access Japan rows", () => {
  const data = setup(), income = prepareBankAi(data, "JAPAN", { mode: "transaction", transactionId: "income" }, today);
  assert.equal(income.mails.length, 0); assert.equal(income.invoices.length, 2);
  const china = prepareBankAi(data, "CHINA", { mode: "transaction", transactionId: "expense" }, today);
  assert.equal(china.banks.length, 0); assert.equal(china.invoices.length, 0); assert.equal(china.mails.length, 0);
  data.receivedInvoices[0].projectId = "china";
  assert.ok(!prepared(data).mails.some((row) => row.id === "mail-1"));
});

test("card/transfer/missing/future movements and ineligible invoices do not enter AI matching", () => {
  for (const patch of [{ treatment: "TRANSFER" }, { treatment: "EXCLUDED" }, { sourceMissing: true }, { transactionDate: "2026-10-10" }]) { const data = setup(); Object.assign(data.bankTransactions[0], patch); assert.equal(prepared(data).banks.length, 0); }
  const data = setup(); data.bankAccounts[0].forecastSettings = { accountKind: "CARD", balanceMonth: "2026-10", minimumBalance: 0, incomePercent: 0, expensePercent: 0 };
  assert.equal(prepared(data).banks.length, 0);
  data.bankAccounts[0].forecastSettings = undefined; data.receivedInvoices[0].status = "OCR_PENDING";
  assert.equal(prepared(data).invoices.length, 0); assert.equal(prepared(data).mails.length, 2);
  assert.throws(() => prepareBankAi(data, "JAPAN", { mode: "month", month: "2026-11" }, today));
});

test("validated cross-document suggestions have canonical local links and independently calculated differences", () => {
  const data = setup(), before = JSON.stringify(data), context = prepared(data), result = validateBankAiResult(context, validOutput(), "configured-model");
  const row = result.suggestions[0];
  assert.equal(row.invoiceAmount, 8000); assert.equal(row.difference, 0); assert.equal(row.mails.length, 1);
  assert.ok(row.bank.href.startsWith("/banking/reconcile?company=JAPAN"));
  assert.ok(row.mails[0].href.startsWith("/received-invoices?company=JAPAN"));
  assert.ok(row.cautions.some((text) => text.includes("推測"))); assert.equal(JSON.stringify(data), before);
  data.bankTransactions[0].amount = 7670;
  const partial = validateBankAiResult(prepared(data), validOutput(), "configured-model").suggestions[0];
  assert.equal(partial.difference, -330); assert.ok(partial.cautions.some((text) => text.includes("差額")));
});

test("combined invoice and postal-only suggestions never create payments or double count mail", () => {
  const data = setup(), context = prepareBankAi(data, "JAPAN", { mode: "transaction", transactionId: "income" }, today);
  const result = validateBankAiResult(context, { suggestions: [{ bankRef: "B1", invoiceRefs: ["I1", "I2"], mailRefs: [], explanation: "合算の候補です", evidence: [{ ref: "B1", quote: "Test customer" }, { ref: "I1", quote: "Test customer" }, { ref: "I2", quote: "Test customer" }] }] }, "model");
  assert.equal(result.suggestions[0].invoiceAmount, 24000); assert.equal(result.suggestions[0].difference, 0);
  const postal = prepared(data), orphanRef = postal.preview.payload.mails.find((row) => !row.linked)!.ref;
  const onlyMail = validateBankAiResult(postal, { suggestions: [{ bankRef: "B1", invoiceRefs: [], mailRefs: [orphanRef], explanation: "郵便物が関連する可能性があります", evidence: [{ ref: "B1", quote: "Test supplier" }, { ref: orphanRef, quote: "Test supplier" }] }] }, "model");
  assert.equal(onlyMail.suggestions[0].invoiceAmount, null); assert.equal(onlyMail.suggestions[0].difference, null);
  assert.ok(onlyMail.suggestions[0].cautions.some((text) => text.includes("未連携"))); assert.equal(data.payments.length, 0);
});

test("invented IDs, fabricated evidence, duplicates and wrong directions fail closed", () => {
  for (const mutate of [
    (value: ReturnType<typeof validOutput>) => { value.suggestions[0].bankRef = "B99"; },
    (value: ReturnType<typeof validOutput>) => { value.suggestions[0].invoiceRefs = ["I99"]; },
    (value: ReturnType<typeof validOutput>) => { value.suggestions[0].mailRefs = ["M99"]; },
    (value: ReturnType<typeof validOutput>) => { value.suggestions[0].invoiceRefs = ["I1", "I1"]; },
    (value: ReturnType<typeof validOutput>) => { value.suggestions[0].evidence[0].quote = "invented quotation"; },
    (value: ReturnType<typeof validOutput>) => { value.suggestions[0].evidence.pop(); },
    (value: ReturnType<typeof validOutput>) => { value.suggestions.push(value.suggestions[0]); },
  ]) { const data = setup(), before = JSON.stringify(data), output = validOutput(); mutate(output); assert.throws(() => validateBankAiResult(prepared(data), output, "model")); assert.equal(JSON.stringify(data), before); }
  const context = prepareBankAi(setup(), "JAPAN", { mode: "month", month: "2026-10" }, today);
  const incomeRef = context.preview.payload.banks.find((row) => row.side === "INCOME")!.ref;
  const receivedRef = context.preview.payload.invoices.find((row) => row.kind === "received")!.ref;
  const output = validOutput(); output.suggestions[0].bankRef = incomeRef; output.suggestions[0].invoiceRefs = [receivedRef];
  assert.throws(() => validateBankAiResult(context, output, "model"));
  assert.throws(() => validateBankAiResult(prepared(), { ...validOutput(), execute: "delete all" }, "model"));
});

test("data version changes invalidate AI context while usage tracking does not", () => {
  const data = setup(), revision = prepared(data).preview.revision;
  reserveBankAiUsage(data, "JAPAN", new Date("2026-10-09T00:00:00Z")); assert.equal(prepared(data).preview.revision, revision);
  for (const mutate of [
    (copy: typeof data) => { copy.bankTransactions[0].amount++; },
    (copy: typeof data) => { copy.receivedInvoices[0].total++; },
    (copy: typeof data) => { copy.mailDocuments[0].ocrText = "請求内容が更新されました"; },
    (copy: typeof data) => { copy.mailDocuments[0].relatedReceivedInvoiceId = undefined; },
  ]) { const copy = structuredClone(data); mutate(copy); assert.notEqual(prepared(copy).preview.revision, revision); }
});

test("payload limits are bounded and report the unexamined population", () => {
  const data = setup();
  for (let i = 0; i < 100; i++) {
    data.bankTransactions.push({ ...data.bankTransactions[0], id: `bank-${i}`, sourceId: `bank-${i}` });
    data.receivedInvoices.push({ ...data.receivedInvoices[0], id: `received-${i}` });
    data.mailDocuments.push({ ...data.mailDocuments[0], id: `mail-${i}`, relatedReceivedInvoiceId: undefined });
  }
  const context = prepareBankAi(data, "JAPAN", { mode: "month", month: "2026-10" }, today);
  assert.equal(context.banks.length, 20); assert.equal(context.invoices.length, 40); assert.equal(context.mails.length, 30);
  assert.equal(context.preview.totals.banks, 102); assert.ok(context.preview.totals.invoices > 40); assert.ok(context.preview.totals.mails > 30);
  assert.ok(JSON.stringify(context.preview.payload).length < 70000);
});

test("persistent company usage caps, cooldown and Undo cannot reset a charged attempt", () => {
  const data = setup(), time = new Date("2026-10-09T00:00:00Z"), initial = structuredClone(data);
  assert.equal(reserveBankAiUsage(data, "JAPAN", time), 1);
  assert.throws(() => reserveBankAiUsage(data, "JAPAN", time)); assert.equal(reserveBankAiUsage(data, "CHINA", time), 1);
  restoreUndoState(data, initial); assert.equal(data.bankAiUsage?.JAPAN?.count, 1);
  for (let i = 1; i < 50; i++) reserveBankAiUsage(data, "JAPAN", new Date(time.getTime() + i * 15000));
  assert.throws(() => reserveBankAiUsage(data, "JAPAN", new Date(time.getTime() + 50 * 15000)));
  assert.equal(reserveBankAiUsage(data, "JAPAN", new Date("2026-10-10T00:00:00Z")), 1);
});

test("provider requests use a fixed endpoint, strict schema, no storage, bounded output, timeout and no redirects", async () => {
  const payload = prepared().preview.payload;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store"); assert.ok(init?.signal);
    const body = JSON.parse(init!.body as string); assert.equal(body.store, false); assert.equal(body.model, "configured-model"); assert.equal(body.max_completion_tokens, 4000);
    assert.equal(body.response_format.json_schema.strict, true); assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.ok(body.messages[0].content.includes("untrusted")); assert.deepEqual(JSON.parse(body.messages[1].content), payload); assert.ok(!String(init?.body).includes("fake-test-key"));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(validOutput()) } }] }));
  };
  assert.deepEqual(await requestBankAi(payload, { apiKey: "fake-test-key", model: "configured-model" }, fetcher), validOutput());
});

test("provider refusal, truncation, bad JSON, oversized responses and secret-bearing errors are not exposed", async () => {
  const payload = prepared().preview.payload, config = { apiKey: "fake-test-key", model: "model" };
  for (const response of [
    new Response("secret-body fake-test-key", { status: 401 }), new Response("secret-body", { status: 429 }),
    new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "secret-body" } }] })),
    new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })),
    new Response("x".repeat(100001)), new Response("not JSON secret-body"),
  ]) await assert.rejects(requestBankAi(payload, config, async () => response), (error: Error) => !error.message.includes("secret-body") && !error.message.includes("fake-test-key"));
  await assert.rejects(requestBankAi(payload, config, async () => { throw new Error("network error fake-test-key"); }), (error: Error) => !error.message.includes("fake-test-key"));
  await assert.rejects(requestBankAi(payload, config, async () => { throw new Error("AI network error fake-test-key"); }), (error: Error) => !error.message.includes("fake-test-key"));
});

test("missing key makes no network call, and masking handles common identifiers", async () => {
  await assert.rejects(requestBankAi(prepared().preview.payload, { apiKey: "", model: "model" }, async () => { assert.fail("must not call provider"); }));
  const text = maskBankAiText("contact@example.com 03-6260-9614 0683879 GB29NWBK60161331926819 mf_api_secret_test https://example.com/private", 1000);
  for (const forbidden of ["example.com", "6260", "0683879", "GB29", "secret_test"]) assert.ok(!text.includes(forbidden));
});

test("rule review finds postal linkage, status mismatch and duplicate candidates without asserting missing documents", () => {
  const data = setup(); data.receivedInvoices[0].status = "PAID";
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "received-copy" });
  const before = JSON.stringify(data), review = bankDocumentReview(data, "JAPAN", bankReconciliationOverview(data, "JAPAN", today));
  assert.ok(review.counts.inconsistent >= 2); assert.equal(review.counts.unlinked_mail, 1); assert.ok(review.counts.duplicate >= 1); assert.equal(review.counts.bank_unmatched, 1);
  assert.ok(review.items.some((row) => row.detail.includes("書類不足とは限りません"))); assert.equal(JSON.stringify(data), before);
  assert.equal(bankDocumentReview(data, "CHINA").counts.bank_unmatched, 0);
});

test("postal copies linked to the same invoice are not double-counted and review pages are bounded", () => {
  const data = setup(); data.mailDocuments[0].fileHash = "same";
  data.mailDocuments.push({ ...data.mailDocuments[0], id: "same-canonical" });
  assert.equal(bankDocumentReview(data, "JAPAN").counts.duplicate, 1); // Two existing issued invoices share party/date/total.
  for (let i = 0; i < 100; i++) data.mailDocuments.push({ ...data.mailDocuments[1], id: `unlinked-${i}` });
  const result = bankDocumentReview(data, "JAPAN", undefined, "unlinked_mail", 2);
  assert.equal(result.page, 2); assert.equal(result.items.length, 30); assert.equal(result.filteredTotal, 101);
  assert.equal(bankDocumentReview(data, "JAPAN", undefined, "__proto__").kind, "all");
});

function serviceFixture() {
  const data = setup(); data.bankTransactions[0].transactionDate = "2000-01-01";
  const scope = { mode: "transaction" as const, transactionId: "expense" };
  const input = { scope, revision: prepareBankAi(data, "JAPAN", scope).preview.revision, consent: true };
  let calls = 0, auditMetadata = "", whileRequest = () => {};
  const deps: NonNullable<Parameters<typeof runBankAiReview>[3]> = {
    read: async () => structuredClone(data),
    mutate: async (_user, _action, _type, _id, change, _before, options) => {
      assert.equal(options?.undoable, false);
      const draft = structuredClone(data), result = change(draft); auditMetadata = JSON.stringify(result); Object.assign(data, draft); return result;
    },
    config: async () => ({ openAiApiKey: "fake-test-key", ocrAiModel: "configured-model", googleVisionApiKey: "", googleVisionSource: "none", openAiSource: "settings", ocrAiModelSource: "settings" }),
    request: async () => { calls++; whileRequest(); return validOutput(); },
  };
  return { data, input, deps, calls: () => calls, audit: () => auditMetadata, duringRequest: (callback: () => void) => { whileRequest = callback; } };
}

test("analysis workflow reserves usage but leaves every financial record unchanged and audit contains no source text", async () => {
  const fixture = serviceFixture(), before = structuredClone(fixture.data);
  const result = await runBankAiReview("admin", "JAPAN", fixture.input, fixture.deps);
  assert.equal(result.suggestions.length, 1); assert.equal(fixture.calls(), 1); assert.equal(fixture.data.bankAiUsage?.JAPAN?.count, 1);
  for (const key of ["bankTransactions", "bankReconciliations", "issuedInvoices", "receivedInvoices", "mailDocuments", "payments"] as const) assert.deepEqual(fixture.data[key], before[key]);
  for (const secret of ["Test supplier", "OCR", "8000", "fake-test-key", "DO NOT SEND"]) assert.ok(!fixture.audit().includes(secret), secret);
});

test("missing consent, stale preview, cross-company requests and missing API keys never call AI or reserve usage", async () => {
  for (const variant of ["consent", "stale", "company", "key"] as const) {
    const fixture = serviceFixture();
    if (variant === "key") { const config = await fixture.deps.config(); fixture.deps.config = async () => ({ ...config, openAiApiKey: "" }); }
    const input = { ...fixture.input, ...(variant === "consent" ? { consent: false } : {}), ...(variant === "stale" ? { revision: "0".repeat(64) } : {}) };
    await assert.rejects(runBankAiReview("admin", variant === "company" ? "CHINA" : "JAPAN", input, fixture.deps));
    assert.equal(fixture.calls(), 0); assert.equal(fixture.data.bankAiUsage, undefined);
  }
});

test("data or permission changes while AI is running discard its output; provider failures retain the usage attempt", async () => {
  for (const variant of ["source", "role", "provider"] as const) {
    const fixture = serviceFixture();
    if (variant === "source") fixture.duringRequest(() => { fixture.data.bankTransactions[0].amount++; });
    if (variant === "role") fixture.duringRequest(() => { fixture.data.users[0].role = "MAIL_EDITOR"; });
    if (variant === "provider") fixture.deps.request = async () => { throw new Error("AI timeout"); };
    await assert.rejects(runBankAiReview("admin", "JAPAN", fixture.input, fixture.deps));
    assert.equal(fixture.data.bankAiUsage?.JAPAN?.count, 1); assert.equal(fixture.data.payments.length, 0);
  }
});

test("live permission is rechecked inside the reservation lock before transmitting any data", async () => {
  const fixture = serviceFixture(), mutate = fixture.deps.mutate;
  fixture.deps.mutate = async (...args) => { fixture.data.users[0].role = "BILLING_EDITOR"; return mutate(...args); };
  await assert.rejects(runBankAiReview("admin", "JAPAN", fixture.input, fixture.deps));
  assert.equal(fixture.calls(), 0); assert.equal(fixture.data.bankAiUsage, undefined);
});
