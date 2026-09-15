import test, { before, after } from "node:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { PDFParse } from "pdf-parse";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createEstimatePdf, createIssuedInvoicePdf, invoiceIssuer } from "../src/lib/issued-invoice-pdf";
import { invoicePdfFixture } from "./invoice-pdf-fixture";
import type { Estimate } from "../src/lib/types";

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
  const parser = new PDFParse({ data: await createIssuedInvoicePdf(data.issuedInvoices[0], data) });
  try {
    const result = await parser.getText();
    assert.equal(result.total, 1);
    const text = result.text.replaceAll(/\s/g, "");
    for (const value of [...Object.values(invoiceIssuer), "49,500", "45,000", "4,500", "30,000", "15,000", "株式会社サンプル御中", "2026/02/28"]) {
      assert.ok(text.includes(value.replaceAll(/\s/g, "")), value);
    }
    assert.ok(!text.includes("HiDesign")); assert.ok(!text.includes("T0000000000000"));
    assert.ok(!text.includes("三角銀行"));
    assert.ok(text.indexOf(invoiceIssuer.name) < text.indexOf(invoiceIssuer.address), "Issuer name must be above the address");
    const screenshot = await parser.getScreenshot({ desiredWidth: 882 });
    assert.equal(Math.round(screenshot.pages[0].width), 882);
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
          assert.ok(result.total >= 3);
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
