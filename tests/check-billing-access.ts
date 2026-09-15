import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SignJWT } from "jose";
import { compare } from "bcryptjs";
import PDFDocument from "pdfkit";
import type { AppData } from "../src/lib/types";

async function main() {
  const base = process.env.TEST_BASE_URL || "http://localhost:3016";
  const dataPath = process.env.TEST_DATA_PATH || "";
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
  assert.ok(dataPath.includes("triangle-documents-"), "Use disposable fixture data only");
  const read = async (): Promise<AppData> => JSON.parse(await readFile(dataPath, "utf8"));
  const request = async (url: string, id: string, init: RequestInit = {}) => {
    const token = id ? await new SignJWT({ id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m")
      .sign(new TextEncoder().encode("triangle-invoice-os-local-development-secret")) : "";
    return fetch(base + url, { ...init, headers: { ...init.headers, ...(token ? { Cookie: `triangle-session=${token}` } : {}) }, redirect: "manual" });
  };
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const run = Date.now();
  const account = { email: `invoice_staff_${run}@example.invalid`, name: "Test invoice staff", password: "local-invoice-staff-only" };
  const endpoint = "/api/admin/invoice-staff";
  assert.equal((await request(endpoint, "", json(account))).status, 401);
  assert.equal((await request(endpoint, "manager", json(account))).status, 403);
  assert.equal((await request(endpoint, "admin", json({ ...account, role: "ADMIN" }))).status, 400);
  assert.equal((await request(endpoint, "admin", { ...json(account), headers: { "Content-Type": "application/json", Origin: "https://untrusted.example.invalid" } })).status, 403);
  const response = await request(endpoint, "admin", json(account)); assert.equal(response.status, 201);
  const created = await response.json(); assert.equal(created.role, "BILLING_EDITOR"); assert.equal(created.company, "JAPAN"); assert.equal(created.passwordHash, undefined);
  const id = created.id;
  assert.equal((await request(endpoint, id, json({ ...account, email: "another@example.invalid" }))).status, 403);
  assert.equal((await request(endpoint, "admin", json({ ...account, password: "do-not-overwrite" }))).status, 409);
  const stored = (await read()).users.find((u) => u.id === id)!;
  assert.equal(stored.role, "BILLING_EDITOR"); assert.ok(await compare(account.password, stored.passwordHash));
  for (const url of ["/dashboard", "/documents", "/projects", "/projects/japan", "/received-invoices", "/mail-sorter", "/payments", "/reports", "/guest-invoices"]) {
    const result = await request(url + "?company=JAPAN", id);
    assert.equal(result.status, 307, url); assert.ok(result.headers.get("location")?.startsWith("/issued-invoices"), url);
  }
  for (const url of ["/issued-invoices", "/partners"]) {
    const result = await request(url + "?company=CHINA", id); assert.equal(result.status, 200);
    const html = await result.text(); assert.ok(!html.includes("INV-CN")); assert.ok(!html.includes("China project"));
    assert.ok(!html.includes('href="/dashboard')); assert.ok(!html.includes('href="/projects')); assert.ok(!html.includes('href="/mail-sorter'));
  }
  for (const file of ["issued.pdf", "other.pdf"]) assert.equal((await request("/api/files/" + file, id)).status, 200);
  for (const file of ["china.pdf", "contract.pdf", "received.pdf", "old.pdf"]) assert.equal((await request("/api/files/" + file, id)).status, 404);
  assert.equal((await request("/api/documents/issued%3Aissued-1?company=JAPAN", id)).status, 200);
  assert.equal((await request("/api/documents/issued%3Aissued-cn?company=CHINA", id)).status, 404);
  assert.equal((await request("/api/documents/received%3Areceived-1?company=JAPAN", id)).status, 404);
  assert.equal((await request("/api/issued-invoices/issued-1/pdf", id)).status, 200);
  assert.equal((await request("/api/issued-invoices/issued-cn/pdf", id)).status, 403);
  assert.equal((await request("/api/export/issued-invoices?company=JAPAN", id)).status, 200);
  for (const url of ["/api/export/issued-invoices?company=CHINA", "/api/export/received-invoices?company=JAPAN", "/api/export/projects?company=JAPAN"]) assert.equal((await request(url, id)).status, 403);
  for (const url of ["/api/uploads/mail-sorter", "/api/uploads/contracts", "/api/uploads/received-invoices", "/api/uploads/received-invoices/ocr-drop"]) assert.equal((await request(url, id, { method: "POST" })).status, 403, url);
  for (const body of [{ company: "CHINA", kind: "client", label: "Denied" }, { company: "JAPAN", kind: "vendor", label: "Denied" }, { company: "JAPAN", kind: "select-option", group: "PROJECT_STAGE", label: "Denied" }]) {
    assert.equal((await request("/api/dropdown-options", id, json(body))).status, 403);
  }
  assert.equal((await request("/api/dropdown-options", id, json({ company: "JAPAN", kind: "client", label: "Billing customer" }))).status, 200);
  const pdf = await new Promise<Buffer>((resolve) => { const doc = new PDFDocument(); const chunks: Buffer[] = []; doc.on("data", (c) => chunks.push(Buffer.from(c))); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.text(`Invoice Number: BILLING-${run}\nProject name: Billing project ${run}\nBill to: Billing customer\nInvoice date: 2026-09-15\nDue date: 2026-10-15\nTotal amount: 12000`); doc.end(); });
  const form = new FormData(); form.set("company", "CHINA"); form.append("files", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "billing-test.pdf");
  assert.equal((await request("/api/uploads/issued-invoices/ocr-drop", id, { method: "POST", body: form })).status, 403);
  form.set("company", "JAPAN");
  const imported = await (await request("/api/uploads/issued-invoices/ocr-drop", id, { method: "POST", body: form })).json();
  assert.equal(imported.results[0].projectCreated, true);
  const data = await read(); const invoice = data.issuedInvoices.find((i) => i.id === imported.results[0].id)!;
  assert.ok(invoice); assert.equal(data.projects.find((p) => p.id === invoice.projectId)?.company, "JAPAN");
  assert.equal(invoice.createdById, id); assert.equal(invoice.needsReview, true);
  console.log("PASS: admin-only account creation, password hashing/no overwrite, Japan-only pages/files/OCR/exports/clients, denied unrelated routes and protected existing data.");
  console.log(JSON.stringify({ testEmail: account.email, testUserId: id }));
}
void main();
