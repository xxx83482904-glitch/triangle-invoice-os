import assert from "node:assert/strict";
import test from "node:test";
import { admin, fixture, timestamp } from "./document-fixture";
import { inferReceivedInvoiceFromAnalysis } from "../src/lib/ocr";
import { applyReceivedInvoiceFields } from "../src/lib/received-invoice-edits";
import { receivedAmountsFromForm, receivedInvoiceEvidence, receivedInvoiceWarnings, validateReceivedAmounts, validateReceivedDates } from "../src/lib/received-invoice-review";
import { originalPreviewBlob } from "../src/lib/original-file-preview";
import { confirmBankReconciliation, reconciliationIssue } from "../src/lib/bank-reconciliation";
import { paidForReceived } from "../src/lib/store";
import { sectionExport } from "../src/lib/section-export";

const text = "請求元: Test supplier\nJapan project\n請求日: 2026年09月15日\n支払期限: 2026年10月15日\n税抜: 100,000円\n消費税 (10%): 10,000円\n税込合計: 110,000円\n源泉徴収税額: 10,210円\n差引支払額: 99,790円\n振込先: Test Bank\n口座名義: Test supplier";
const amounts = { subtotal: 100000, taxTotal: 10000, grossAmount: 110000, withholdingAmount: 10210, total: 99790 };
const extracted = (source = text) => ({ engine: "fixture", text: source, warnings: [] });
function form(values: Record<string, string | number> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ ...amounts, vendorId: "vendor", projectId: "japan", issueDate: "2026-09-15", dueDate: "2026-10-15", expectedUpdatedAt: timestamp, memo: "Reviewed synthetic original", ...values })) result.set(key, String(value));
  return result;
}

test("labelled issuer wins over remittance bank and conflicting AI dates; evidence remains auditable", () => {
  const data = fixture();
  data.vendors.unshift({ ...data.vendors[0], id: "bank-vendor", companyName: "Test Bank" });
  const result = inferReceivedInvoiceFromAnalysis(data, extracted(), "JAPAN", { vendorName: "Test Bank", issueDate: "2026-10-15", dueDate: "2026-10-15" });
  assert.equal(result.vendorId, "vendor");
  assert.equal(result.issueDate, "2026-09-15"); assert.equal(result.dueDate, "2026-10-15");
  for (const [key, value] of Object.entries(amounts)) assert.equal(result[key as keyof typeof amounts], value, key);
  assert.match(result.memo, /OCR evidence \[issuer\]: 請求元/);
  assert.match(result.memo, /OCR evidence \[issueDate\]: 請求日/);
  assert.ok(result.warnings.some((warning) => warning.includes("AI請求日")));
});

test("bank-only evidence cannot identify a supplier, while an explicitly issuing bank is permitted", () => {
  const data = fixture(); data.vendors[0].companyName = "Test Bank";
  const result = inferReceivedInvoiceFromAnalysis(data, extracted("振込先: Test Bank\nJapan project"), "JAPAN", { vendorName: "Test Bank" });
  assert.equal(result.vendorId, ""); assert.equal(result.vendorName, "支払先確認待ち");
  assert.ok(result.warnings.some((warning) => warning.includes("銀行")));
  assert.equal(inferReceivedInvoiceFromAnalysis(data, extracted("発行者: Test Bank\nJapan project"), "JAPAN", null).vendorId, "vendor");
});

test("a due date or unrelated date never fills a missing invoice date", () => {
  for (const source of ["支払期限: 2026-10-15", "2026-10-15", "請求日:\n支払期限: 2026-10-15"]) {
    const result = inferReceivedInvoiceFromAnalysis(fixture(), extracted(source), "JAPAN", null);
    assert.equal(result.issueDate, "");
    assert.ok(result.warnings.some((warning) => warning.includes("請求日が未確認")));
  }
  const evidence = receivedInvoiceEvidence("請求日: 2026-09-15 支払期限: 2026-10-15");
  assert.equal(evidence.issueDate, "2026-09-15"); assert.equal(evidence.dueDate, "2026-10-15");
});

test("explicit net is not replaced by gross when the source breakdown conflicts", () => {
  const result = inferReceivedInvoiceFromAnalysis(fixture(), extracted(text.replace("99,790円", "98,000円")), "JAPAN", null);
  assert.equal(result.total, 98000); assert.equal(result.grossAmount, 110000); assert.equal(result.taxTotal, 10000);
  assert.ok(result.warnings.some((warning) => warning.includes("一致しません")));
  assert.throws(() => validateReceivedAmounts(result), /差引支払額/);
  assert.equal(inferReceivedInvoiceFromAnalysis(fixture(), extracted(`ご請求金額: 110000円\n${text}`), "JAPAN", null).total, 99790);
});

test("missing consumption tax is not invented and withholding rates are not amounts", () => {
  const result = inferReceivedInvoiceFromAnalysis(fixture(), extracted("請求金額: 110000円\n源泉徴収税率: 10.21%"), "JAPAN", null);
  assert.equal(result.taxTotal, 0); assert.equal(result.total, 110000); assert.equal(result.withholdingAmount, undefined);
});

test("review warns about supplier/date conflicts and withholding not yet represented", () => {
  const warnings = receivedInvoiceWarnings({ subtotal: 110000, taxTotal: 0, total: 110000, vendorName: "Test Bank", issueDate: "2026-10-15", dueDate: "2026-09-15", ocrText: text });
  for (const term of ["銀行", "請求元候補", "請求日", "支払期限", "源泉徴収"]) assert.ok(warnings.some((warning) => warning.includes(term)), term);
});

