import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import PDFDocument from "pdfkit";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { assertJapanData } from "../src/lib/japan-storage";
import { importGroupingFixture } from "./import-shipments-fixture";
import { timestamp } from "./document-fixture";
import type { MailDocument, ReceivedInvoice } from "../src/lib/types";

const fontPath = path.join(process.cwd(), "public", "fonts", "BIZUDMincho-Regular.ttf");
const hasJapaneseFont = existsSync(fontPath);

async function previewPdf(row: MailDocument | ReceivedInvoice, pages = 1): Promise<Buffer> {
  const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: row.originalFileName || "Synthetic import document", Author: "example.invalid" } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject);
  });
  for (let page = 1; page <= pages; page += 1) {
    if (page > 1) document.addPage();
    document.font(hasJapaneseFont ? fontPath : "Helvetica");
    document.fontSize(10).fillColor("#526275").text("SYNTHETIC PREVIEW / example.invalid", 48, 48);
    const title = "title" in row ? row.title : row.originalFileName;
    document.fontSize(20).fillColor("#18344a").text(hasJapaneseFont ? title || "サンプル輸入書類" : "Sample import document", 48, 82, { width: 499 });
    document.moveTo(48, 140).lineTo(547, 140).strokeColor("#bfcdd6").stroke();
    document.fontSize(11).fillColor("#23313b").text(hasJapaneseFont
      ? "プレビュー検証用の合成データです。実在の取引・通関書類ではありません。"
      : "Synthetic fixture only. This is not a real transaction or customs document.", 48, 164, { width: 499 });
    const content = page === 1 ? row.ocrText || "サンプル書類 原本プレビュー" : "サンプル明細（2ページ目）\nサンプル袋 200枚\nサンプル印刷物 100部\nサンプル箱 50個\nお問い合わせ sample@example.invalid";
    document.fontSize(12).text(hasJapaneseFont ? content : `Sample document: ${row.id}\nPage ${page}\nSample goods / 200 units\nsample@example.invalid`, 48, 224, { width: 499, lineGap: 8 });
    document.fontSize(10).fillColor("#526275").text(`${page} / ${pages}`, 48, 760, { width: 499, align: "right" });
  }
  document.end();
  return result;
}

function packingListPng() {
  if (hasJapaneseFont) GlobalFonts.registerFromPath(fontPath, "ImportsPreview");
  const font = hasJapaneseFont ? "ImportsPreview" : "Arial";
  const canvas = createCanvas(900, 1120), context = canvas.getContext("2d");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, 900, 1120);
  context.fillStyle = "#18344a"; context.fillRect(0, 0, 900, 150);
  context.fillStyle = "#ffffff"; context.font = `32px ${font}`; context.fillText("PACKING LIST / SAMPLE", 48, 88);
  context.fillStyle = "#23313b"; context.font = `24px ${font}`;
  const lines = hasJapaneseFont ? ["サンプル梱包明細（画像原本）", "サンプル袋 200枚 / 4 cartons", "サンプル印刷物 100部 / 2 cartons", "サンプル箱 50個 / 1 carton"]
    : ["Synthetic packing list", "Sample bags: 200 / 4 cartons", "Sample prints: 100 / 2 cartons", "Sample boxes: 50 / 1 carton"];
  lines.forEach((line, index) => {
    const y = 230 + index * 125;
    context.fillText(line, 48, y); context.fillStyle = "#dce4e9"; context.fillRect(48, y + 30, 804, 2); context.fillStyle = "#23313b";
  });
  context.font = `20px ${font}`; context.fillText("Synthetic preview only / sample@example.invalid", 48, 1020);
  return canvas.toBuffer("image/png");
}

// Writes a synthetic data folder for looking at the import board locally. Nothing in it is real.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-imports-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = importGroupingFixture();
  data.mailDocuments = data.mailDocuments.filter((row) => row.company !== "CHINA");
  const passwordHash = hashSync("local-banking-test-only", 10);
  data.users = [
    { id: "admin", name: "合成検証管理者", email: "admin@example.invalid", passwordHash, role: "ADMIN", createdAt: timestamp, updatedAt: timestamp },
    { id: "manager", name: "合成主任", email: "chief@example.invalid", passwordHash, role: "CHIEF_DESIGNER", createdAt: timestamp, updatedAt: timestamp },
  ];
  data.clients.push({ id: "sample-order-client", company: "JAPAN", companyName: "サンプル受注先", email: "client@example.invalid", createdAt: timestamp, updatedAt: timestamp });
  const shipment = data.importShipments!.find((row) => row.id === "ship-1")!;
  shipment.orders = [
    { id: "sample-order-1", clientId: "sample-order-client", orderNumber: "SAMPLE-001", orderedAt: "2026-10-01", requestedDeliveryDate: "2026-11-20", items: [
      { id: "sample-item-1", name: "サンプル袋", quantity: 200, unit: "枚", kind: "BAG" },
      { id: "sample-item-2", name: "サンプル印刷物", quantity: 100, unit: "部", kind: "PRINTED", requestedDeliveryDate: "2026-11-18" },
    ] },
    { id: "sample-order-2", orderNumber: "SAMPLE-002", orderedAt: "2026-10-02", requestedDeliveryDate: "2026-11-25", items: [
      { id: "sample-item-3", name: "サンプル箱", quantity: 50, unit: "個", kind: "BOX" },
    ] },
  ];
  shipment.stages = [
    { key: "ORDER_RECEIVED", label: "発注受付", startedAt: "2026-10-01", completedAt: "2026-10-02" },
    { key: "PRODUCTION", label: "製作", startedAt: "2026-10-03", plannedAt: "2026-11-10" },
    { key: "SHIPMENT", label: "出荷", plannedAt: "2026-11-12" }, { key: "CUSTOMS", label: "通関", plannedAt: "2026-11-16" },
    { key: "DELIVERY", label: "納品" },
  ];
  shipment.fieldSources = { brokerFee: "MANUAL", permitNumber: "DOCUMENT", permitDate: "DOCUMENT", dutyAmount: "DOCUMENT" };
  // Make re-read confirmation show both manual and document-derived changes.
  data.receivedInvoices.find((row) => row.id === "broker-1")!.ocrText += "\n通関手数料 18,000円";
  data.mailDocuments.find((row) => row.id === "permit-1")!.ocrText += "\n許可日 2026-10-06\n入港日 2026-10-03";
  const packing: MailDocument = { ...data.mailDocuments.find((row) => row.id === "packing-1")!, id: "packing-image", title: "サンプル梱包明細（画像）",
    fileUrl: "/api/files/packing-image.png", originalFileName: "サンプル梱包明細.png", mimeType: "image/png", importDocumentKind: "PACKING_LIST" };
  const missing: MailDocument = { ...data.mailDocuments.find((row) => row.id === "awb-1")!, id: "missing-original", title: "サンプル原本なし",
    fileUrl: "/api/files/missing-original.pdf", originalFileName: "サンプル原本なし.pdf", importShipmentId: "ship-2", importDocumentKind: "OTHER" };
  data.mailDocuments.push(packing, missing);
  // ship-old remains a legacy row; ship-2 still lacks several checklist kinds.
  assertJapanData(data);
  for (const row of [...data.mailDocuments, ...data.receivedInvoices]) {
    if (!row.fileUrl || row.id === missing.id) continue;
    const buffer = row.id === packing.id ? packingListPng() : await previewPdf(row, row.id === "permit-1" ? 2 : 1);
    await writeFile(path.join(root, "uploads", path.basename(row.fileUrl)), buffer);
  }
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
