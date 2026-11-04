import test from "node:test";
import assert from "node:assert/strict";
import { fixture, admin } from "./document-fixture";
import { applyEstimatePdfLayout, applyIssuedInvoicePdfLayout } from "../src/lib/invoice-pdf-layout-store";
import { saveEstimate } from "../src/lib/estimates";
import { projectMoney } from "../src/lib/store";
import { pdfLayoutMeta } from "../src/lib/pdf-layout-meta";

const billing = { id: "billing", role: "BILLING_EDITOR" as const };

function generated() {
  const data = fixture();
  const invoice = data.issuedInvoices[0];
  delete invoice.fileUrl; delete invoice.originalFileName;
  data.issuedInvoiceItems = [{ id: "line", invoiceId: invoice.id, description: "ロゴデザイン 一式のご提案と制作、修正対応を含む", quantity: 1, unitPrice: 12000, amount: 12000, taxRate: 0, createdAt: invoice.createdAt, updatedAt: invoice.updatedAt }];
  return data;
}

test("saving a layout stores only the choices that differ from the defaults and leaves the document otherwise untouched", () => {
  const data = generated();
  const invoice = data.issuedInvoices[0];
  const before = structuredClone(invoice), money = projectMoney(data, "japan");
  const result = applyIssuedInvoicePdfLayout(data, billing, "JAPAN", { id: invoice.id, layout: { density: "compact", fontSize: "standard", showSeal: false, fitOnePage: true, pageBreakBefore: 2 } });
  assert.deepEqual(result, { id: invoice.id, layout: { density: "compact", showSeal: false, pageBreakBefore: 2 } });
  assert.deepEqual(invoice.pdfLayout, { density: "compact", showSeal: false, pageBreakBefore: 2 });
  assert.deepEqual({ ...invoice, pdfLayout: undefined }, { ...before, pdfLayout: undefined });
  assert.equal(invoice.updatedAt, before.updatedAt, "a presentation change must not invalidate edits open in the list");
  assert.deepEqual(projectMoney(data, "japan"), money);
  applyIssuedInvoicePdfLayout(data, admin, "JAPAN", { id: invoice.id, layout: { density: "standard" } });
  assert.ok(!("pdfLayout" in invoice), "a default layout removes the stored field");
});

test("layout saves are refused for imported originals, other roles, deleted or unknown documents and invalid values", () => {
  const data = generated();
  const invoice = data.issuedInvoices[0];
  assert.throws(() => applyIssuedInvoicePdfLayout(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", { id: invoice.id, layout: {} }));
  assert.throws(() => applyIssuedInvoicePdfLayout(data, billing, "JAPAN", { id: "issued-2", layout: { density: "compact" } }), /取り込んだ原本/);
  assert.throws(() => applyIssuedInvoicePdfLayout(data, billing, "JAPAN", { id: "missing", layout: {} }), /見つかりません/);
  assert.throws(() => applyIssuedInvoicePdfLayout(data, billing, "JAPAN", { id: invoice.id, layout: { density: "huge" } as never }));
  assert.throws(() => applyIssuedInvoicePdfLayout(data, billing, "JAPAN", { id: invoice.id, layout: { pageBreakBefore: 0 } }));
  assert.throws(() => applyIssuedInvoicePdfLayout(data, billing, "JAPAN", { id: invoice.id, layout: { extra: true } as never }));
  assert.throws(() => applyIssuedInvoicePdfLayout(data, billing, "CHINA", { id: "issued-cn", layout: { density: "compact" } }));
  assert.equal(invoice.pdfLayout, undefined);
});

test("estimates store their own layout and expose it with the line labels for the dialog", () => {
  const data = fixture();
  const estimate = saveEstimate(data, admin, "JAPAN", { projectId: "japan", clientId: "client", issueDate: "2026-09-15", validUntil: "2026-11-30", status: "DRAFT", notes: "", internalMemo: "",
    items: [{ description: "Design concept and three rounds of revisions for the brand", quantity: 1, unitPrice: 10000, taxRate: 10 }, { description: "印刷", quantity: 1, unitPrice: 500, taxRate: 10 }] });
  const before = structuredClone(estimate);
  applyEstimatePdfLayout(data, admin, "JAPAN", { id: estimate.id, layout: { margin: "wide", fitOnePage: false } });
  assert.deepEqual(estimate.pdfLayout, { margin: "wide", fitOnePage: false });
  assert.equal(estimate.updatedAt, before.updatedAt);
  assert.deepEqual(estimate.items, before.items);
  assert.throws(() => applyEstimatePdfLayout(data, { id: "mail", role: "MAIL_EDITOR" }, "JAPAN", { id: estimate.id, layout: {} }));
  const meta = pdfLayoutMeta(estimate, estimate.items, Boolean(estimate.notes));
  assert.equal(meta.saved, true);
  assert.equal(meta.hasNotes, false);
  assert.deepEqual(meta.layout, { density: "standard", fontSize: "standard", margin: "wide", fitOnePage: false, showNotes: true, showBank: true, showSeal: true });
  assert.deepEqual(meta.items, ["Design concept and…", "印刷"]);
  assert.equal(pdfLayoutMeta({}, [], true).saved, false);
});
