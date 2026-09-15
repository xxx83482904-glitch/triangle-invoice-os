import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SignJWT } from "jose";
import PDFDocument from "pdfkit";
import type { AppData } from "../src/lib/types";

async function main() {
  const base = process.env.TEST_BASE_URL || "http://localhost:3016";
  const dataPath = process.env.TEST_DATA_PATH || "";
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
  assert.ok(dataPath.includes("triangle-documents-"), "Requires disposable fixture data");
  const read = async (): Promise<AppData> => JSON.parse(await readFile(dataPath, "utf8"));
  const initial = await read();
  assert.equal(initial.projects[0].id, "japan", "Run against a fresh fixture");
  const pdf = (number: string, project = "Japan project", client = "Test customer") => new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument(); const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk))); doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.text(`Invoice Number: ${number}\nInvoice date: 2026-09-15\nDue date: 2026-10-15\nProject name: ${project}\nBill to: ${client}\nTotal amount: 12000`); doc.end();
  });
  const upload = async (buffer: Buffer, options: { projectId?: string; company?: string; user?: string; name?: string } = {}) => {
    const user = options.user ?? "manager";
    const token = user ? await new SignJWT({ id: user }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m")
      .sign(new TextEncoder().encode("triangle-invoice-os-local-development-secret")) : "";
    const form = new FormData(); form.set("company", options.company ?? "JAPAN");
    if (options.projectId) form.set("projectId", options.projectId);
    form.append("files", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), options.name || "auto-test.pdf");
    const response = await fetch(base + "/api/uploads/issued-invoices/ocr-drop", { method: "POST", body: form, headers: token ? { Cookie: `triangle-session=${token}` } : {} });
    return { status: response.status, body: await response.json() };
  };
  const matched = await upload(await pdf("AUTO-MATCH"));
  assert.equal(matched.body.results[0].projectId, "japan");
  assert.equal(matched.body.results[0].projectCreated, false);
  const newFile = await pdf("AUTO-NEW", "New shop", "New customer");
  const created = (await upload(newFile)).body.results[0];
  assert.equal(created.projectCreated, true); assert.equal(created.projectName, "New shop");
  const reused = (await upload(await pdf("AUTO-NEXT", "New shop", "New customer"))).body.results[0];
  assert.equal(reused.projectId, created.projectId); assert.equal(reused.projectCreated, false);
  const beforeDuplicate = await read();
  assert.ok((await upload(newFile, { name: "renamed.pdf" })).body.results[0].error);
  assert.ok((await upload(await pdf("AUTO-NEW", "Should not exist", "No new client"))).body.results[0].error);
  const afterDuplicate = await read();
  assert.equal(afterDuplicate.projects.length, beforeDuplicate.projects.length);
  assert.equal(afterDuplicate.clients.length, beforeDuplicate.clients.length);
  const concurrentFile = await pdf("AUTO-CONCURRENT", "Concurrent shop", "Concurrent customer");
  const concurrent = await Promise.all([upload(concurrentFile), upload(concurrentFile)]);
  assert.equal(concurrent.filter((r) => r.body.results[0].id).length, 1);
  assert.equal((await read()).projects.filter((p) => p.name === "Concurrent shop").length, 1);
  assert.equal((await upload(newFile, { user: "" })).status, 401);
  assert.equal((await upload(newFile, { user: "mail" })).status, 403);
  assert.equal((await upload(newFile, { projectId: "other" })).status, 400);
  assert.equal((await upload(newFile, { company: "" })).status, 400);
  const manual = (await upload(await pdf("AUTO-MANUAL", "Do not create", "Do not create client"), { projectId: "japan" })).body.results[0];
  assert.equal(manual.projectId, "japan"); assert.equal(manual.projectMatch, "manual");
  const china = (await upload(await pdf("AUTO-CHINA", "New shop", "New customer"), { company: "CHINA" })).body.results[0];
  assert.notEqual(china.projectId, created.projectId);
  const data = await read();
  assert.equal(data.projects.find((p) => p.id === china.projectId)?.company, "CHINA");
  assert.deepEqual(data.projects.find((p) => p.id === "japan"), initial.projects[0]);
  const imported = data.issuedInvoices.filter((i) => i.invoiceNumber.startsWith("AUTO-"));
  assert.equal(imported.length, 6);
  assert.ok(imported.every((i) => i.status === "DRAFT" && i.needsReview && i.taxTotal === 0 && i.fileUrl));
  for (const item of imported) assert.equal(data.projects.find((p) => p.id === item.projectId)?.clientId, item.clientId);
  await writeFile(path.join(path.dirname(dataPath), "auto-drop.pdf"), await pdf("AUTO-BROWSER", "Browser drop project", "Browser customer"));
  console.log("PASS: actual PDF automatic matching, creation, reuse, manual override, company/role isolation, duplicates and concurrent import; existing projects unchanged.");
}
void main();
