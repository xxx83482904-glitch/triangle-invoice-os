import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fromBuffer } from "yauzl";
import { fixture, admin, timestamp } from "./document-fixture";
import { bankExportCsv, bankExportGroups, canExportSection, exportCsv, exportQuerySchema, fiscalRange, sectionExport, type ExportBankRow, type ExportQuery } from "../src/lib/section-export";
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

test("export filenames identify company and amount without changing source files or leaking hidden totals", async () => {
  const data = fixture();
  data.clients[0].companyName = "株式会社テスト";
  data.vendors[0].companyName = "株式会社仕入先";
  const before = JSON.stringify(data);
  for (const scope of ["all", "issued", "received", "mail"] as const) {
    const bundle = sectionExport(data, admin, query({ scope }));
    const archive = sectionArchive(bundle, data, undefined, async () => ({ data: Buffer.from("original"), mimeType: "application/pdf" }));
    const chunks: Buffer[] = []; for await (const chunk of archive) chunks.push(Buffer.from(chunk));
    const files = await unzip(Buffer.concat(chunks));
    const csv = files.get("documents.csv")!.toString();
    const html = files.get("index.html")!.toString();
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    for (const row of bundle.documents) {
      assert.ok(files.has(row.archivePath!));
      const name = row.archivePath!.split("/").at(-1)!;
      assert.ok(name.startsWith(`${row.counterpart}_`));
      assert.ok(name.includes(row.total === undefined ? "金額未設定" : `${row.total.toLocaleString("ja-JP")}円`));
      assert.ok(csv.includes(name));
      assert.ok(html.includes(row.archivePath!.split("/").map(encodeURIComponent).join("/")));
      assert.ok(manifest.files.some((file: { archivePath: string }) => file.archivePath === row.archivePath));
    }
    assert.ok(csv.includes("書き出しファイル名"));
    if (scope === "issued") assert.ok(csv.includes("issued.pdf"));
  }
  const mail = sectionExport(data, { id: "mail", role: "MAIL_EDITOR" }, query({ scope: "mail" }));
  const archive = sectionArchive(mail, data, undefined, async () => ({ data: Buffer.from("original"), mimeType: "image/png" }));
  for await (const chunk of archive) void chunk;
  assert.ok(mail.documents.every((r) => r.archivePath!.includes("金額未設定")));
  assert.equal(JSON.stringify(data), before);
});

test("export names retain zero and negative amounts, sanitize company names and avoid collisions", async () => {
  const data = fixture();
  const bundle = sectionExport(data, admin, query({ scope: "issued" }));
  bundle.documents = [0, 0, -1234.5, undefined, NaN].map((total, index) => ({
    ...bundle.documents[0], id: `issued:test-${index}`, fileUrl: `/api/files/test-${index}.jpg`,
    counterpart: index === 3 ? " " : '../株式会社/危険:*?"<>|\\会社' + "長".repeat(80), total,
  }));
  const archive = sectionArchive(bundle, data, undefined, async () => ({ data: Buffer.from("original"), mimeType: "image/jpeg" }));
  const chunks: Buffer[] = []; for await (const chunk of archive) chunks.push(Buffer.from(chunk));
  const files = await unzip(Buffer.concat(chunks));
  const names = [...files.keys()].filter((name) => name.startsWith("files/"));
  assert.equal(names.length, 5);
  assert.ok(names.every((name) => !name.includes("..") && !/[\\:*?"<>|]/.test(name) && name.endsWith(".jpg")));
  assert.ok(names[0].includes("_0円_"));
  assert.ok(names[2].includes("_-1,234.5円_"));
  assert.ok(names[3].includes("会社名未設定_金額未設定_"));
  assert.ok(names[4].includes("_金額未設定_"));
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
  assert.equal(result.bank[0].accountId, "bank");
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

test("bank exports separate accounts, income and expense columns and identify the receiving account", async () => {
  const data = fixture();
  const bundle = sectionExport(data, admin, query({ scope: "banking" }));
  const base: ExportBankRow = { id: "income", date: "2026-09-20", accountId: "ufj", account: "UFJ 六本木 0683879", side: "入金", amount: 12345,
    content: "振込 株式会社テスト", category: "売掛金", subCategory: "", treatment: "通常", reviewed: "確認済み", classification: "MANUAL", sourceMissing: false, memo: "", documents: "issued:invoice-1 (12345)", transfer: "" };
  bundle.bank = [base,
    { ...base, id: "expense", date: "2026-09-01", side: "出金", amount: 660, content: "振込手数料", documents: "" },
    { ...base, id: "paypay", accountId: "paypay", account: "PayPay銀行 7691", treatment: "資金移動", transfer: "transfer-1" },
    { ...base, id: "different-account", accountId: "ufj-2" },
    { ...base, id: "undated", date: "", amount: 0 },
    { ...base, id: "card", accountId: "card", account: '../カード<script>"', side: "出金", amount: 800, content: "=untrusted()", sourceMissing: true },
  ];
  const before = JSON.stringify(bundle.bank);
  const groups = bankExportGroups(bundle);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups.find((g) => g.accountId === "ufj")!.rows.map((r) => r.id), ["expense", "income", "undated"]);
  const csv = bankExportCsv(bundle);
  assert.ok(csv.includes('"入金額（円）","出金額（円）","入金先口座"'));
  assert.ok(csv.includes('"2026-09-20","UFJ 六本木 0683879","12345","","UFJ 六本木 0683879","振込 株式会社テスト"'));
  assert.ok(csv.includes('"2026-09-01","UFJ 六本木 0683879","","660","","振込手数料"'));
  assert.ok(csv.includes('"","UFJ 六本木 0683879","0","","UFJ 六本木 0683879"'));
  assert.ok(csv.includes('"\'=untrusted()"'));
  const archive = sectionArchive(bundle, data);
  const chunks: Buffer[] = []; for await (const chunk of archive) chunks.push(Buffer.from(chunk));
  const files = await unzip(Buffer.concat(chunks));
  assert.equal([...files.keys()].filter((name) => name.startsWith("bank-accounts/")).length, 4);
  const manifest = JSON.parse(files.get("manifest.json")!.toString());
  assert.equal(manifest.bankAccounts.length, 4);
  const html = files.get("bank-accounts.html")!.toString();
  assert.ok(!html.includes("<script>")); assert.ok(html.includes("&lt;script&gt;"));
  for (const group of groups) {
    assert.ok(!group.archivePath.includes(".."));
    const accountCsv = files.get(group.archivePath)!.toString();
    assert.equal(accountCsv, bankExportCsv({ ...bundle, bank: group.rows }));
    assert.ok(html.includes(group.archivePath.split("/").map(encodeURIComponent).join("/")));
    assert.ok(manifest.bankAccounts.some((a: { accountId: string; archivePath: string; count: number }) => a.accountId === group.accountId && a.archivePath === group.archivePath && a.count === group.rows.length));
  }
  const ufjCsv = files.get(groups.find((g) => g.accountId === "ufj")!.archivePath)!.toString();
  assert.ok(!ufjCsv.includes('"different-account"'));
  assert.ok(!ufjCsv.includes('"paypay"'));
  assert.equal(files.get("bank-transactions.csv")!.toString(), csv);
  assert.equal(JSON.stringify(bundle.bank), before);
  assert.equal(bankExportGroups({ ...bundle, bank: [] }).length, 0);
  assert.equal(bankExportCsv({ ...bundle, bank: [] }).split("\r\n").length, 1);
});
