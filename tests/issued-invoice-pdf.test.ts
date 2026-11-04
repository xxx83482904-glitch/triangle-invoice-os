import test, { before, after } from "node:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { PDFParse } from "pdf-parse";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { buildIssuedInvoicePdf, createEstimatePdf, createIssuedInvoicePdf, invoiceIssuer } from "../src/lib/issued-invoice-pdf";
import { pdfLayoutFromQuery, pdfLayoutQuery } from "../src/lib/invoice-pdf-layout";
import { estimatePdfContent, estimatePdfDraft, issuedInvoicePdfDraft, issuedPdfContent } from "../src/lib/pdf-document-draft";
import { pdfTextDefaults } from "../src/lib/pdf-document-text";
import { pdfTextFields } from "../src/lib/pdf-document-values";
import type { InvoicePdfText } from "../src/lib/types";
import { invoicePdfCases, invoicePdfFixture } from "./invoice-pdf-fixture";
import type { Estimate, TaxRate } from "../src/lib/types";
import { documentItemTotals } from "../src/lib/document-items";

let sealRoot: string;
const previousSeal = process.env.INVOICE_SEAL_PATH;
before(async () => {
  // Synthetic test image only. The real company seal must never enter the public repository.
  sealRoot = await mkdtemp(path.join(os.tmpdir(), "triangle-test-seal-"));
  const canvas = createCanvas(192, 200); const context = canvas.getContext("2d");
  context.fillStyle = "#ee0000"; context.fillRect(8, 8, 176, 184);
  process.env.INVOICE_SEAL_PATH = path.join(sealRoot, "seal.png");
  await writeFile(process.env.INVOICE_SEAL_PATH, canvas.toBuffer("image/png"));
});
after(async () => {
  if (previousSeal === undefined) delete process.env.INVOICE_SEAL_PATH; else process.env.INVOICE_SEAL_PATH = previousSeal;
  await rm(sealRoot, { recursive: true, force: true });
});

test("mixed-rate PDFs match per-rate totals while legacy documents retain their saved amounts", async () => {
  for (const legacy of [false, true]) {
    const data = invoicePdfFixture();
    data.issuedInvoiceItems = ([10, 10, 8, 8, 0, -1] as TaxRate[]).map((taxRate, index) => ({
      ...data.issuedInvoiceItems[0], id: `tax-${index}`, description: `税率確認 ${index + 1}`, taxRate, quantity: 1, unitPrice: 15, amount: 15,
    }));
    const invoice = data.issuedInvoices[0];
    Object.assign(invoice, documentItemTotals(data.issuedInvoiceItems));
    if (legacy) { invoice.taxTotal = 6; invoice.total = 96; }
    else invoice.taxRounding = "PER_RATE";
    const before = structuredClone(data);
    for (const kind of ["invoice", "estimate"] as const) {
      const estimate: Estimate = { ...invoice, estimateNumber: "EST-TAX", validUntil: "2026-03-31", status: "DRAFT", items: data.issuedInvoiceItems };
      const pdf = kind === "invoice" ? await createIssuedInvoicePdf(invoice, data) : await createEstimatePdf(estimate, data);
      const parser = new PDFParse({ data: pdf });
      try {
        const text = (await parser.getText()).text.replaceAll(/\s/g, "");
        assert.ok(text.includes(`10%対象30/消費税${legacy ? 4 : 3}`), text);
        assert.ok(text.includes("8%対象30/消費税2"), text);
        assert.ok(text.includes(`合計${legacy ? 96 : 95}`), text);
        if (process.env.PDF_ARTIFACT_DIR && !legacy) {
          await mkdir(process.env.PDF_ARTIFACT_DIR, { recursive: true });
          const image = (await parser.getScreenshot({ desiredWidth: 882 })).pages[0];
          await writeFile(path.join(process.env.PDF_ARTIFACT_DIR, `${kind}-per-rate.png`), image.data);
        }
      } finally { await parser.destroy(); }
    }
    assert.deepEqual(data, before);
  }
});

