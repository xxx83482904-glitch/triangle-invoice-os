import path from "node:path";
import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { runtimeDataDir } from "@/lib/runtime-paths";
import type { AppData, Estimate, InvoicePdfLayout, IssuedInvoice } from "@/lib/types";
import { documentTaxBreakdown } from "@/lib/document-items";
import { planPdfPages, resolvePdfLayout, type AppliedPdfLayout, type PdfPlan, type PdfPlanInput } from "@/lib/invoice-pdf-layout";
import { pdfTextDefaults, resolvePdfText, type PdfTextValues } from "@/lib/pdf-document-text";
import type { PdfDocumentKind } from "@/lib/pdf-document-values";

export { invoiceIssuer } from "@/lib/pdf-document-text";

const amount = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const date = (value: string) => value ? value.replaceAll("-", "/") : "未設定";

export type RenderedPdf = { pdf: Buffer; pages: number; applied: AppliedPdfLayout };

// `layout` overrides the layout saved on the document; the preview and the download both pass the same one.
export function buildIssuedInvoicePdf(invoice: IssuedInvoice, data: AppData, layout?: InvoicePdfLayout | null) {
  return createBusinessDocumentPdf(invoice, data, resolvePdfLayout(layout ?? invoice.pdfLayout));
}

export function createIssuedInvoicePdf(invoice: IssuedInvoice, data: AppData, layout?: InvoicePdfLayout | null) {
  return buildIssuedInvoicePdf(invoice, data, layout).then((result) => result.pdf);
}

export function buildEstimatePdf(estimate: Estimate, data: AppData, layout?: InvoicePdfLayout | null) {
  const invoice: IssuedInvoice = { ...estimate, invoiceNumber: estimate.estimateNumber, dueDate: estimate.validUntil, transactionDate: estimate.issueDate, status: "DRAFT" };
  const items = estimate.items.map((item) => ({ ...item, invoiceId: estimate.id, createdAt: estimate.createdAt, updatedAt: estimate.updatedAt }));
  return createBusinessDocumentPdf(invoice, { ...data, issuedInvoiceItems: items }, resolvePdfLayout(layout ?? estimate.pdfLayout), estimate.validUntil);
}

export function createEstimatePdf(estimate: Estimate, data: AppData, layout?: InvoicePdfLayout | null) {
  return buildEstimatePdf(estimate, data, layout).then((result) => result.pdf);
}

// The totals rows exactly as they appear under the table; shared so the plan measures what gets drawn.
function documentTotalsRows(invoice: Pick<IssuedInvoice, "subtotal" | "taxTotal" | "total" | "taxRounding">, items: AppData["issuedInvoiceItems"], t: PdfTextValues): [string, string][] {
  const taxes = new Map(documentTaxBreakdown(items).map((group) => [group.taxRate, group]));
  // Preserve historical PDF amounts until the user explicitly edits that document.
  if (invoice.taxRounding !== "PER_RATE") {
    for (const group of taxes.values()) group.tax = 0;
    for (const item of items) {
      if (item.taxRate > 0) taxes.get(item.taxRate)!.tax += Math.round(item.amount * item.taxRate / 100);
    }
  }
  const totals: [string, number][] = [[t.subtotalLabel, invoice.subtotal]];
  if (taxes.size === 1 && (taxes.has(10) || taxes.has(8))) totals.push([`${t.taxLabel} (${[...taxes.keys()][0]}%)`, invoice.taxTotal]);
  else {
    totals.push([t.taxLabel, invoice.taxTotal]);
    for (const [rate, group] of taxes) {
      const label = rate === 10 || rate === 8 ? `${rate}%対象 ${amount.format(group.subtotal)} / ${t.taxLabel}` : `${rate === 0 ? "非課税" : "対象外"}対象額`;
      totals.push([label, rate === 10 || rate === 8 ? group.tax : group.subtotal]);
    }
  }
  totals.push([t.totalLabel, invoice.total]);
  return totals.map(([label, value]) => [label, amount.format(value)]);
}

function documentPlanInput(invoice: IssuedInvoice, data: AppData, kind: PdfDocumentKind, t: PdfTextValues): PdfPlanInput {
  const items = data.issuedInvoiceItems.filter((i) => i.invoiceId === invoice.id);
  return {
    kind,
    recipient: t.recipient,
    subject: t.subject,
    items: items.map((item) => ({ description: item.description, details: item.details, quantity: amount.format(item.quantity), unitPrice: amount.format(item.unitPrice), amount: amount.format(item.amount) })),
    totals: documentTotalsRows(invoice, items, t),
    notes: invoice.notes,
  };
}

