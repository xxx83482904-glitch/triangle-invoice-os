import assert from "node:assert/strict";
import test from "node:test";
import { admin, timestamp } from "./document-fixture";
import { mailRecreateFixture } from "./mail-recreate-fixture";
import { mailInvoiceDefaults } from "../src/lib/mail-invoice-defaults";
import { reflectMailInvoice } from "../src/lib/mail-invoice-reflection";

const options = (data: ReturnType<typeof mailRecreateFixture>) => [data.vendors.map((row) => ({ value: row.id, label: row.companyName })), data.projects.map((row) => ({ value: row.id, label: row.name }))] as const;
const blank = { vendorId: "", projectId: "", issueDate: "", dueDate: "", total: "", status: "REVIEWING" };
test("opening A then B then C uses each mail's evidence and never the previous/deleted invoice or first option", () => {
  const data = mailRecreateFixture(), before = structuredClone(data), [vendors, projects] = options(data);
  const a = mailInvoiceDefaults(data.mailDocuments[0], vendors, projects);
  assert.deepEqual(a, { vendorId: "vendor-a", projectId: "project-a", issueDate: "2026-09-10", dueDate: "2026-10-10", total: "12300", status: "REVIEWING" });
  a.vendorId = "wrong-vendor"; a.total = "999999"; // Simulate editing A before switching.
  assert.deepEqual(mailInvoiceDefaults(data.mailDocuments[1], vendors, projects), { vendorId: "vendor-b", projectId: "project-b", issueDate: "2026-10-05", dueDate: "2026-11-20", total: "45600", status: "REVIEWING" });
  assert.deepEqual(mailInvoiceDefaults(data.mailDocuments[2], vendors, projects), blank);
  assert.equal(mailInvoiceDefaults(data.mailDocuments[0], vendors, projects).total, "12300");
  assert.deepEqual(data, before);
});
test("filename evidence fills named fields without treating an upload date as an invoice date", () => {
  const data = mailRecreateFixture(), [vendors, projects] = options(data);
  assert.deepEqual(mailInvoiceDefaults(data.mailDocuments[3], vendors, projects), { ...blank, vendorId: "vendor-b", projectId: "project-b", issueDate: "2026-08-12", total: "7800" });
  assert.deepEqual(mailInvoiceDefaults({ originalFileName: "2026-11-01_合成制作A_1234abcd.pdf" }, vendors, projects), { ...blank, vendorId: "vendor-a" });
});
test("unknown, ambiguous and partial vendor/project names stay empty; OCR issuer takes precedence", () => {
  const data = mailRecreateFixture(), [vendors, projects] = options(data), mail = data.mailDocuments[0];
  assert.equal(mailInvoiceDefaults({ ...mail, ocrText: "請求元: 合成未登録\n案件: 合成案件" }, vendors, projects).vendorId, "");
  assert.equal(mailInvoiceDefaults({ ...mail, ocrText: "請求元: 合成未登録\n案件: 合成案件" }, vendors, projects).projectId, "");
  assert.equal(mailInvoiceDefaults(mail, [...vendors, { value: "duplicate", label: "合成制作A" }], projects).vendorId, "");
  assert.equal(mailInvoiceDefaults({ ...mail, senderName: "合成設備B" }, vendors, projects).vendorId, "vendor-a");
  assert.equal(mailInvoiceDefaults({ originalFileName: "scan.pdf", senderName: "合成　制作Ａ" }, vendors, projects).vendorId, "vendor-a");
});
test("saved OCR summary is a fallback and explicit zero differs from unknown amount", () => {
  const data = mailRecreateFixture(), [vendors, projects] = options(data);
  const row = { originalFileName: "scan.pdf", memo: "発送元: 合成設備B\n金額: 合計 3,400円\n請求日: 2026-10-02\n支払期限: 2026-11-04" };
  assert.deepEqual(mailInvoiceDefaults(row, vendors, projects), { ...blank, vendorId: "vendor-b", total: "3400", issueDate: "2026-10-02", dueDate: "2026-11-04" });
  assert.equal(mailInvoiceDefaults({ ...row, ocrText: "請求金額: 0円" }, vendors, projects).total, "0");
  assert.equal(mailInvoiceDefaults({ originalFileName: "scan.pdf", ocrText: "税込総額: 10000円\n源泉徴収税額: 1000円" }, vendors, projects).total, "9000");
});
test("unlabelled or invalid OCR dates do not become registration date or an invented deadline", () => {
  const data = mailRecreateFixture(), [vendors, projects] = options(data);
  assert.deepEqual(mailInvoiceDefaults({ originalFileName: "scan.pdf", ocrText: "2026/10/31\n請求日: 2026-02-30\n支払期限: 未定" }, vendors, projects), blank);
});

