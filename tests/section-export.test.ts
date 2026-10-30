import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fromBuffer } from "yauzl";
import { fixture, admin, timestamp } from "./document-fixture";
import { canExportSection, exportCsv, exportQuerySchema, fiscalRange, sectionExport, type ExportQuery } from "../src/lib/section-export";
import { exportIndexHtml, exportUploadName, loadExportDocument, sectionArchive } from "../src/lib/section-export-archive";

const query = (patch: Partial<ExportQuery> = {}): ExportQuery => ({ company: "JAPAN", scope: "all", start: "2026-09-01", end: "2027-08-31", basis: "document", undated: "1", ...patch });
async function unzip(buffer: Buffer) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error || !zip) return reject(error);
    const files = new Map<string, Buffer>();
    zip.on("error", reject); zip.on("end", () => resolve(files));
    zip.on("entry", (entry) => zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error);
      const chunks: Buffer[] = []; stream.on("error", reject); stream.on("data", (b) => chunks.push(b));
      stream.on("end", () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
    })); zip.readEntry();
  }));
}

test("export validates real inclusive dates and August fiscal periods", () => {
  assert.deepEqual(fiscalRange(2026), { start: "2025-09-01", end: "2026-08-31" });
  for (const patch of [{ start: "2026-02-30" }, { start: "2026-99-01" }, { start: "2028-01-01" }, { company: "CHINA" }, { scope: "unexpected" }]) assert.equal(exportQuerySchema.safeParse({ ...query(), ...patch }).success, false);
  const data = fixture(); data.issuedInvoices[0].issueDate = "2026-08-31"; data.issuedInvoices[1].issueDate = "2026-09-01";
  const rows = sectionExport(data, admin, query({ scope: "issued", ...fiscalRange(2026) })).documents;
  assert.deepEqual(rows.map((r) => r.id), ["issued:issued-1"]);
  assert.equal(sectionExport(data, admin, query({ scope: "issued", start: "2026-09-01", end: "2026-09-01" })).documents.length, 1);
});

test("billing and mail staff cannot export totals, other sections, or China", () => {
  const billing = { id: "billing", role: "BILLING_EDITOR" as const }, mail = { id: "mail", role: "MAIL_EDITOR" as const };
  assert.ok(canExportSection(billing, "issued")); assert.ok(canExportSection(billing, "estimate"));
  assert.ok(!canExportSection(billing, "all")); assert.ok(!canExportSection(mail, "banking"));
  assert.throws(() => sectionExport(fixture(), billing, query()));
  assert.throws(() => sectionExport(fixture(), mail, query({ scope: "received" })));
  const result = sectionExport(fixture(), mail, query({ scope: "mail" }));
  assert.ok(result.documents.length); assert.ok(result.documents.every((r) => r.total === undefined));
  assert.ok(!sectionExport(fixture(), admin, query()).documents.some((r) => r.sourceId === "issued-cn"));
});

test("canonical receipts and linked mail export once; section scope retains related originals", () => {
  const data = fixture();
  data.attachments.push({ ...data.attachments[0], id: "extra", fileUrl: "/api/files/extra.png", createdAt: "2028-01-01T00:00:00Z" });
  const all = sectionExport(data, admin, query());
  assert.equal(all.documents.filter((r) => r.fileUrl === "/api/files/received.pdf").length, 1);
  const mail = sectionExport(data, admin, query({ scope: "mail" }));
  assert.deepEqual(mail.documents.map((r) => r.kind).sort(), ["attachment", "received"]);
  assert.equal(mail.documents.find((r) => r.kind === "attachment")?.exportDate, "2026-09-15");
  assert.ok(!mail.documents.some((r) => r.kind === "issued"));
  data.receivedInvoices[0].deletedAt = timestamp; data.mailDocuments[0].deletedAt = timestamp;
  assert.ok(!sectionExport(data, admin, query()).documents.some((r) => r.sourceId === "extra"));
});

test("folder month, transaction date and undated opt-in are explicit", () => {
  const data = fixture();
  assert.equal(sectionExport(data, admin, query({ scope: "received", ...fiscalRange(2026) })).documents.length, 0);
  assert.equal(sectionExport(data, admin, query({ scope: "received", basis: "folder", ...fiscalRange(2026) })).documents.length, 1);
  data.issuedInvoices[0].transactionDate = "2026-08-31";
  assert.equal(sectionExport(data, admin, query({ scope: "issued", basis: "transaction", ...fiscalRange(2026) })).documents.length, 1);
  data.issuedInvoices[0].issueDate = "";
  const result = sectionExport(data, admin, query({ scope: "issued", ...fiscalRange(2026) }));
  assert.equal(result.documents[0].warning, "期間未判定 / OCR要確認 / 下書き");
  const excluded = sectionExport(data, admin, query({ scope: "issued", ...fiscalRange(2026), undated: "0" }));
  assert.equal(excluded.documents.length, 0); assert.equal(excluded.excludedUndated, 1);
});

test("CSV prevents formula injection while retaining numeric values and newlines", () => {
  const csv = exportCsv([["=cmd()", "+cmd", "-cmd", "@test", " \t=cmd", -123, "a,b\n\"c\""]]);
  assert.ok(csv.startsWith("\uFEFF")); assert.ok(csv.includes('"\'=cmd()"'));
  assert.ok(csv.includes('"\' \t=cmd"')); assert.ok(csv.includes('"-123"'));
  assert.ok(csv.includes('"a,b\n""c"""'));
});

