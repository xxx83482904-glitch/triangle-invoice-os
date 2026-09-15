import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SignJWT } from "jose";
import PDFDocument from "pdfkit";

async function main() {
  const base = process.env.TEST_BASE_URL || "http://localhost:3014";
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Only run against local fixtures");
  const request = async (url: string, id?: string, init: RequestInit = {}) => {
    const token = id ? await new SignJWT({ id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode("triangle-invoice-os-local-development-secret")) : "";
    return fetch(base + url, { ...init, headers: { ...init.headers, ...(token ? { Cookie: `triangle-session=${token}` } : {}) }, redirect: "manual" });
  };
  for (const file of ["/api/files/issued.pdf", "/uploads/received-invoices/issued.pdf", "/api/issued-invoices/issued-1/pdf", "/api/documents/issued%3Aissued-1?company=JAPAN"]) {
    assert.equal((await request(file)).status, 401, file);
    assert.equal((await request(file, "manager")).status, 200, file);
  }
  assert.equal((await request("/api/files/other.pdf", "manager")).status, 404);
  assert.equal((await request("/api/files/issued.pdf", "mail")).status, 404);
  assert.equal((await request("/api/files/received.pdf", "mail")).status, 200);
  assert.equal((await request("/api/issued-invoices/issued-1/pdf", "mail")).status, 403);
  assert.equal((await request("/api/documents/issued%3Aissued-2?company=JAPAN", "manager")).status, 404);
  assert.equal((await request("/api/uploads/issued-invoices/ocr-drop", "mail", { method: "POST" })).status, 403);
  const form = new FormData(); form.set("company", "JAPAN"); form.set("projectId", "other");
  assert.equal((await request("/api/uploads/issued-invoices/ocr-drop", "manager", { method: "POST", body: form })).status, 400);
  const dataPath = process.env.TEST_DATA_PATH;
  if (dataPath) {
    assert.ok(dataPath.includes("triangle-documents-"));
    const data = JSON.parse(await readFile(dataPath, "utf8"));
    const imported = data.issuedInvoices.filter((i: { invoiceNumber: string }) => i.invoiceNumber.startsWith("DROP-"));
    assert.equal(imported.length, 3);
    assert.ok(imported.every((i: { status: string; needsReview: boolean; taxTotal: number }) => i.status === "SENT" && !i.needsReview && i.taxTotal === 0));
    const invoiceNumber = "CONCURRENT-" + Date.now();
    const pdfBuffer = await new Promise<Buffer>((resolve) => {
      const pdf = new PDFDocument(); const chunks: Buffer[] = [];
      pdf.on("data", (chunk) => chunks.push(Buffer.from(chunk))); pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.text(`Invoice Number: ${invoiceNumber}\nInvoice date: 2026-09-15\nDue date: 2026-10-15\nTotal amount: 12000`); pdf.end();
    });
    const upload = () => { const body = new FormData(); body.set("company", "JAPAN"); body.set("projectId", "japan"); body.append("files", new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }), "concurrent.pdf"); return request("/api/uploads/issued-invoices/ocr-drop", "manager", { method: "POST", body }); };
    const responses = await Promise.all([upload(), upload()]);
    const results = (await Promise.all(responses.map((r) => r.json()))).flatMap((r) => r.results);
    assert.equal(results.filter((r) => r.id).length, 1, "Exactly one concurrent import should succeed");
    assert.equal(results.filter((r) => r.error).length, 1);
    const after = JSON.parse(await readFile(dataPath, "utf8"));
    assert.equal(after.issuedInvoices.filter((i: { invoiceNumber: string }) => i.invoiceNumber === invoiceNumber).length, 1);
  }
  console.log("Document API checks passed: authentication, role scope, original files, OCR permission, project restriction, saved imports.");
}
void main();