test("estimate PDF has issuer, seal and validity but no payment instructions or internal memo", async () => {
  const data = invoicePdfFixture();
  const estimate: Estimate = { ...data.issuedInvoices[0], estimateNumber: "EST-2026-0001", validUntil: "2026-03-31", status: "DRAFT", items: data.issuedInvoiceItems, internalMemo: "PRIVATE_ONLY" };
  const parser = new PDFParse({ data: await createEstimatePdf(estimate, data) });
  try {
    const result = await parser.getText(); const text = result.text.replaceAll(/\s/g, "");
    assert.equal(result.total, 1);
    for (const value of ["見積書", "EST-2026-0001", "2026/03/31", "49,500", invoiceIssuer.name, invoiceIssuer.address]) assert.ok(text.includes(value));
    for (const value of ["ご請求", "お支払期限", "振込先", invoiceIssuer.accountNumber, "PRIVATE_ONLY"]) assert.ok(!text.includes(value));
    assert.ok(text.indexOf(invoiceIssuer.name) < text.indexOf(invoiceIssuer.address));
  } finally { await parser.destroy(); }
});

test("new invoice PDF embeds Japanese, requested issuer and bank on one A4 page", async () => {
  const data = invoicePdfFixture();
  data.issuedInvoices[0].billingLabel = "設計二回目請求書";
  const parser = new PDFParse({ data: await createIssuedInvoicePdf(data.issuedInvoices[0], data) });
  try {
    const result = await parser.getText();
    assert.equal(result.total, 1);
    const text = result.text.replaceAll(/\s/g, "");
    assert.ok(text.includes("設計二回目請求書"));
    for (const value of [...Object.values(invoiceIssuer), "49,500", "45,000", "4,500", "30,000", "15,000", "株式会社サンプル御中", "2026/02/28"]) {
      assert.ok(text.includes(value.replaceAll(/\s/g, "")), value);
    }
    assert.ok(!text.includes("HiDesign")); assert.ok(!text.includes("T0000000000000"));
    assert.ok(!text.includes("三角銀行"));
    assert.ok(text.indexOf(invoiceIssuer.name) < text.indexOf(invoiceIssuer.address), "Issuer name must be above the address");
    const screenshot = await parser.getScreenshot({ desiredWidth: 882 });
    assert.equal(Math.round(screenshot.pages[0].width), 882);
    if (process.env.PDF_ARTIFACT_DIR) {
      await mkdir(process.env.PDF_ARTIFACT_DIR, { recursive: true });
      await writeFile(path.join(process.env.PDF_ARTIFACT_DIR, "invoice-billing-label.png"), screenshot.pages[0].data);
    }
    assert.ok(screenshot.pages[0].data.length > 20000);
    const rendered = await loadImage(screenshot.pages[0].data);
    const canvas = createCanvas(rendered.width, rendered.height);
    const context = canvas.getContext("2d");
    context.drawImage(rendered, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const scale = canvas.width / 595.28;
    let sealPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 150 && pixels[i + 1] < 120 && pixels[i + 2] < 120) {
        const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
        assert.ok(x >= 500 * scale && x <= 564 * scale && y >= 133 * scale && y <= 201 * scale, "Seal must stay beside the issuer, away from text and totals");
        sealPixels++;
      }
    }
    assert.ok(sealPixels > 500, "The supplied red seal must render in the PDF");
  } finally { await parser.destroy(); }
});

test("long descriptions and many items paginate without losing rows or transfer details", async () => {
  const data = invoicePdfFixture(30);
  data.issuedInvoices[0].notes = "長い備考の表示確認\n".repeat(65);
  const parser = new PDFParse({ data: await createIssuedInvoicePdf(data.issuedInvoices[0], data) });
  try {
    const result = await parser.getText();
    assert.ok(result.total > 2 && result.total < 12);
    for (let i = 1; i <= 30; i++) assert.ok(result.text.includes(`明細${i}`));
    assert.ok(result.pages.at(-1)?.text.includes("0683879"));
    assert.equal(result.text.split("0683879").length, 2);
    for (const page of result.pages) assert.ok(page.text.includes(`${page.num} / ${result.total}`));
  } finally { await parser.destroy(); }
});

