import fs from "node:fs";
import PDFDocument from "pdfkit";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { formatDate, yen } from "@/lib/format";
import { readData, taxLabel } from "@/lib/store";

function findJapaneseFont() {
  const candidates = [
    "C:\\Windows\\Fonts\\meiryo.ttc",
    "C:\\Windows\\Fonts\\YuGothM.ttc",
    "C:\\Windows\\Fonts\\msgothic.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createPdfBuffer(
  invoice: ReturnType<typeof readData>["issuedInvoices"][number],
  data: ReturnType<typeof readData>,
) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const font = findJapaneseFont();
    if (font) doc.font(font);

    const client = data.clients.find((item) => item.id === invoice.clientId);
    const project = data.projects.find((item) => item.id === invoice.projectId);
    const items = data.issuedInvoiceItems.filter((item) => item.invoiceId === invoice.id);
    const taxGroups = items.reduce<Record<string, { subtotal: number; tax: number }>>((acc, item) => {
      const key = taxLabel(item.taxRate);
      acc[key] ??= { subtotal: 0, tax: 0 };
      acc[key].subtotal += item.amount;
      if (item.taxRate === 10 || item.taxRate === 8) acc[key].tax += Math.round(item.amount * (item.taxRate / 100));
      return acc;
    }, {});

    doc.fontSize(22).text("請求書", { align: "center" });
    doc.moveDown(0.6);
    doc.fontSize(10).text(`請求書番号: ${invoice.invoiceNumber}`, { align: "right" });
    doc.text(`発行日: ${formatDate(invoice.issueDate)}`, { align: "right" });
    doc.text(`支払期限: ${formatDate(invoice.dueDate)}`, { align: "right" });
    doc.moveDown(1.2);

    doc.fontSize(12).text(`${client?.companyName ?? ""} 御中`);
    if (client?.contactName) doc.text(`${client.contactName} 様`);
    doc.moveDown(0.8);
    doc.fontSize(10).text(`案件名: ${project?.name ?? ""}`);
    doc.text(`取引年月日: ${formatDate(invoice.transactionDate)}`);
    doc.moveDown(1);

    doc.fontSize(16).text(`ご請求金額 ${yen.format(invoice.total)}`, { underline: true });
    doc.moveDown(1);

    doc.fontSize(10).text("株式会社トライアングル.JP", 360, 190);
    doc.text("〒150-0001 東京都渋谷区神宮前1-1-1", 360);
    doc.text("登録番号: T0000000000000", 360);
    doc.text("振込先: 三角銀行 青山支店 普通 0000000", 360);
    doc.text("口座名義: カ）トライアングルドットジェイピー", 360);

    const top = 270;
    const cols = [48, 280, 335, 405, 465];
    doc.rect(48, top, 500, 24).fill("#f3f4f6").fillColor("#111827");
    doc.text("内容", cols[0] + 8, top + 7);
    doc.text("数量", cols[1], top + 7);
    doc.text("単価", cols[2], top + 7);
    doc.text("税率", cols[3], top + 7);
    doc.text("小計", cols[4], top + 7);

    let y = top + 32;
    for (const item of items) {
      doc.fillColor("#111827").text(item.description, cols[0] + 8, y, { width: 220 });
      doc.text(String(item.quantity), cols[1], y);
      doc.text(yen.format(item.unitPrice), cols[2], y);
      doc.text(taxLabel(item.taxRate), cols[3], y);
      doc.text(yen.format(item.amount), cols[4], y);
      y += 28;
    }

    y += 16;
    doc.text(`税抜合計: ${yen.format(invoice.subtotal)}`, 380, y);
    doc.text(`消費税: ${yen.format(invoice.taxTotal)}`, 380, y + 18);
    doc.fontSize(12).text(`税込合計: ${yen.format(invoice.total)}`, 380, y + 40);

    y += 78;
    doc.fontSize(10).text("税率ごとの区分", 48, y);
    y += 18;
    for (const [label, group] of Object.entries(taxGroups)) {
      doc.text(`${label}: 対象額 ${yen.format(group.subtotal)} / 消費税 ${yen.format(group.tax)}`, 48, y);
      y += 16;
    }

    if (invoice.notes) {
      y += 18;
      doc.text("備考", 48, y);
      doc.text(invoice.notes, 48, y + 16, { width: 500 });
    }

    doc.end();
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const data = readData();
  const invoice = data.issuedInvoices.find((item) => item.id === id && !item.deletedAt);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await createPdfBuffer(invoice, data);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
    },
  });
}