test("amount validation rejects invalid, negative, fractional, unbalanced and overpaid changes", () => {
  for (const patch of [{ withholdingAmount: -1 }, { total: NaN }, { grossAmount: Infinity }, { taxTotal: 0.1 }, { total: 110000 }, { grossAmount: 120000 }]) assert.throws(() => validateReceivedAmounts({ ...amounts, ...patch }));
  assert.throws(() => validateReceivedAmounts(amounts, 100000), /登録済み/);
  assert.deepEqual(validateReceivedAmounts(amounts, 99790), amounts);
  assert.throws(() => receivedAmountsFromForm(form({ total: "" })), /金額/);
  assert.throws(() => validateReceivedDates("2026-02-30", "2026-10-15"));
});

test("legacy memo-only edits neither migrate nor invent an unknown breakdown", () => {
  const previous = { subtotal: 0, taxTotal: 0, total: 8000 };
  const parsed = receivedAmountsFromForm(form({ ...previous, grossAmount: 8000, withholdingAmount: 0 }), previous);
  assert.deepEqual(parsed, previous);
  assert.deepEqual(receivedAmountsFromForm(form(amounts), amounts), amounts);
  assert.deepEqual(receivedAmountsFromForm(form({ ...previous, grossAmount: "", withholdingAmount: "" }), previous), previous);
  assert.deepEqual(receivedAmountsFromForm(form({ grossAmount: "", withholdingAmount: "" }), amounts), amounts);
});

test("incomplete OCR edits allow blank dates and retain explicit unconfirmed warnings", () => {
  const data = fixture();
  const result = applyReceivedInvoiceFields(data, admin, "JAPAN", "received-1", form({ issueDate: "", dueDate: "" }));
  assert.equal(result.issueDate, ""); assert.equal(result.dueDate, "");
  const warnings = receivedInvoiceWarnings({ ...result, vendorName: "Test supplier" });
  assert.ok(warnings.some((warning) => warning.includes("請求日が未確認")));
  assert.ok(warnings.some((warning) => warning.includes("支払期限が未確認")));
  validateReceivedDates("", "2026-10-15"); validateReceivedDates("2026-09-15", "");
  assert.throws(() => validateReceivedDates("", "2026-02-30"));
});

test("field edits validate scope and concurrency atomically and never manufacture payments", () => {
  const data = fixture(); const before = structuredClone(data);
  for (const invalid of [form({ expectedUpdatedAt: "stale" }), form({ projectId: "china" }), form({ total: 110000 }), form({ dueDate: "2026-02-30" }), form({ vendorId: "missing" })]) {
    assert.throws(() => applyReceivedInvoiceFields(data, admin, "JAPAN", "received-1", invalid));
    assert.deepEqual(data, before);
  }
  assert.throws(() => applyReceivedInvoiceFields(data, { id: "guest", role: "GUEST" }, "JAPAN", "received-1", form()));
  const result = applyReceivedInvoiceFields(data, admin, "JAPAN", "received-1", form());
  assert.equal(result.total, 99790); assert.equal(result.grossAmount, 110000); assert.equal(result.withholdingAmount, 10210);
  assert.deepEqual(data.payments, []); assert.deepEqual(data.issuedInvoices, before.issuedInvoices);
});

test("net bank payment fully reconciles a withheld invoice without a gross balance", () => {
  const data = fixture(); const invoice = data.receivedInvoices[0]; Object.assign(invoice, amounts, { status: "SCHEDULED", mailProcessed: false });
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "Synthetic bank", serviceName: "三菱UFJ銀行", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
  data.bankTransactions = [{ id: "expense", company: "JAPAN", officeCode: "office", sourceId: "synthetic-expense", bankAccountId: "bank", side: "EXPENSE", amount: 99790, content: "Test supplier", transactionDate: "2026-10-15", sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp }];
  confirmBankReconciliation(data, admin, "JAPAN", { transactionId: "expense", transactionUpdatedAt: timestamp, invoiceKind: "received", invoiceId: invoice.id, invoiceUpdatedAt: timestamp, mode: "new", amount: 99790, acknowledged: true }, "2026-10-30");
  assert.equal(invoice.status, "PAID"); assert.equal(invoice.total - paidForReceived(data, invoice.id), 0);
  assert.equal(invoice.grossAmount, 110000); assert.equal(invoice.withholdingAmount, 10210);
  assert.equal(reconciliationIssue(data, data.bankReconciliations[0], "2026-10-30"), "");
  const exported = sectionExport(data, admin, { company: "JAPAN", scope: "received", start: "2026-09-01", end: "2026-10-31", basis: "document", undated: "1" });
  assert.equal(exported.documents.find((row) => row.sourceId === invoice.id)?.total, 99790);
});

test("preview checks authorization, HTML login responses, empty and invalid PDFs; retains original bytes", async () => {
  for (const status of [401, 403, 404, 500]) await assert.rejects(() => originalPreviewBlob(new Response("error", { status })));
  await assert.rejects(() => originalPreviewBlob(new Response("<html>login</html>", { headers: { "content-type": "text/html" } }), "application/pdf"));
  await assert.rejects(() => originalPreviewBlob(new Response("", { headers: { "content-type": "application/pdf" } })));
  await assert.rejects(() => originalPreviewBlob(new Response("not pdf", { headers: { "content-type": "application/pdf" } })));
  const original = "%PDF-1.7\nSynthetic original";
  const blob = await originalPreviewBlob(new Response(original, { headers: { "content-type": "application/octet-stream" } }));
  assert.equal(blob.type, "application/pdf"); assert.equal(await blob.text(), original);
});