test("invoice and estimate PDFs keep multiline details under each item, including page continuations", async () => {
  for (const long of [false, true]) {
    const data = invoicePdfFixture();
    data.issuedInvoiceItems[0].details = long ? Array.from({ length: 75 }, (_, i) => `内訳行${String(i + 1).padStart(3, "0")} 基本設計と仕様の確認`).join("\n") : "基本設計一式\n修正2回・納品データを含む";
    data.issuedInvoiceItems[1].details = "色調整・最終確認";
    const estimate: Estimate = { ...data.issuedInvoices[0], estimateNumber: "EST-DETAILS", validUntil: "2026-03-31", status: "DRAFT", items: data.issuedInvoiceItems };
    for (const kind of ["invoice", "estimate"] as const) {
      const pdf = await (kind === "invoice" ? createIssuedInvoicePdf(data.issuedInvoices[0], data) : createEstimatePdf(estimate, data));
      const parser = new PDFParse({ data: pdf });
      try {
        const result = await parser.getText();
        assert.equal(result.text.split("色調整・最終確認").length, 2);
        assert.ok(result.text.indexOf(data.issuedInvoiceItems[0].description) < result.text.indexOf(long ? "内訳行001" : "基本設計一式"));
        if (long) {
          assert.ok(result.total >= 2);
          for (let i = 1; i <= 75; i++) assert.equal(result.text.split(`内訳行${String(i).padStart(3, "0")}`).length, 2);
        } else { assert.equal(result.total, 1); assert.ok(result.text.includes("修正2回・納品データを含む")); }
        assert.equal(result.text.split("30,000").length, 3, "Unit price and amount appear only once each");
        if (process.env.PDF_ARTIFACT_DIR) {
          await mkdir(process.env.PDF_ARTIFACT_DIR, { recursive: true });
          const prefix = path.join(process.env.PDF_ARTIFACT_DIR, `${kind}-${long ? "long" : "details"}`);
          await writeFile(`${prefix}.pdf`, pdf);
          const screenshots = await parser.getScreenshot({ desiredWidth: 882 });
          for (const page of screenshots.pages) await writeFile(`${prefix}-${page.pageNumber}.png`, page.data);
        }
      } finally { await parser.destroy(); }
    }
  }
});

test("synthetic invoices stay on one page when they can, and long ones repeat the header and keep the totals with lines", async () => {
  // Page counts before this layout work: 12 lines already spilled a nearly empty second page.
  const expected: Record<string, number[]> = {
    "1-line": [1], "5-lines": [1], "5-lines-notes": [1], "12-lines": [1], "12-lines-notes": [1], "12-lines-long-name": [1], "20-lines": [1],
    "20-lines-notes": [1, 2], "20-lines-details": [1, 2], "40-lines": [2], "40-lines-notes": [2, 3],
  };
  for (const scenario of invoicePdfCases()) {
    const data = invoicePdfFixture(scenario.count, scenario);
    const result = await buildIssuedInvoicePdf(data.issuedInvoices[0], data);
    assert.ok(expected[scenario.name].includes(result.pages), `${scenario.name}: ${result.pages} pages`);
    assert.ok(result.applied.fontScale >= 0.8 - 1e-9, "body text never drops below 8pt");
    const parser = new PDFParse({ data: result.pdf });
    try {
      const parsed = await parser.getText();
      assert.equal(parsed.total, result.pages);
      for (let i = 1; i <= scenario.count; i++) assert.equal(parsed.text.split(`明細${i} `).length, 2, `${scenario.name}: 明細${i} appears once`);
      const last = parsed.pages.at(-1)!.text.replaceAll(/\s/g, "");
      assert.ok(last.includes("合計") && last.includes(invoiceIssuer.accountNumber), `${scenario.name}: totals and bank on the last page`);
      assert.equal(parsed.text.split(invoiceIssuer.accountNumber).length, 2);
      if (result.pages > 1) {
        for (const page of parsed.pages) if (page.text.includes("明細")) assert.ok(page.text.includes("摘要"), `${scenario.name}: table header repeated on page ${page.num}`);
        assert.ok(last.includes("明細"), `${scenario.name}: the last page carries lines, not only the totals`);
      }
      if (process.env.PDF_ARTIFACT_DIR) {
        await mkdir(process.env.PDF_ARTIFACT_DIR, { recursive: true });
        await writeFile(path.join(process.env.PDF_ARTIFACT_DIR, `invoice-${scenario.name}.pdf`), result.pdf);
      }
    } finally { await parser.destroy(); }
  }
});

