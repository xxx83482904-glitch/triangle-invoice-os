import { cp, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { hashSync } from "bcryptjs";
import { fixture, timestamp } from "./document-fixture";
import { assertJapanData } from "../src/lib/japan-storage";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-received-review-"));
  for (const name of ["src", "public", "next.config.ts", "package.json", "tsconfig.json", "postcss.config.mjs"]) {
    await cp(path.resolve(name), path.join(root, name), { recursive: true, filter: (source) => !source.includes(`${path.sep}public${path.sep}uploads`) && !source.includes(`${path.sep}public${path.sep}design-fee-calculator`) });
  }
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "junction");
  await mkdir(path.join(root, "data"));
  await mkdir(path.join(root, "public", "uploads", "received-invoices"), { recursive: true });
  const data = fixture(); data.appEdition = "JAPAN";
  data.clients = data.clients.filter((client) => client.company === "JAPAN");
  data.vendors = data.vendors.filter((vendor) => vendor.company === "JAPAN");
  data.selectOptions = data.selectOptions.filter((option) => option.company === "JAPAN");
  const clientIds = new Set(data.clients.map((client) => client.id));
  const vendorIds = new Set(data.vendors.map((vendor) => vendor.id));
  data.projects = data.projects.filter((project) => project.company === "JAPAN" && clientIds.has(project.clientId))
    .map((project) => ({ ...project, contractFileUrl: undefined }));
  const projectIds = new Set(data.projects.map((project) => project.id));
  data.receivedInvoices = data.receivedInvoices.filter((invoice) => projectIds.has(invoice.projectId) && vendorIds.has(invoice.vendorId));
  data.issuedInvoices = []; data.issuedInvoiceItems = []; data.estimates = [];
  data.mailDocuments = []; data.mailFolders = []; data.attachments = []; data.payments = [];
  data.bankAccounts = []; data.bankTransactions = []; data.accountingCategories = []; data.bankRules = [];
  data.bankSyncStates = []; data.bankReconciliations = []; data.bankTransfers = []; data.auditLogs = [];
  data.users = [{ id: "admin", role: "ADMIN", accessStatus: "ACTIVE", name: "Synthetic Review", email: "review@example.invalid", passwordHash: hashSync("synthetic-review-only", 10), createdAt: timestamp, updatedAt: timestamp }];
  Object.assign(data.receivedInvoices[0], { status: "REVIEWING", mailProcessed: false, subtotal: 100000, taxTotal: 10000, grossAmount: 110000, withholdingAmount: 10210, total: 99790,
    fileUrl: "/api/files/received-fixture.pdf", originalFileName: "received-fixture.pdf", mimeType: "application/pdf",
    ocrText: "請求元: Test supplier\n請求日: 2026-09-15\n支払期限: 2026-10-15\n税抜: 100000円\n消費税: 10000円\n税込合計: 110000円\n源泉徴収税額: 10210円\n差引支払額: 99790円\n振込先: Synthetic Bank", memo: "Synthetic invoice. No real records." });
  data.receivedInvoices.push({ ...data.receivedInvoices[0], id: "missing-original", fileUrl: "/api/files/missing-fixture.pdf", originalFileName: "missing-fixture.pdf" });
  assertJapanData(data);
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const buffers: Buffer[] = [];
  const pdf = new Promise<Buffer>((resolve) => { doc.on("data", (chunk) => buffers.push(Buffer.from(chunk))); doc.on("end", () => resolve(Buffer.concat(buffers))); });
  doc.fontSize(24).text("SYNTHETIC INVOICE").moveDown().fontSize(15)
    .text("Issuer: Test supplier\nInvoice date: 2026-09-15\nDue date: 2026-10-15\n\nFees: 100,000 JPY\nConsumption tax: 10,000 JPY\nGross: 110,000 JPY\nWithholding: 10,210 JPY\nNet payable: 99,790 JPY\n\nRemittance bank: Synthetic Bank\nNOT REAL BUSINESS DATA");
  doc.end();
  await writeFile(path.join(root, "public", "uploads", "received-invoices", "received-fixture.pdf"), await pdf);
  await writeFile(path.join(root, "data", "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
void main();
