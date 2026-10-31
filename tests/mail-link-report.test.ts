import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brokenLinks, fileNameFromUrl, missingFiles } from "../scripts/migrations/mail-link-report.mjs";

type Loose = { id: string; [key: string]: unknown };
const script = fileURLToPath(new URL("../scripts/migrations/mail-link-report.mjs", import.meta.url));
const at = "2026-10-20T00:00:00.000Z";
const mail = (id: string, extra: Record<string, unknown> = {}): Loose => ({ id, company: "JAPAN", category: "INVOICE", title: `Mail ${id}`, senderName: "テスト制作", fileUrl: `/uploads/received-invoices/${id}.pdf`, originalFileName: `${id}.pdf`, mimeType: "application/pdf", uploadedById: "admin", createdAt: at, updatedAt: at, folderMonth: "2026-10", ...extra });
const invoice = (id: string, extra: Record<string, unknown> = {}): Loose => ({ id, vendorId: "v1", projectId: "p1", issueDate: "2026-10-01", dueDate: "2026-10-31", total: 55000, status: "SCHEDULED", fileUrl: `/uploads/received-invoices/${id}.pdf`, originalFileName: `${id}.pdf`, createdAt: at, updatedAt: at, ...extra });
const data = () => ({ appEdition: "JAPAN", projects: [{ id: "p1", company: "JAPAN", name: "P" }], vendors: [{ id: "v1", companyName: "株式会社テスト制作" }, { id: "v2", companyName: "別会社" }],
  receivedInvoices: [invoice("inv-live"), invoice("inv-deleted", { deletedAt: at }), invoice("inv-same-name", { originalFileName: "mail-broken.pdf", vendorId: "v2" }), invoice("inv-other", { vendorId: "v2", total: 1 })],
  mailDocuments: [mail("mail-ok", { relatedReceivedInvoiceId: "inv-live" }), mail("mail-broken", { relatedReceivedInvoiceId: "inv-deleted" }), mail("mail-ghost", { relatedReceivedInvoiceId: "never-existed", senderName: "unknown" }), mail("mail-removed", { relatedReceivedInvoiceId: "inv-deleted", deletedAt: at }), mail("mail-unlinked")] });

test("broken links are listed with ranked candidates and a proposal", () => {
  const rows = brokenLinks(data()) as Array<{ mailDocumentId: string; missingInvoiceState: string; candidates: Array<{ invoiceId: string; reasons: string[] }>; proposal: string }>;
  assert.deepEqual(rows.map((row) => row.mailDocumentId), ["mail-broken", "mail-ghost"]);
  assert.equal(rows[0].missingInvoiceState, "削除済み"); assert.equal(rows[1].missingInvoiceState, "存在しない");
  assert.deepEqual(rows[0].candidates.map((row) => row.invoiceId), ["inv-live", "inv-same-name"]);
  assert.ok(rows[0].candidates[0].reasons.includes("削除された書類と同じ支払先・金額"));
  assert.match(rows[0].proposal, /再連携/); assert.match(rows[1].proposal, /作り直す/);
});

test("missing files are checked by file name across upload roots", () => {
  assert.equal(fileNameFromUrl("/uploads/received-invoices/a%20b.pdf"), "a b.pdf");
  assert.equal(fileNameFromUrl("/api/files/x.pdf"), "x.pdf");
  const rows = missingFiles(data(), (name: string) => name !== "mail-ghost.pdf" && name !== "inv-other.pdf") as Array<{ kind: string; id: string }>;
  assert.deepEqual(rows.map((row) => [row.kind, row.id]), [["mail", "mail-ghost"], ["invoice", "inv-other"]]);
});

test("cli prints the report, writes JSON and never changes the data file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-mail-link-report-"));
  try {
    const file = path.join(root, "app-data.json"), uploads = path.join(root, "uploads");
    await mkdir(uploads);
    for (const name of ["mail-ok.pdf", "mail-broken.pdf", "inv-live.pdf", "inv-same-name.pdf", "mail-unlinked.pdf"]) await writeFile(path.join(uploads, name), "%PDF-1.4 synthetic");
    await writeFile(file, JSON.stringify(data()));
    const before = await readFile(file, "utf8");
    const output = execFileSync(process.execPath, [script, "--data", file, "--uploads", uploads, "--out", path.join(root, "report.json")], { encoding: "utf8" });
    assert.match(output, /参照切れ 2件/); assert.match(output, /原本なし 2件/); assert.match(output, /Report only/);
    const report = JSON.parse(await readFile(path.join(root, "report.json"), "utf8"));
    assert.equal(report.brokenLinks.length, 2); assert.equal(report.missingFiles.length, 2);
    assert.equal(await readFile(file, "utf8"), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
