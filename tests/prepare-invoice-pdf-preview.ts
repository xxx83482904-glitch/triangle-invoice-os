import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { assertJapanData } from "../src/lib/japan-storage";
import { invoicePdfFixture } from "./invoice-pdf-fixture";
import { timestamp } from "./document-fixture";
import type { Estimate, IssuedInvoice, IssuedInvoiceItem } from "../src/lib/types";

// Synthetic data for checking the PDF layout dialog in a browser: generated invoices of several
// lengths, one with a saved layout, plus an estimate. Point DATA_DIR and UPLOAD_DIR at the printed folder.
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-invoice-pdf-preview-"));
  await mkdir(path.join(root, "uploads"));
  const data = invoicePdfFixture(12, { notes: true });
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company !== "CHINA");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  const base = data.issuedInvoices[0];
  base.invoiceNumber = "TRI-2026-0012";
  const items = data.issuedInvoiceItems;
  const addInvoice = (id: string, number: string, count: number, extra: Partial<IssuedInvoice>, scenario: Parameters<typeof invoicePdfFixture>[1]) => {
    const source = invoicePdfFixture(count, scenario);
    const invoice: IssuedInvoice = { ...source.issuedInvoices[0], id, invoiceNumber: number, ...extra };
    data.issuedInvoices.push(invoice);
    items.push(...source.issuedInvoiceItems.map((item): IssuedInvoiceItem => ({ ...item, id: `${id}-${item.id}`, invoiceId: id })));
  };
  addInvoice("pdf-5", "TRI-2026-0005", 5, {}, {});
  addInvoice("pdf-20", "TRI-2026-0020", 20, { pdfLayout: { density: "compact", showSeal: false } }, { notes: true });
  addInvoice("pdf-40", "TRI-2026-0040", 40, {}, { notes: true });
  addInvoice("pdf-paid", "TRI-2026-0003", 3, {}, {});
  data.payments.push({ id: "payment-paid", type: "INCOME", issuedInvoiceId: "pdf-paid", amount: 1000, paymentDate: "2026-02-10", createdById: "admin", createdAt: timestamp, updatedAt: timestamp });
  // The imported original keeps its file and must not show the layout dialog.
  data.issuedInvoices.push({ ...base, id: "imported", invoiceNumber: "TRI-2026-0001", fileUrl: "/api/files/imported.pdf", originalFileName: "imported.pdf", mimeType: "application/pdf", notes: undefined });
  await writeFile(path.join(root, "uploads", "imported.pdf"), "%PDF-1.4\n% synthetic placeholder\n");
  const estimate: Estimate = { id: "estimate-12", estimateNumber: "EST-2026-0012", projectId: base.projectId, clientId: base.clientId, issueDate: "2026-01-20", validUntil: "2026-03-31", status: "SENT",
    items: items.filter((item) => item.invoiceId === base.id).map(({ id, description, details, quantity, unitPrice, taxRate, amount }) => ({ id: `est-${id}`, description, details, quantity, unitPrice, taxRate, amount })),
    subtotal: base.subtotal, taxTotal: base.taxTotal, total: base.total, notes: base.notes, createdById: "admin", createdAt: timestamp, updatedAt: timestamp };
  data.estimates = [estimate];
  const passwordHash = hashSync("local-pdf-preview-test-only", 10);
  data.users = [
    { id: "admin", name: "合成検証管理者", email: "admin@example.invalid", passwordHash, role: "ADMIN", createdAt: timestamp, updatedAt: timestamp },
    { id: "billing", name: "合成請求担当者", email: "billing@example.invalid", passwordHash, role: "BILLING_EDITOR", createdAt: timestamp, updatedAt: timestamp },
    { id: "mail", name: "合成郵便担当者", email: "mail_editor@example.invalid", passwordHash, role: "MAIL_EDITOR", createdAt: timestamp, updatedAt: timestamp },
  ];
  assertJapanData(data);
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