function createBusinessDocumentPdf(invoice: IssuedInvoice, data: AppData, layout: ReturnType<typeof resolvePdfLayout>, validUntil?: string) {
  const estimate = validUntil !== undefined;
  const kind: PdfDocumentKind = estimate ? "estimate" : "invoice";
  const t = resolvePdfText(invoice.pdfText, pdfTextDefaults(invoice, data, kind));
  return new Promise<RenderedPdf>((resolve, reject) => {
    const font = path.join(process.cwd(), "public", "fonts", "BIZUDMincho-Regular.ttf");
    // Positions are absolute, so pdfkit's own margins only need to stay out of the way of the footer.
    const doc = new PDFDocument({ size: "A4", margin: 12, bufferPages: true, font, info: { Title: `${t.title} ${invoice.invoiceNumber}`, Author: t.issuerName } });
    const chunks: Buffer[] = [];
    let plan: PdfPlan | undefined;
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve({ pdf: Buffer.concat(chunks), pages: plan?.pages.length ?? 0, applied: plan!.applied }));
    doc.on("error", reject);
    try {
      // A redistributable TTF is bundled so Docker and desktop generate identical Japanese PDFs.
      doc.font(font);
      plan = planPdfPages(documentPlanInput(invoice, data, kind, t), layout, (value, size) => doc.fontSize(size).widthOfString(value));
      const m = plan.metrics, c = m.columns, { left, right, width } = m;
      const line = (y: number, x = left, end = right) => doc.lineWidth(0.7).strokeColor("#777777").moveTo(x, y).lineTo(end, y).stroke();
      const text = (value: string, x: number, y: number, w: number, size: number, align: "left" | "right" | "center" = "left", color = "#111111") => {
        doc.fillColor(color).fontSize(size).text(value, x, y, { width: w, align, lineBreak: false });
      };
      // Any wording can be edited, so anything that could outgrow its place shrinks to fit; empty wording draws nothing.
      const fitted = (value: string, x: number, y: number, w: number, size: number, align: "left" | "right" | "center" = "left") => {
        if (!value) return;
        while (size > 6 && doc.fontSize(size).widthOfString(value) > w) size -= 0.25;
        text(value, x, y, w, size, align);
      };
      const tableHeader = (y: number) => {
        const size = m.s(9), offset = Math.max(0, (m.tableHeaderH - m.lh(9)) / 2);
        fitted(t.descriptionHeader, c.descX, y + offset, c.descWidth, size, "center");
        fitted(t.quantityHeader, c.qtyRight - c.qtyWidth, y + offset, c.qtyWidth, size, "center");
        fitted(t.unitPriceHeader, c.unitRight - c.unitWidth, y + offset, c.unitWidth, size, "center");
        fitted(t.amountHeader, c.amountRight - c.amountWidth, y + offset, c.amountWidth, size, "right");
        line(y + m.tableHeaderH);
        return y + m.tableHeaderH;
      };

      // Page 1 header: title and recipient on the left, issuer, seal and amount on the right.
      const h = plan.header;
      fitted(t.title, left + 4, m.h(42), 200, 18);
      fitted([t.numberLabel, invoice.invoiceNumber].filter(Boolean).join(" "), right - 233, m.h(78), 233, m.s(8), "right");
      fitted(t.dateLabel, left + 2, m.h(103), 80, m.s(9));
      text(date(invoice.issueDate), left + 100, m.h(103), 104, m.s(10), "right");
      line(m.h(117), left, left + 204);
      h.recipientLines.forEach((v, i) => text(v, left + 2, h.recipientY + i * m.lh(11), 202, m.s(11)));
      line(h.recipientBottom, left, left + 204);
      const issuerLines = [t.issuerName, t.issuerPostalCode, t.issuerAddress, t.issuerBuilding, t.issuerPhone, t.issuerRegistration];
      const issuerStep = m.lh(9.5) + 0.7;
      issuerLines.filter(Boolean).forEach((v, i) => fitted(v, right - 215, m.h(102) + i * issuerStep, 145, v === t.issuerName ? m.s(11) : m.s(9.5)));
      const seal = process.env.INVOICE_SEAL_PATH || path.join(runtimeDataDir(), "company-seal.png");
      if (layout.showSeal && existsSync(seal)) doc.image(seal, right - 62, m.h(102), { fit: [62, 66] });
      fitted(t.greeting, right - 215, m.h(191), 215, m.s(9.5));
      doc.lineWidth(1).strokeColor("#777777").rect(right - 218, m.h(208), 218, 36).stroke();
      fitted(t.amountLabel, right - 211, m.h(208) + 12, 65, m.s(9));
      fitted(`¥${amount.format(invoice.total)}`, right - 143, m.h(208) + 7, 133, m.s(16), "right");
      fitted(t.subjectLabel, left + 2, h.subjectY, 46, m.s(9));
      h.subjectLines.forEach((v, i) => text(v, left + 50, h.subjectY + i * m.lh(9), 276, m.s(9)));
      line(h.subjectRule, left, left + 304);

      plan.pages.forEach((page, index) => {
        if (index > 0) {
          doc.addPage();
          fitted(`${t.title}${t.continuedLabel}`, left, m.h(16), 220, 16);
          fitted(invoice.invoiceNumber, right - 233, m.h(22), 233, m.s(9), "right");
        }
        let y = page.tableTop;
        if (page.tableHeader) y = tableHeader(y);
        for (const block of page.blocks) {
          if (block.kind === "item") {
            let offset = m.rowPad + 1;
            for (const entry of block.lines) {
              text(entry.text, left + entry.indent, y + offset, c.descWidth - (entry.indent - 3), entry.size, "left", entry.muted ? "#444444" : "#111111");
              offset += entry.height;
            }
            if (block.first) {
              fitted(block.quantity, c.qtyRight - c.qtyWidth, y + m.rowPad + 1, c.qtyWidth, m.s(10), "right");
              fitted(block.unitPrice, c.unitRight - c.unitWidth, y + m.rowPad + 1, c.unitWidth, m.s(10), "right");
              fitted(block.amount, c.amountRight - c.amountWidth, y + m.rowPad + 1, c.amountWidth, m.s(10), "right");
            }
            y += block.height; line(y);
          } else if (block.kind === "blank") {
            y += block.height; line(y);
          } else if (block.kind === "totals") {
            const offset = Math.max(1, (m.totalsRowH - m.lh(10)) / 2 + 1);
            for (const [label, value] of block.rows) {
              fitted(label, left + 3, y + offset, Math.round(width * 0.73), m.s(10));
              fitted(value, c.amountRight - Math.round(width * 0.21), y + offset, Math.round(width * 0.21), m.s(11), "right");
              y += m.totalsRowH; line(y);
            }
          } else if (block.kind === "notes") {
            if (block.title) { y += m.notesGap; fitted(t.notesLabel, left, y, width, m.s(9)); y += m.notesTitleH; }
            for (const entry of block.lines) { text(entry.text, left, y, width, entry.size); y += entry.height; }
          } else if (block.kind === "bank") {
            // Payment details sit at the foot of the page when there is room, as on a printed form.
            const body = block.height - m.bankGap, f = m.font;
            const bankY = Math.max(y + m.bankGap, m.contentBottom - body);
            const boxX = right - Math.round(331 * Math.min(1, width / 531)), boxW = right - boxX;
            let cursor = bankY;
            if (block.box) {
              doc.lineWidth(1).strokeColor("#777777").rect(boxX, bankY, boxW, 62 * f).stroke();
              fitted(t.bankLabel, boxX + 8, bankY + 7 * f, 80, m.s(9));
              fitted(t.bankLine, boxX + 8, bankY + 23 * f, boxW - 16, m.s(9.5));
              fitted(t.accountName, boxX + 8, bankY + 42 * f, boxW - 16, m.s(9.5));
              cursor = bankY + 69 * f;
            }
            if (block.due) { fitted(`${t.dueLabel}${date(invoice.dueDate)}`, boxX, cursor, boxW, m.s(8.5)); cursor += 14 * f; }
            if (block.box) fitted(t.feeNote, boxX, cursor, boxW, m.s(8));
            y = bankY + body;
          } else if (block.kind === "validity") {
            fitted(`${t.validityLabel}${date(validUntil!)}`, left, y + 28 * m.font, width, m.s(10));
            y += block.height;
          }
        }
      });
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        text(`${i + 1} / ${pages.count}`, right - 83, m.footerY, 83, 8, "right");
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