function input(data: ReturnType<typeof mailRecreateFixture>, extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ mailDocumentId: "mail-a", mailUpdatedAt: data.mailDocuments[0].updatedAt, vendorId: "vendor-a", projectId: "project-a", status: "REVIEWING", issueDate: "", dueDate: "", total: "", ...extra })) form.set(name, value);
  return form;
}
test("recreation permits blank dates and unknown amount, preserving mail processing and old financial data", () => {
  const data = mailRecreateFixture(), before = structuredClone(data);
  const result = reflectMailInvoice(data, admin, input(data), "2026-11-01T00:00:00Z");
  const invoice = data.receivedInvoices[0];
  assert.equal(invoice.id, result.invoiceId); assert.equal(invoice.vendorId, "vendor-a"); assert.equal(invoice.projectId, "project-a");
  assert.equal(invoice.issueDate, ""); assert.equal(invoice.dueDate, ""); assert.equal(invoice.total, 0);
  assert.equal(data.mailDocuments[0].relatedReceivedInvoiceId, invoice.id); assert.equal(data.mailDocuments[0].mailProcessed, false);
  assert.deepEqual(data.receivedInvoices.slice(1), before.receivedInvoices); assert.deepEqual(data.payments, before.payments);
  assert.deepEqual(data.bankTransactions, before.bankTransactions); assert.equal(data.attachments[0].relatedId, invoice.id);
  assert.equal(invoice.originalFileName, before.mailDocuments[0].originalFileName);
});
for (const [fields, pattern] of [
  [{ vendorId: "" }, /支払先を選択/], [{ projectId: "" }, /案件を選択/], [{ vendorId: "missing" }, /支払先と案件/],
  [{ issueDate: "2026-02-30" }, /実在/], [{ total: "-1" }, /金額/], [{ total: "invalid" }, /金額/],
  [{ mailUpdatedAt: "stale" }, /更新/], [{ status: "PAID", total: "12300" }, /支払記録/],
] as Array<[Record<string, string>, RegExp]>) {
  test(`invalid reflection is atomic: ${JSON.stringify(fields)}`, () => {
    const data = mailRecreateFixture(), before = structuredClone(data);
    assert.throws(() => reflectMailInvoice(data, admin, input(data, fields)), pattern); assert.deepEqual(data, before);
  });
}
test("reflection respects role/company/deletion and prevents duplicate creation after another link", () => {
  const data = mailRecreateFixture(), before = structuredClone(data);
  assert.throws(() => reflectMailInvoice(data, { ...admin, role: "GUEST" }, input(data)), /権限/); assert.deepEqual(data, before);
  data.vendors[1].company = "CHINA";
  assert.throws(() => reflectMailInvoice(data, admin, input(data)), /確認/);
  data.vendors[1].company = "JAPAN"; data.mailDocuments[0].deletedAt = timestamp;
  assert.throws(() => reflectMailInvoice(data, admin, input(data)), /見つかりません/);
  data.mailDocuments[0].deletedAt = undefined;
  const first = reflectMailInvoice(data, { ...admin, role: "MAIL_EDITOR" }, input(data));
  assert.equal(data.mailDocuments[0].relatedReceivedInvoiceId, first.invoiceId);
  const saved = structuredClone(data);
  assert.throws(() => reflectMailInvoice(data, admin, input(data)), /連携済み/); assert.deepEqual(data, saved);
});