test("the preview query, the saved layout and the optional blocks all go through the same plan", async () => {
  const data = invoicePdfFixture(16, { notes: true });
  const invoice = data.issuedInvoices[0];
  const chosen = { density: "relaxed", fontSize: "large", margin: "wide", fitOnePage: false, showNotes: false, showBank: false, showDueDate: false, showSeal: false } as const;
  const fromQuery = await buildIssuedInvoicePdf(invoice, data, pdfLayoutFromQuery(new URLSearchParams(pdfLayoutQuery(chosen))));
  const fromSaved = await buildIssuedInvoicePdf({ ...invoice, pdfLayout: chosen }, data);
  const standard = await buildIssuedInvoicePdf(invoice, data);
  assert.deepEqual(fromQuery.applied, fromSaved.applied);
  assert.equal(fromQuery.pages, fromSaved.pages);
  assert.equal(fromQuery.applied.fitted, false);
  assert.ok(fromQuery.pages >= 2, "relaxed and large without the automatic fit needs a second page");
  assert.equal(standard.pages, 1);
  for (const [name, pdf] of [["query", fromQuery.pdf], ["saved", fromSaved.pdf]] as const) {
    const parser = new PDFParse({ data: pdf });
    try {
      const text = (await parser.getText()).text.replaceAll(/\s/g, "");
      assert.ok(!text.includes("振込先"), `${name}: bank block hidden`);
      assert.ok(!text.includes("お支払期限"), `${name}: due date hidden`);
      assert.ok(!text.includes("備考"), `${name}: notes hidden`);
      assert.ok(text.includes("合計"));
      const image = (await parser.getScreenshot({ desiredWidth: 400 })).pages[0];
      const rendered = await loadImage(image.data);
      const canvas = createCanvas(rendered.width, rendered.height); const context = canvas.getContext("2d"); context.drawImage(rendered, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 150 && pixels[i + 1] < 120 && pixels[i + 2] < 120) red++;
      assert.equal(red, 0, `${name}: seal hidden`);
    } finally { await parser.destroy(); }
  }
  const forced = await buildIssuedInvoicePdf(invoice, data, { pageBreakBefore: 7 });
  assert.equal(forced.pages, 2);
  const parser = new PDFParse({ data: forced.pdf });
  try {
    const pages = await parser.getText();
    assert.ok(pages.pages[0].text.includes("明細6 ") && !pages.pages[0].text.includes("明細7 "));
    assert.ok(pages.pages[1].text.includes("明細7 ") && pages.pages[1].text.includes("摘要") && pages.pages[1].text.includes("合計"));
  } finally { await parser.destroy(); }
});

const pdfText = async (pdf: Buffer) => {
  const parser = new PDFParse({ data: pdf });
  try { return (await parser.getText()).text.replaceAll(/\s/g, ""); } finally { await parser.destroy(); }
};

test("the due date can be shown or hidden on its own, apart from the bank details", async () => {
  const data = invoicePdfFixture(3);
  const invoice = data.issuedInvoices[0];
  const standard = await pdfText(await createIssuedInvoicePdf(invoice, data));
  assert.ok(standard.includes("お支払期限：2026/02/28") && standard.includes(invoiceIssuer.accountNumber));
  const noDue = await pdfText(await createIssuedInvoicePdf(invoice, data, { showDueDate: false }));
  assert.ok(!noDue.includes("お支払期限") && !noDue.includes("2026/02/28"), "no due date anywhere");
  assert.ok(noDue.includes(invoiceIssuer.accountNumber) && noDue.includes("振込手数料"), "the bank details stay");
  const noBank = await pdfText(await createIssuedInvoicePdf(invoice, data, { showBank: false }));
  assert.ok(noBank.includes("お支払期限：2026/02/28"), "the due date stays");
  assert.ok(!noBank.includes(invoiceIssuer.accountNumber) && !noBank.includes("振込先") && !noBank.includes("振込手数料"));
  const estimate: Estimate = { ...invoice, estimateNumber: "EST-DUE", validUntil: "2026-03-31", status: "DRAFT", items: data.issuedInvoiceItems };
  assert.ok((await pdfText(await createEstimatePdf(estimate, data))).includes("見積有効期限：2026/03/31"));
  assert.ok(!(await pdfText(await createEstimatePdf(estimate, data, { showDueDate: false }))).includes("見積有効期限"));
});

