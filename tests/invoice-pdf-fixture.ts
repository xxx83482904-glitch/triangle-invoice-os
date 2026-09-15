import { fixture, timestamp } from "./document-fixture";

export function invoicePdfFixture(count = 2) {
  const data = fixture();
  const invoice = data.issuedInvoices[0];
  delete invoice.fileUrl; delete invoice.originalFileName;
  invoice.invoiceNumber = "TRI-2026-SAMPLE";
  invoice.status = "ISSUED"; invoice.needsReview = false;
  invoice.issueDate = "2026-01-28"; invoice.dueDate = "2026-02-28";
  data.clients[0].companyName = "株式会社サンプル";
  data.projects[0].name = "THE PERFUME OIL FACTORY イラスト製作費";
  data.issuedInvoiceItems = Array.from({ length: count }, (_, i) => ({
    id: `line-${i}`, invoiceId: invoice.id,
    description: count === 2 ? ["2026SUMMER イメージイラストレーション", "2026SUMMER 動画カラーVer."][i] : `明細${i + 1} ${"長い明細の折り返し確認 ".repeat(i === 1 ? 100 : 4)}`,
    quantity: 1, unitPrice: i === 0 ? 30000 : 15000, amount: i === 0 ? 30000 : 15000,
    taxRate: 10 as const, createdAt: timestamp, updatedAt: timestamp,
  }));
  invoice.subtotal = data.issuedInvoiceItems.reduce((sum, item) => sum + item.amount, 0);
  invoice.taxTotal = invoice.subtotal / 10; invoice.total = invoice.subtotal + invoice.taxTotal;
  return data;
}
