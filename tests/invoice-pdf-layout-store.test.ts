import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin } from "./document-fixture";
import { applyEstimatePdfEdits, applyIssuedInvoicePdfEdits } from "../src/lib/invoice-pdf-layout-store";
import { estimatePdfContent, estimatePdfDraft, issuedInvoicePdfDraft, issuedPdfContent } from "../src/lib/pdf-document-draft";
import { pdfTextDefaults } from "../src/lib/pdf-document-text";
import { pdfContentIssue, pdfIssueMessage, type PdfContent } from "../src/lib/pdf-document-values";
import { estimatePdfMeta, issuedPdfMeta } from "../src/lib/pdf-layout-meta";
import { saveEstimate } from "../src/lib/estimates";
import { projectMoney } from "../src/lib/store";
import type { AppData } from "../src/lib/types";

// Edits invoices made by others, so the amount switch is on (see issued-amount-access.test.ts for the refusal).
const billing = { id: "billing", role: "BILLING_EDITOR" as const, featureAccess: { issuedInvoiceAmounts: true } };
const mail = { id: "mail", role: "MAIL_EDITOR" as const };

function generated() {
  const data = fixture();
  const invoice = data.issuedInvoices[0];
  delete invoice.fileUrl; delete invoice.originalFileName;
  invoice.taxRounding = "PER_RATE"; invoice.subtotal = 12000; invoice.taxTotal = 1200; invoice.total = 13200;
  data.issuedInvoiceItems = [
    { id: "line-1", invoiceId: invoice.id, description: "ロゴデザイン", details: "修正2回", quantity: 1, unitPrice: 12000, amount: 12000, taxRate: 10, createdAt: invoice.createdAt, updatedAt: invoice.updatedAt },
    { id: "other-line", invoiceId: "issued-2", description: "別の請求書", quantity: 1, unitPrice: 500, amount: 500, taxRate: 10, createdAt: invoice.createdAt, updatedAt: invoice.updatedAt },
  ];
  return data;
}
const current = (data: AppData) => data.issuedInvoices[0];
const contentOf = (data: AppData): PdfContent => issuedPdfContent(current(data), data.issuedInvoiceItems.filter((item) => item.invoiceId === current(data).id));
const paid = (data: AppData, amount: number) => data.payments.push({ id: "payment", type: "INCOME", issuedInvoiceId: current(data).id, amount, paymentDate: "2026-10-01", createdById: "admin", createdAt: current(data).createdAt, updatedAt: current(data).updatedAt });

test("layout and wording are presentation only: only differences are stored and the version stays", () => {
  const data = generated();
  const before = structuredClone(current(data)), money = projectMoney(data, "japan");
  const defaults = pdfTextDefaults(before, data, "invoice");
  const result = applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id: before.id, layout: { density: "compact", fontSize: "standard", showDueDate: false, showSeal: false, fitOnePage: true, pageBreakBefore: 2 }, text: { ...defaults, recipient: "別名株式会社 様", issuerBuilding: "" } });
  assert.deepEqual(current(data).pdfLayout, { density: "compact", showDueDate: false, showSeal: false, pageBreakBefore: 2 });
  assert.deepEqual(current(data).pdfText, { recipient: "別名株式会社 様", issuerBuilding: "" }, "standard wording is not stored and an empty string hides the line");
  assert.equal(result.contentChanged, false);
  assert.equal(current(data).updatedAt, before.updatedAt, "a presentation change must not invalidate edits open in the list");
  assert.deepEqual({ ...current(data), pdfLayout: undefined, pdfText: undefined }, { ...before, pdfLayout: undefined, pdfText: undefined });
  assert.deepEqual(projectMoney(data, "japan"), money);
  assert.equal(data.clients[0].companyName, "Test customer", "the client record is untouched");
  // Leaving wording out of a later save keeps it; sending the defaults clears it.
  applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id: before.id, layout: { density: "standard" } });
  assert.ok(!("pdfLayout" in current(data)));
  assert.deepEqual(current(data).pdfText, { recipient: "別名株式会社 様", issuerBuilding: "" });
  applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id: before.id, layout: {}, text: defaults });
  assert.ok(!("pdfText" in current(data)));
});

