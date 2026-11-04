import path from "node:path";
import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { runtimeDataDir } from "@/lib/runtime-paths";
import type { AppData, Estimate, InvoicePdfLayout, IssuedInvoice } from "@/lib/types";
import { documentTaxBreakdown } from "@/lib/document-items";
import { planPdfPages, resolvePdfLayout, type AppliedPdfLayout, type PdfPlan, type PdfPlanInput } from "@/lib/invoice-pdf-layout";

export const invoiceIssuer = {
  name: "株式会社トライアングル.JP",
  registrationNumber: "T2010401133651",
  postalCode: "106-0031",
  address: "東京都港区西麻布3-20-9",
  building: "ハイネス麻布901",
  phone: "03-6260-9614",
  bank: "三菱UFJ銀行",
  branch: "六本木支店",
  accountType: "普通",
  accountNumber: "0683879",
  accountName: "カ)トライアングルドットジェーピー",
} as const;

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
export function documentTotalsRows(invoice: Pick<IssuedInvoice, "subtotal" | "taxTotal" | "total" | "taxRounding">, items: AppData["issuedInvoiceItems"]): [string, string][] {
  const taxes = new Map(documentTaxBreakdown(items).map((group) => [group.taxRate, group]));
  // Preserve historical PDF amounts until the user explicitly edits that document.
  if (invoice.taxRounding !== "PER_RATE") {
    for (const group of taxes.values()) group.tax = 0;
    for (const item of items) {
      if (item.taxRate > 0) taxes.get(item.taxRate)!.tax += Math.round(item.amount * item.taxRate / 100);
    }
  }
  const totals: [string, number][] = [["税抜計", invoice.subtotal]];
  if (taxes.size === 1 && (taxes.has(10) || taxes.has(8))) totals.push([`消費税 (${[...taxes.keys()][0]}%)`, invoice.taxTotal]);
  else {
    totals.push(["消費税", invoice.taxTotal]);
    for (const [rate, group] of taxes) {
      const label = rate === 10 || rate === 8 ? `${rate}%対象 ${amount.format(group.subtotal)} / 消費税` : `${rate === 0 ? "非課税" : "対象外"}対象額`;
      totals.push([label, rate === 10 || rate === 8 ? group.tax : group.subtotal]);
    }
  }
  totals.push(["合計", invoice.total]);
  return totals.map(([label, value]) => [label, amount.format(value)]);
}

export function documentPlanInput(invoice: IssuedInvoice, data: AppData, kind: "invoice" | "estimate"): PdfPlanInput {
  const client = data.clients.find((c) => c.id === invoice.clientId);
  const project = data.projects.find((p) => p.id === invoice.projectId);
  const items = data.issuedInvoiceItems.filter((i) => i.invoiceId === invoice.id);
  return {
    kind,
    recipient: `${client?.companyName || "請求先未設定"} 御中`,
    subject: [project?.name, invoice.billingLabel].filter(Boolean).join(" "),
    items: items.map((item) => ({ description: item.description, details: item.details, quantity: amount.format(item.quantity), unitPrice: amount.format(item.unitPrice), amount: amount.format(item.amount) })),
    totals: documentTotalsRows(invoice, items),
    notes: invoice.notes,
  };
}