test("original loader accepts only local upload paths, not external or traversal URLs", () => {
  for (const url of ["https://example.com/api/files/x.pdf", "file:///etc/passwd", "/api/files/..", "/api/files/a%2fb.pdf", "/uploads/received-invoices/%5csecret", "/api/files/%00foo", "/api/issued-invoices/other/pdf"]) assert.equal(exportUploadName(url), null);
  assert.equal(exportUploadName("/api/files/%E9%A0%98%E5%8F%8E.pdf"), "領収.pdf");
});

test("ZIP retains exact bytes, deduplicates originals, lists missing files and safe links", async () => {
  const data = fixture(); data.issuedInvoices[1].fileUrl = data.issuedInvoices[0].fileUrl;
  data.issuedInvoices[0].invoiceNumber = '../<script>alert("x")</script>';
  const before = JSON.stringify(data);
  const bundle = sectionExport(data, admin, query());
  const original = Buffer.from("%PDF-1.4\noriginal test bytes"); let reads = 0;
  const archive = sectionArchive(bundle, data, undefined, async (row) => {
    if (row.kind === "contract") return null;
    reads++; return { data: original, mimeType: "application/pdf" };
  });
  const chunks: Buffer[] = []; for await (const chunk of archive) chunks.push(Buffer.from(chunk));
  const files = await unzip(Buffer.concat(chunks));
  assert.ok(files.has("documents.csv")); assert.ok(files.has("bank-transactions.csv")); assert.ok(files.has("index.html"));
  const originals = [...files].filter(([name]) => name.startsWith("files/"));
  assert.equal(originals.length, reads);
  for (const [name, bytes] of originals) { assert.ok(!name.includes("..")); assert.deepEqual(bytes, original); }
  const issued = bundle.documents.filter((r) => r.kind === "issued");
  assert.equal(issued[0].archivePath, issued[1].archivePath);
  assert.equal(issued[0].sha256, createHash("sha256").update(original).digest("hex"));
  const html = files.get("index.html")!.toString(); assert.ok(!html.includes('<script>')); assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(files.get("documents.csv")!.toString().includes("原本なし・参照先不明"));
  assert.equal(JSON.stringify(data), before);
});

test("generated PDFs are distinct from missing uploaded originals", async () => {
  const data = fixture(); delete data.issuedInvoices[0].fileUrl;
  const bundle = sectionExport(data, admin, query({ scope: "issued" }));
  const row = bundle.documents.find((r) => r.sourceId === "issued-1")!;
  assert.equal(row.fileType, "生成PDF");
  const file = await loadExportDocument(row, data);
  assert.ok(file?.data.subarray(0, 5).equals(Buffer.from("%PDF-")));
  const uploaded = bundle.documents.find((r) => r.sourceId === "issued-2")!;
  assert.equal(uploaded.fileType, "原本");
  assert.ok(exportIndexHtml(bundle).includes("生成PDF") === false, "Unloaded files must not appear as successful links");
});

test("cancelling an export stops the archive without an unhandled rejection", async () => {
  const controller = new AbortController(); controller.abort();
  const archive = sectionArchive(sectionExport(fixture(), admin, query()), fixture(), controller.signal);
  await assert.rejects(async () => { for await (const _chunk of archive) { void _chunk; } });
});

test("banking exports saved classification and transfers without mixing companies", () => {
  const data = fixture();
  data.bankAccounts = [{ id: "bank", name: "Test bank", serviceName: "Test", company: "JAPAN", officeCode: "office", sourceId: "bank", available: true, isManual: false, createdAt: timestamp, updatedAt: timestamp }];
  const row = { id: "t1", company: "JAPAN" as const, officeCode: "office", sourceId: "t1", bankAccountId: "bank", transactionDate: "2026-09-01", amount: 100, side: "EXPENSE" as const, content: "Transfer", sourceMemo: "", sourceStatus: "", sourceMissing: false, treatment: "TRANSFER" as const, classificationSource: "MANUAL" as const, reviewed: true, memo: "", createdAt: timestamp, updatedAt: timestamp };
  data.bankTransactions = [row, { ...row, id: "t2", company: "CHINA" }, { ...row, id: "t3", transactionDate: "2026-08-31" }, { ...row, id: "t4", sourceMissing: true }];
  const result = sectionExport(data, admin, query({ scope: "banking" }));
  assert.equal(result.bank.length, 2); assert.equal(result.bank[0].treatment, "資金移動");
  assert.equal(result.bank[0].category, "未保存・未分類"); assert.ok(result.bank[1].sourceMissing);
  data.issuedInvoices[0].issueDate = "2026-08-31";
  const link = { id: "link", company: "JAPAN" as const, transactionId: "t1", invoiceKind: "issued" as const, invoiceId: "issued-1", paymentId: "payment", amount: 100, createdPayment: true, bankEvidence: "", invoiceEvidence: "", paymentEvidence: "", note: "", confirmedById: "admin", createdAt: timestamp, updatedAt: timestamp };
  data.bankReconciliations = [link, { ...link, id: "china", invoiceId: "issued-cn" }, { ...link, id: "deleted", invoiceId: "issued-2", deletedAt: timestamp }];
  const matched = sectionExport(data, admin, query({ scope: "banking" }));
  assert.deepEqual(matched.documents.map((r) => r.id), ["issued:issued-1"]);
  assert.equal(matched.documents[0].exportDate, "2026-08-31");
  assert.ok(matched.documents[0].warning.includes("書類日は期間外の場合あり"));
  assert.ok(matched.bank[0].documents.includes("issued:issued-1"));
  assert.ok(!matched.bank[0].documents.includes("issued-cn"));
});