test("editing lines recalculates the totals, updates the books and leaves other invoices alone", () => {
  const data = generated();
  current(data).status = "ISSUED";
  const before = structuredClone(current(data)), invoicedBefore = projectMoney(data, "japan").invoicedAmount;
  const content = contentOf(data);
  content.number = "INV-EDITED"; content.issueDate = "2026-09-20"; content.dueDate = "2026-10-31"; content.notes = "備考を追加";
  content.items = [{ ...content.items[0], quantity: 2 }, { description: "追加の作業", quantity: 1, unitPrice: 1000, taxRate: 8 }];
  const result = applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id: before.id, updatedAt: before.updatedAt, layout: {}, content });
  const invoice = current(data);
  assert.equal(result.contentChanged, true);
  assert.deepEqual([invoice.invoiceNumber, invoice.issueDate, invoice.dueDate, invoice.notes], ["INV-EDITED", "2026-09-20", "2026-10-31", "備考を追加"]);
  assert.deepEqual([invoice.subtotal, invoice.taxTotal, invoice.total, invoice.taxRounding], [25000, 2480, 27480, "PER_RATE"]);
  assert.notEqual(invoice.updatedAt, before.updatedAt);
  const lines = data.issuedInvoiceItems.filter((item) => item.invoiceId === invoice.id);
  assert.deepEqual(lines.map((item) => [item.description, item.amount]), [["ロゴデザイン", 24000], ["追加の作業", 1000]]);
  assert.equal(lines[0].id, "line-1", "a line keeps its identity");
  assert.ok(data.issuedInvoiceItems.some((item) => item.id === "other-line"));
  assert.equal(projectMoney(data, "japan").invoicedAmount - invoicedBefore, 27480 - 13200, "the project's billed amount follows the invoice");
});

test("rewording keeps saved amounts, even those from before per-rate rounding", () => {
  const data = generated();
  Object.assign(current(data), { taxRounding: undefined, taxTotal: 1199, total: 13199 });
  const content = contentOf(data);
  content.items[0].description = "ロゴデザイン（改訂版）";
  applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id: current(data).id, updatedAt: current(data).updatedAt, layout: {}, content });
  assert.deepEqual([current(data).taxTotal, current(data).total, current(data).taxRounding], [1199, 13199, undefined]);
  assert.equal(data.issuedInvoiceItems.find((item) => item.id === "line-1")?.description, "ロゴデザイン（改訂版）");
});

test("invoices with payments keep their amount but can still be reworded and renumbered", () => {
  const data = generated();
  paid(data, 1000);
  const id = current(data).id;
  const raised = contentOf(data); raised.items[0].unitPrice = 20000;
  assert.throws(() => applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id, updatedAt: current(data).updatedAt, layout: {}, content: raised }), /入金記録のある請求書の金額/);
  assert.throws(() => issuedInvoicePdfDraft(current(data), data, { content: raised }), /入金記録のある請求書の金額/, "the preview refuses what the save would refuse");
  assert.equal(current(data).total, 13200);
  const reworded = contentOf(data); reworded.number = "INV-RENAMED"; reworded.items[0].description = "品名だけ変更";
  applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id, updatedAt: current(data).updatedAt, layout: {}, content: reworded });
  assert.deepEqual([current(data).invoiceNumber, current(data).total], ["INV-RENAMED", 13200]);
  assert.equal(data.payments.filter((payment) => !payment.deletedAt).length, 1, "the payment record survives");
  assert.equal(issuedPdfMeta(current(data), data, admin).amountsLocked, true);
});

