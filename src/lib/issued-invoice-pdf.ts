import path from "node:path";
import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { runtimeDataDir } from "@/lib/runtime-paths";
import type { AppData, Estimate, IssuedInvoice } from "@/lib/types";

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

export function createIssuedInvoicePdf(invoice: IssuedInvoice, data: AppData) {
  return createBusinessDocumentPdf(invoice, data);
}

export function createEstimatePdf(estimate: Estimate, data: AppData) {
  const invoice: IssuedInvoice = { ...estimate, invoiceNumber: estimate.estimateNumber, dueDate: estimate.validUntil, transactionDate: estimate.issueDate, status: "DRAFT" };
  return createBusinessDocumentPdf(invoice, { ...data, issuedInvoiceItems: estimate.items.map((item) => ({ ...item, invoiceId: estimate.id, createdAt: estimate.createdAt, updatedAt: estimate.updatedAt })) }, estimate.validUntil);
}

function createBusinessDocumentPdf(invoice: IssuedInvoice, data: AppData, validUntil?: string) {
  const title = validUntil !== undefined ? "見積書" : "請求書";
  return new Promise<Buffer>((resolve, reject) => {
    const font = path.join(process.cwd(), "public", "fonts", "BIZUDMincho-Regular.ttf");
    const doc = new PDFDocument({ size: "A4", margin: 32, bufferPages: true, font, info: { Title: `${title} ${invoice.invoiceNumber}`, Author: invoiceIssuer.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      // A redistributable TTF is bundled so Docker and desktop generate identical Japanese PDFs.
      doc.font(font);
      const left = 32, right = 563, width = right - left;
      const client = data.clients.find((c) => c.id === invoice.clientId);
      const project = data.projects.find((p) => p.id === invoice.projectId);
      const items = data.issuedInvoiceItems.filter((i) => i.invoiceId === invoice.id);
      let page = 1;
      const line = (y: number, x = left, end = right) => doc.lineWidth(0.7).strokeColor("#777777").moveTo(x, y).lineTo(end, y).stroke();
      const text = (value: string, x: number, y: number, w: number, size = 10, align: "left" | "right" | "center" = "left") => {
        doc.fillColor("#111111").fontSize(size).text(value, x, y, { width: w, align, lineBreak: false });
      };
      const wrap = (value: string, w: number, size = 10) => {
        doc.fontSize(size);
        const lines: string[] = [];
        for (const paragraph of value.split(/\r?\n/)) {
          let current = "";
          for (const char of paragraph) {
            if (current && doc.widthOfString(current + char) > w) { lines.push(current); current = ""; }
            current += char;
          }
          lines.push(current);
        }
        return lines;
      };
      const fitted = (value: string, x: number, y: number, w: number, size: number, align: "left" | "right" = "left") => {
        while (size > 6 && doc.fontSize(size).widthOfString(value) > w) size -= 0.25;
        text(value, x, y, w, size, align);
      };
      const nextPage = () => {
        doc.addPage(); page++;
        text(`${title}（続き）`, left, 48, 220, 16);
        fitted(invoice.invoiceNumber, 330, 54, 233, 9, "right");
      };
      text(title, left + 4, 74, 200, 18);
      fitted(`${title}番号 ${invoice.invoiceNumber}`, 330, 110, 233, 8, "right");
      text("DATE.", left + 2, 135, 80, 9);
      text(date(invoice.issueDate), 132, 135, 104, 10, "right");
      line(149, left, 236);
      const recipient = `${client?.companyName || "請求先未設定"} 御中`;
      const recipientLines = wrap(recipient, 202, 11);
      recipientLines.forEach((v, i) => text(v, left + 2, 182 + i * 15, 202, 11));
      const recipientBottom = 182 + recipientLines.length * 15 + 5;
      line(recipientBottom, left, 236);

      const issuerLines = [invoiceIssuer.name, `〒${invoiceIssuer.postalCode}`, invoiceIssuer.address, invoiceIssuer.building, `T.${invoiceIssuer.phone}`, `登録番号 ${invoiceIssuer.registrationNumber}`];
      issuerLines.forEach((v, i) => fitted(v, 348, 134 + i * 14, 145, i === 0 ? 11 : 9.5));
      const seal = process.env.INVOICE_SEAL_PATH || path.join(runtimeDataDir(), "company-seal.png");
      if (existsSync(seal)) doc.image(seal, 501, 134, { fit: [62, 66] });
      text(validUntil !== undefined ? "下記のとおりお見積もり申し上げます。" : "下記のとおりご請求申し上げます。", 348, 223, 215, 9.5);
      doc.lineWidth(1).strokeColor("#777777").rect(345, 240, 218, 36).stroke();
      text(validUntil !== undefined ? "見積金額" : "合計金額", 352, 252, 65, 9);
      fitted(`¥${amount.format(invoice.total)}`, 420, 247, 133, 16, "right");
      const subjectY = Math.max(263, recipientBottom + 18);
      const subjects = wrap(project?.name || "", 276, 9);
      text("件名", left + 2, subjectY, 40, 9);
      subjects.forEach((v, i) => text(v, left + 50, subjectY + i * 13, 276, 9));
      line(subjectY + subjects.length * 13 + 4, left, 336);
      let y = Math.max(307, subjectY + subjects.length * 13 + 24);
      if (y > 580) { nextPage(); y = 100; }
      const tableHeader = () => {
        text("摘要", left + 3, y, 308, 9, "center");
        text("数量", 348, y, 43, 9, "center");
        text("単価", 400, y, 70, 9, "center");
        text("金額", 481, y, 80, 9, "right");
        y += 16; line(y);
      };
      tableHeader();
      for (const item of items) {
        const lines = wrap(item.description, 305, 10);
        let first = true;
        while (lines.length) {
          if (y + 22 > 662) { nextPage(); y = 100; tableHeader(); }
          const capacity = Math.max(1, Math.floor((662 - y - 8) / 14));
          const part = lines.splice(0, capacity);
          part.forEach((v, i) => text(v, left + 3, y + 5 + i * 14, 305));
          if (first) {
            fitted(amount.format(item.quantity), 344, y + 5, 47, 10, "right");
            fitted(amount.format(item.unitPrice), 398, y + 5, 72, 10, "right");
            fitted(amount.format(item.amount), 480, y + 5, 81, 10, "right");
            first = false;
          }
          y += Math.max(20, part.length * 14 + 8); line(y);
        }
      }
      if (page === 1) while (y < 493) { y += 20; line(y); }

      const taxes = new Map<number, { subtotal: number; tax: number }>();
      for (const item of items) {
        const group = taxes.get(item.taxRate) || { subtotal: 0, tax: 0 };
        group.subtotal += item.amount;
        if (item.taxRate === 10 || item.taxRate === 8) group.tax += Math.round(item.amount * item.taxRate / 100);
        taxes.set(item.taxRate, group);
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
      if (y + totals.length * 20 > 602) { nextPage(); y = 140; }
      for (const [label, value] of totals) {
        text(label, left + 3, y + 5, 390, 10);
        fitted(amount.format(value), 449, y + 5, 112, 11, "right");
        y += 20; line(y);
      }
      if (invoice.notes) {
        y += 18;
        text("備考", left, y, width, 9); y += 16;
        for (const v of wrap(invoice.notes, width, 9)) {
          if (y > 735) { nextPage(); y = 100; }
          text(v, left, y, width, 9); y += 13;
        }
      }
      if (validUntil !== undefined) {
        if (y + 40 > 774) { nextPage(); y = 100; }
        text(`見積有効期限：${date(validUntil)}`, left, y + 28, width, 10);
      } else {
      if (y + 146 > 774) { nextPage(); y = 140; }
      const bankY = Math.max(630, y + 28);
      doc.lineWidth(1).strokeColor("#777777").rect(232, bankY, 331, 62).stroke();
      text("振込先", 240, bankY + 7, 80, 9);
      text(`${invoiceIssuer.bank}　${invoiceIssuer.branch}　${invoiceIssuer.accountType} ${invoiceIssuer.accountNumber}`, 240, bankY + 23, 315, 9.5);
      text(invoiceIssuer.accountName, 240, bankY + 42, 315, 9.5);
      text(`お支払期限：${date(invoice.dueDate)}`, 232, bankY + 69, 331, 8.5);
      text("振込手数料は貴社にてご負担をお願いいたします。", 232, bankY + 83, 331, 8);
      }
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        text(`${i + 1} / ${pages.count}`, 480, 788, 83, 8, "right");
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