test("every piece of wording on the PDF can be replaced or removed", async () => {
  const data = invoicePdfFixture(30, { notes: true });
  const invoice = data.issuedInvoices[0];
  invoice.notes = "連絡事項の本文";
  const estimate: Estimate = { ...invoice, estimateNumber: "EST-TEXT", validUntil: "2026-03-31", status: "DRAFT", items: data.issuedInvoiceItems };
  for (const kind of ["invoice", "estimate"] as const) {
    const fields = pdfTextFields.filter((field) => !field.only || field.only === kind);
    const defaults = pdfTextDefaults(invoice, data, kind);
    const replaced = Object.fromEntries(fields.map((field, index) => [field.key, `編集語${index}号`])) as InvoicePdfText;
    // 30 lines at the standard settings use two pages, which also prints the continuation wording.
    const layout = { fitOnePage: false };
    const build = (text: InvoicePdfText) => kind === "invoice" ? createIssuedInvoicePdf({ ...invoice, pdfText: text }, data, layout) : createEstimatePdf({ ...estimate, pdfText: text }, data, layout);
    const printed = await pdfText(await build(replaced));
    for (const [index, field] of fields.entries()) assert.ok(printed.includes(`編集語${index}号`), `${kind}: ${field.label} is printed`);
    for (const value of [defaults.issuerName, defaults.issuerAddress, defaults.greeting, "御中", "税抜計", "摘要"]) assert.ok(!printed.includes(value.replaceAll(/\s/g, "")), `${kind}: standard wording "${value}" is gone`);
    assert.ok(printed.includes(kind === "invoice" ? "TRI-2026-SAMPLE" : "EST-TEXT"), "the number itself comes from the document");
    assert.ok(printed.includes("511,500"), "amounts are unaffected");
    const blank = Object.fromEntries(fields.map((field) => [field.key, ""])) as InvoicePdfText;
    const emptied = await pdfText(await build(blank));
    for (const value of [defaults.title, defaults.issuerName, defaults.issuerAddress, "御中", "税抜計", "摘要", "備考", defaults.feeNote]) assert.ok(!emptied.includes(value.replaceAll(/\s/g, "")), `${kind}: "${value}" is removed when emptied`);
    assert.ok(emptied.includes("明細1") && emptied.includes("511,500"), "lines and amounts stay when wording is removed");
  }
});

test("an unsaved draft reaches the PDF: number, dates, lines, notes and recalculated totals", async () => {
  const data = invoicePdfFixture(2);
  const invoice = data.issuedInvoices[0];
  const content = issuedPdfContent(invoice, data.issuedInvoiceItems);
  content.number = "TRI-DRAFT-9"; content.issueDate = "2026-02-01"; content.dueDate = "2026-03-15"; content.notes = "下書きの備考です";
  content.items = [{ description: "下書きの品名", details: "下書きの内訳", quantity: 3, unitPrice: 1000, taxRate: 10 }];
  const before = structuredClone(data);
  const draft = issuedInvoicePdfDraft(invoice, data, { content });
  const text = await pdfText(await createIssuedInvoicePdf(draft.invoice, draft.data));
  for (const value of ["TRI-DRAFT-9", "2026/02/01", "2026/03/15", "下書きの備考です", "下書きの品名", "下書きの内訳", "3,000", "300", "3,300"]) assert.ok(text.includes(value), value);
  for (const value of ["TRI-2026-SAMPLE", "2026SUMMER", "49,500"]) assert.ok(!text.includes(value), value);
  assert.deepEqual(data, before);
  const estimate: Estimate = { ...invoice, estimateNumber: "EST-BASE", validUntil: "2026-03-31", status: "DRAFT", items: data.issuedInvoiceItems };
  const estimateContent = { ...estimatePdfContent(estimate), number: "EST-DRAFT", dueDate: "2026-04-30", notes: "見積の下書き", items: [{ description: "見積の品名", quantity: 2, unitPrice: 5000, taxRate: 10 as const }] };
  const estimateText = await pdfText(await createEstimatePdf(estimatePdfDraft(estimate, data, { content: estimateContent }), data));
  for (const value of ["EST-DRAFT", "2026/04/30", "見積の下書き", "見積の品名", "10,000", "11,000"]) assert.ok(estimateText.includes(value), value);
  assert.ok(!estimateText.includes("EST-BASE"));
});