test("refused edits change nothing: stale versions, duplicate numbers, date order and installment plans", () => {
  const data = generated();
  const id = current(data).id;
  const snapshot = () => structuredClone({ invoice: current(data), items: data.issuedInvoiceItems });
  const before = snapshot();
  const changed = contentOf(data); changed.items[0].quantity = 3;
  assert.throws(() => applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id, updatedAt: "2020-01-01T00:00:00.000Z", layout: {}, content: changed }), /他の操作で更新/);
  assert.throws(() => applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id, layout: {}, content: changed }), /他の操作で更新/, "a content change must name its version");
  assert.deepEqual(snapshot(), before);
  const duplicate = { ...changed, number: data.issuedInvoices[1].invoiceNumber };
  assert.throws(() => applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id, updatedAt: current(data).updatedAt, layout: {}, content: duplicate }), /請求書番号が重複/);
  assert.deepEqual(snapshot(), before, "the totals set up for the check are put back");
  assert.throws(() => applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id, updatedAt: current(data).updatedAt, layout: {}, content: { ...changed, dueDate: "2020-01-01" } }), /期限は発行日以降/);
  assert.deepEqual(snapshot(), before);
  current(data).installmentSchedule = [{ id: "plan", dueDate: "2026-10-01", amount: 13000 }];
  const lower = contentOf(data); lower.items[0].unitPrice = 100;
  assert.throws(() => applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id, updatedAt: current(data).updatedAt, layout: {}, content: lower }), /分割入金予定/);
});

test("saves are refused for imported originals, other roles, unknown documents and invalid values", () => {
  const data = generated();
  const id = current(data).id;
  assert.throws(() => applyIssuedInvoicePdfEdits(data, mail, "JAPAN", { id, layout: {} }));
  assert.throws(() => applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id: "issued-2", layout: { density: "compact" } }), /取り込んだ原本/);
  assert.throws(() => applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id: "missing", layout: {} }), /見つかりません/);
  assert.throws(() => applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id, layout: { density: "huge" } as never }));
  assert.throws(() => applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id, layout: { pageBreakBefore: 0 } }));
  assert.throws(() => applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id, layout: { extra: true } as never }));
  assert.throws(() => applyIssuedInvoicePdfEdits(data, billing, "JAPAN", { id, layout: {}, text: { unknown: "x" } as never }));
  assert.throws(() => applyIssuedInvoicePdfEdits(data, billing, "CHINA", { id: "issued-cn", layout: { density: "compact" } }));
  assert.equal(current(data).pdfLayout, undefined);
});

test("problems in the dialog are named in Japanese before anything is sent", () => {
  const data = generated();
  const content = contentOf(data);
  assert.equal(pdfContentIssue(content, "invoice"), "");
  assert.equal(pdfContentIssue({ ...content, number: " " }, "invoice"), "番号を入力してください");
  assert.equal(pdfContentIssue({ ...content, dueDate: "2020-01-01" }, "invoice"), "期限は発行日以降にしてください");
  assert.equal(pdfContentIssue({ ...content, items: [{ ...content.items[0], description: "" }] }, "invoice"), "項目1の名称を確認してください");
  assert.equal(pdfContentIssue({ ...content, items: [content.items[0], { ...content.items[0], quantity: 0 }] }, "invoice"), "項目2の数量を確認してください");
  assert.equal(pdfContentIssue({ ...content, items: [] }, "invoice"), "項目を1行以上入力してください");
  assert.equal(pdfContentIssue({ ...content, dueDate: "" }, "invoice"), "");
  assert.equal(pdfContentIssue({ ...content, dueDate: "" }, "estimate"), "見積日と有効期限を入力してください");
  assert.equal(pdfIssueMessage({ path: ["content", "items", 1, "unitPrice"], message: "Too small" }), "項目2の単価を確認してください");
  assert.equal(pdfIssueMessage({ path: ["layout", "density"], message: "Invalid option" }), "入力内容を確認してください");
});