function createBusinessDocumentPdf(invoice: IssuedInvoice, data: AppData, layout: ReturnType<typeof resolvePdfLayout>, validUntil?: string) {
  const estimate = validUntil !== undefined;
  const title = estimate ? "見積書" : "請求書";
  return new Promise<RenderedPdf>((resolve, reject) => {
    const font = path.join(process.cwd(), "public", "fonts", "BIZUDMincho-Regular.ttf");
    // Positions are absolute, so pdfkit's own margins only need to stay out of the way of the footer.
    const doc = new PDFDocument({ size: "A4", margin: 12, bufferPages: true, font, info: { Title: `${title} ${invoice.invoiceNumber}`, Author: invoiceIssuer.name } });
    const chunks: Buffer[] = [];
    let plan: PdfPlan | undefined;
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve({ pdf: Buffer.concat(chunks), pages: plan?.pages.length ?? 0, applied: plan!.applied }));
    doc.on("error", reject);
    try {
      // A redistributable TTF is bundled so Docker and desktop generate identical Japanese PDFs.
      doc.font(font);
      plan = planPdfPages(documentPlanInput(invoice, data, estimate ? "estimate" : "invoice"), layout, (value, size) => doc.fontSize(size).widthOfString(value));
      const m = plan.metrics, c = m.columns, { left, right, width } = m;
      const line = (y: number, x = left, end = right) => doc.lineWidth(0.7).strokeColor("#777777").moveTo(x, y).lineTo(end, y).stroke();
      const text = (value: string, x: number, y: number, w: number, size: number, align: "left" | "right" | "center" = "left", color = "#111111") => {
        doc.fillColor(color).fontSize(size).text(value, x, y, { width: w, align, lineBreak: false });
      };
      const fitted = (value: string, x: number, y: number, w: number, size: number, align: "left" | "right" = "left") => {
        while (size > 6 && doc.fontSize(size).widthOfString(value) > w) size -= 0.25;
        text(value, x, y, w, size, align);
      };
      const tableHeader = (y: number) => {
        const size = m.s(9), offset = Math.max(0, (m.tableHeaderH - m.lh(9)) / 2);
        text("摘要", c.descX, y + offset, c.descWidth, size, "center");
        text("数量", c.qtyRight - c.qtyWidth, y + offset, c.qtyWidth, size, "center");
        text("単価", c.unitRight - c.unitWidth, y + offset, c.unitWidth, size, "center");
        text("金額", c.amountRight - c.amountWidth, y + offset, c.amountWidth, size, "right");
        line(y + m.tableHeaderH);
        return y + m.tableHeaderH;
      };

      // Page 1 header: title and recipient on the left, issuer, seal and amount on the right.
      const h = plan.header;
      text(title, left + 4, m.h(42), 200, 18);
      fitted(`${title}番号 ${invoice.invoiceNumber}`, right - 233, m.h(78), 233, m.s(8), "right");
      text("DATE.", left + 2, m.h(103), 80, m.s(9));
      text(date(invoice.issueDate), left + 100, m.h(103), 104, m.s(10), "right");
      line(m.h(117), left, left + 204);
      h.recipientLines.forEach((v, i) => text(v, left + 2, h.recipientY + i * m.lh(11), 202, m.s(11)));
      line(h.recipientBottom, left, left + 204);
      const issuerLines = [invoiceIssuer.name, `〒${invoiceIssuer.postalCode}`, invoiceIssuer.address, invoiceIssuer.building, `T.${invoiceIssuer.phone}`, `登録番号 ${invoiceIssuer.registrationNumber}`];
      const issuerStep = m.lh(9.5) + 0.7;
      issuerLines.forEach((v, i) => fitted(v, right - 215, m.h(102) + i * issuerStep, 145, i === 0 ? m.s(11) : m.s(9.5)));
      const seal = process.env.INVOICE_SEAL_PATH || path.join(runtimeDataDir(), "company-seal.png");
      if (layout.showSeal && existsSync(seal)) doc.image(seal, right - 62, m.h(102), { fit: [62, 66] });
      text(estimate ? "下記のとおりお見積もり申し上げます。" : "下記のとおりご請求申し上げます。", right - 215, m.h(191), 215, m.s(9.5));
      doc.lineWidth(1).strokeColor("#777777").rect(right - 218, m.h(208), 218, 36).stroke();
      text(estimate ? "見積金額" : "合計金額", right - 211, m.h(208) + 12, 65, m.s(9));
      fitted(`¥${amount.format(invoice.total)}`, right - 143, m.h(208) + 7, 133, m.s(16), "right");
      text("件名", left + 2, h.subjectY, 40, m.s(9));
      h.subjectLines.forEach((v, i) => text(v, left + 50, h.subjectY + i * m.lh(9), 276, m.s(9)));
      line(h.subjectRule, left, left + 304);

      plan.pages.forEach((page, index) => {
        if (index > 0) {
          doc.addPage();
          text(`${title}（続き）`, left, m.h(16), 220, 16);
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
              text(label, left + 3, y + offset, Math.round(width * 0.73), m.s(10));
              fitted(value, c.amountRight - Math.round(width * 0.21), y + offset, Math.round(width * 0.21), m.s(11), "right");
              y += m.totalsRowH; line(y);
            }
          } else if (block.kind === "notes") {
            if (block.title) { y += m.notesGap; text("備考", left, y, width, m.s(9)); y += m.notesTitleH; }
            for (const entry of block.lines) { text(entry.text, left, y, width, entry.size); y += entry.height; }
          } else if (block.kind === "bank") {
            // Payment details sit at the foot of the page when there is room, as on a printed form.
            const bankY = Math.max(y + m.bankGap, m.contentBottom - m.bankH), f = m.font;
            const boxX = right - Math.round(331 * Math.min(1, width / 531)), boxW = right - boxX;
            doc.lineWidth(1).strokeColor("#777777").rect(boxX, bankY, boxW, 62 * f).stroke();
            text("振込先", boxX + 8, bankY + 7 * f, 80, m.s(9));
            text(`${invoiceIssuer.bank}　${invoiceIssuer.branch}　${invoiceIssuer.accountType} ${invoiceIssuer.accountNumber}`, boxX + 8, bankY + 23 * f, boxW - 16, m.s(9.5));
            text(invoiceIssuer.accountName, boxX + 8, bankY + 42 * f, boxW - 16, m.s(9.5));
            text(`お支払期限：${date(invoice.dueDate)}`, boxX, bankY + 69 * f, boxW, m.s(8.5));
            text("振込手数料は貴社にてご負担をお願いいたします。", boxX, bankY + 83 * f, boxW, m.s(8));
            y = bankY + m.bankH;
          } else if (block.kind === "validity") {
            text(`見積有効期限：${date(validUntil!)}`, left, y + 28 * m.font, width, m.s(10));
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
