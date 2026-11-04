import { fixture, timestamp } from "./document-fixture";

export type InvoicePdfScenario = { name: string; count: number; notes?: boolean; longName?: boolean; details?: boolean };

// Synthetic invoices that cover the page-count rules: short ones must stay on one page, long ones must
// repeat the table header and never leave the totals alone on the last page.
export function invoicePdfCases(): InvoicePdfScenario[] {
  return [
    { name: "1-line", count: 1 },
    { name: "5-lines", count: 5 },
    { name: "5-lines-notes", count: 5, notes: true },
    { name: "12-lines", count: 12 },
    { name: "12-lines-notes", count: 12, notes: true },
    { name: "12-lines-long-name", count: 12, longName: true },
    { name: "20-lines", count: 20 },
    { name: "20-lines-notes", count: 20, notes: true },
    { name: "20-lines-details", count: 20, details: true },
    { name: "40-lines", count: 40 },
    { name: "40-lines-notes", count: 40, notes: true },
  ];
}

// Without a scenario the legacy shape is kept: two named lines, or numbered lines with one very long one.
export function invoicePdfFixture(count = 2, scenario?: Omit<InvoicePdfScenario, "name" | "count">) {
  const data = fixture();
  const invoice = data.issuedInvoices[0];
  delete invoice.fileUrl; delete invoice.originalFileName;
  invoice.invoiceNumber = "TRI-2026-SAMPLE";
  invoice.status = "ISSUED"; invoice.needsReview = false;
  invoice.issueDate = "2026-01-28"; invoice.dueDate = "2026-02-28";
  data.clients[0].companyName = "株式会社サンプル";
  data.projects[0].name = "THE PERFUME OIL FACTORY イラスト製作費";
  const names = ["ロゴデザイン", "名刺デザイン", "封筒デザイン", "Webバナー制作", "商品パッケージ案", "写真レタッチ", "キービジュアル制作", "イラスト制作"];
  data.issuedInvoiceItems = Array.from({ length: count }, (_, i) => ({
    id: `line-${i}`, invoiceId: invoice.id,
    description: !scenario ? count === 2 ? ["2026SUMMER イメージイラストレーション", "2026SUMMER 動画カラーVer."][i] : `明細${i + 1} ${"長い明細の折り返し確認 ".repeat(i === 1 ? 100 : 4)}`
      : scenario.longName && i % 4 === 1 ? `明細${i + 1} ${"長い品名の折り返し確認 ".repeat(6)}`
      : `明細${i + 1} ${names[i % names.length]}`,
    details: scenario?.details && i % 3 === 0 ? "初回提案・修正2回\n納品データを含む" : undefined,
    quantity: 1, unitPrice: i === 0 ? 30000 : 15000, amount: i === 0 ? 30000 : 15000,
    taxRate: 10 as const, createdAt: timestamp, updatedAt: timestamp,
  }));
  if (scenario?.notes) invoice.notes = "お振込みの際は請求書番号をご記入ください。\n納品物の著作権は入金確認後に譲渡されます。\nご不明点は担当までご連絡ください。";
  invoice.subtotal = data.issuedInvoiceItems.reduce((sum, item) => sum + item.amount, 0);
  invoice.taxTotal = invoice.subtotal / 10; invoice.total = invoice.subtotal + invoice.taxTotal;
  return data;
}