test("a preview draft never changes the data and matches what saving stores", () => {
  const data = generated();
  const before = structuredClone(data);
  const content = contentOf(data);
  content.number = "INV-DRAFT"; content.items[0].quantity = 2; content.notes = "下書き";
  const defaults = pdfTextDefaults(current(data), data, "invoice");
  const draft = issuedInvoicePdfDraft(current(data), data, { content, text: { ...defaults, title: "御請求書" } });
  assert.deepEqual(data, before, "nothing stored by a preview");
  assert.deepEqual([draft.invoice.invoiceNumber, draft.invoice.total, draft.invoice.notes], ["INV-DRAFT", 26400, "下書き"]);
  assert.deepEqual(draft.invoice.pdfText, { title: "御請求書" });
  applyIssuedInvoicePdfEdits(data, admin, "JAPAN", { id: current(data).id, updatedAt: current(data).updatedAt, layout: {}, content, text: { ...defaults, title: "御請求書" } });
  assert.deepEqual([current(data).invoiceNumber, current(data).total, current(data).notes, current(data).subtotal, current(data).taxTotal], [draft.invoice.invoiceNumber, draft.invoice.total, draft.invoice.notes, draft.invoice.subtotal, draft.invoice.taxTotal]);
  assert.deepEqual(current(data).pdfText, draft.invoice.pdfText);
  assert.deepEqual(data.issuedInvoiceItems.filter((i) => i.invoiceId === current(data).id).map((i) => i.amount), draft.data.issuedInvoiceItems.filter((i) => i.invoiceId === current(data).id).map((i) => i.amount));
});

test("estimates edit their content through the estimate rules and expose it to the dialog", () => {
  const data = fixture();
  const estimate = saveEstimate(data, admin, "JAPAN", { projectId: "japan", clientId: "client", issueDate: "2026-09-15", validUntil: "2026-11-30", status: "SENT", notes: "", internalMemo: "社内のみ",
    items: [{ description: "Design", quantity: 1, unitPrice: 10000, taxRate: 10 }, { description: "印刷", quantity: 1, unitPrice: 500, taxRate: 10 }] });
  const version = estimate.updatedAt;
  applyEstimatePdfEdits(data, admin, "JAPAN", { id: estimate.id, layout: { margin: "wide", fitOnePage: false, showDueDate: false } });
  assert.deepEqual(estimate.pdfLayout, { margin: "wide", fitOnePage: false, showDueDate: false });
  assert.equal(estimate.updatedAt, version, "layout alone keeps the version");
  const content = estimatePdfContent(estimate);
  content.number = "EST-CUSTOM"; content.dueDate = "2026-12-31"; content.notes = "納期は別途"; content.items[1].unitPrice = 1000;
  const draft = estimatePdfDraft(estimate, data, { content });
  assert.equal(estimate.total, 11550, "a preview changes nothing");
  assert.equal(draft.total, 12100);
  const result = applyEstimatePdfEdits(data, admin, "JAPAN", { id: estimate.id, updatedAt: version, layout: { margin: "wide", fitOnePage: false, showDueDate: false }, content });
  assert.equal(result.contentChanged, true);
  assert.deepEqual([estimate.estimateNumber, estimate.validUntil, estimate.notes, estimate.total, estimate.status, estimate.internalMemo], ["EST-CUSTOM", "2026-12-31", "納期は別途", draft.total, "SENT", "社内のみ"]);
  assert.deepEqual(estimate.pdfLayout, { margin: "wide", fitOnePage: false, showDueDate: false }, "saving content keeps the layout");
  const other = saveEstimate(data, admin, "JAPAN", { projectId: "japan", clientId: "client", issueDate: "2026-09-15", validUntil: "2026-11-30", status: "DRAFT", notes: "", internalMemo: "", items: [{ description: "別件", quantity: 1, unitPrice: 1, taxRate: 10 }] });
  assert.throws(() => applyEstimatePdfEdits(data, admin, "JAPAN", { id: other.id, updatedAt: other.updatedAt, layout: {}, content: { ...estimatePdfContent(other), number: "EST-CUSTOM" } }), /見積書番号が重複/);
  assert.throws(() => applyEstimatePdfEdits(data, mail, "JAPAN", { id: estimate.id, layout: {} }));
  const meta = estimatePdfMeta(estimate, data, admin);
  assert.deepEqual([meta.kind, meta.canEditContent, meta.amountsLocked, meta.content.number, meta.layout.showDueDate], ["estimate", true, false, "EST-CUSTOM", false]);
  estimate.invoiceId = "converted";
  assert.equal(estimatePdfMeta(estimate, data, admin).canEditContent, false);
  assert.throws(() => applyEstimatePdfEdits(data, admin, "JAPAN", { id: estimate.id, updatedAt: estimate.updatedAt, layout: {}, content: { ...estimatePdfContent(estimate), notes: "変換後" } }), /変換済み/);
});
