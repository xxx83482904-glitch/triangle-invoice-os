import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AppData } from "../src/lib/types";

// Run from the isolated production build with DATA_DIR from prepare-mail-processing-preview.ts.
// The preview stays intact: all Server Action writes use a fresh disposable copy.
async function main() {
  const preview = path.resolve(process.env.DATA_DIR || "missing"), root = process.cwd();
  assert.equal(path.dirname(preview).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(preview), /^triangle-mail-processing-preview-/);
  const initial = await readFile(path.join(preview, "app-data.json"), "utf8");
  assert.ok((JSON.parse(initial) as AppData).users.some((row) => row.email === "admin@example.invalid"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "triangle-mail-processing-check-"));
  await writeFile(path.join(dataDir, "app-data.json"), initial);
  const read = async () => JSON.parse(await readFile(path.join(dataDir, "app-data.json"), "utf8")) as AppData;
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(name))), NODE_ENV: "production" };
  let port: number | undefined;
  for (let candidate = 3070; candidate < 3100; candidate++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer(); server.once("error", () => resolve(false));
      server.listen(candidate, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) { port = candidate; break; }
  }
  assert.ok(port, "No free local preview port");
  Object.assign(env, { NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir, UPLOAD_DIR: path.join(preview, "uploads"), SESSION_COOKIE_SECURE: "false", SESSION_SECRET: randomBytes(48).toString("hex"), NEXT_TELEMETRY_DISABLED: "1" });
  await access(".next/standalone/server.js"); await access(".next/standalone/.next/static"); await access(".next/standalone/public");
  const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
  const require = createRequire(import.meta.url);
  const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node") as { encodeReply: (args: unknown[]) => Promise<string | FormData> };
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [".next/standalone/server.js"], { cwd: root, env, windowsHide: true, stdio: "ignore" });
  const get = (url: string, cookie = "") => fetch(base + url, { headers: { Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  const call = async (name: string, args: unknown[], cookie = "") => {
    const id = Object.entries(manifest.node).find(([, row]) => row.exportedName === name)?.[0]; assert.ok(id, name);
    return fetch(base + (name === "loginAction" ? "/login" : "/mail-sorter?company=JAPAN"), { method: "POST", body: await encodeReply(args), headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  };
  const login = async (email: string) => {
    const form = new FormData(); form.set("email", email); form.set("password", "local-banking-test-only");
    const response = await call("loginAction", [{ error: "" }, form]);
    const cookie = response.headers.getSetCookie().find((row) => row.startsWith("triangle-session="))?.split(";")[0];
    await response.text(); assert.ok(cookie, "Synthetic login must succeed"); return cookie;
  };
  const save = async (edits: unknown[], cookie: string) => {
    const form = new FormData(); form.set("changes", JSON.stringify(edits));
    return (await call("saveMailSorterBulkEdits", [form], cookie)).text();
  };
  const mailEdit = (data: AppData, id: string, processingStatus: string) => {
    const mail = data.mailDocuments.find((row) => row.id === id)!;
    const invoice = data.receivedInvoices.find((row) => row.id === mail.relatedReceivedInvoiceId);
    return { mailDocumentId: mail.id, receivedInvoiceId: invoice?.id, mailUpdatedAt: mail.updatedAt, invoiceUpdatedAt: invoice?.updatedAt, processingStatus };
  };
  const expectProcessing = (html: string, rowId: string, status: "processed" | "unprocessed") => {
    const row = (html.match(/<tr\b[\s\S]*?<\/tr>/g) || []).find((item) => item.includes(`data-selection-id="${rowId}"`));
    assert.ok(row, rowId);
    const select = row.match(/<select[^>]*aria-label="処理状態"[\s\S]*?<\/select>/)?.[0];
    assert.ok(select?.includes(`<option value="${status}" selected=""`), `${rowId}: ${status}`);
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error("Standalone exited before readiness");
      try { if ((await get("/login")).status === 200) { ready = true; break; } } catch { /* wait for startup */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Standalone readiness timeout");
    assert.equal((await get("/mail-sorter")).status, 307);
    const admin = await login("admin@example.invalid"), mailEditor = await login("mail_editor@example.invalid"), guest = await login("guest@example.invalid");
    const original = await read(), financial = (data: AppData) => JSON.stringify([data.payments, data.bankTransactions, data.bankReconciliations, data.receivedInvoices.map(({ id, status, total, paidAt }) => ({ id, status, total, paidAt }))]);
    const html = await (await get("/mail-sorter?company=JAPAN", admin)).text();
    assert.ok(html.includes("支払状況とは連動しません")); assert.ok(html.includes('aria-label="処理状態"'));
    expectProcessing(html, "mail-mail-paid-unprocessed", "unprocessed");
    expectProcessing(html, "mail-mail-scheduled-processed", "processed");
    expectProcessing(html, "invoice-standalone-invoice", "unprocessed");
    await writeFile(path.join(dataDir, "mail-sorter-before.html"), html);
    const before = await read(), edit = mailEdit(before, "mail-paid-unprocessed", "processed");
    assert.match(await save([edit], guest), /"ok":false/); assert.deepEqual(await read(), before);
    await save([edit], ""); assert.deepEqual(await read(), before);
    assert.match(await save([edit], mailEditor), /"ok":true/);
    let current = await read();
    assert.equal(current.mailDocuments[0].mailProcessed, true); assert.equal(current.receivedInvoices[0].mailProcessed, true);
    assert.equal(financial(current), financial(original));
    assert.ok(current.auditLogs.some((row) => row.action === "SAVE_MAIL_SORTER_BULK_EDITS" && row.userId === "mail-editor" && row.beforeStateJson));
    const savedPage = await get("/mail-sorter?company=JAPAN", mailEditor); assert.equal(savedPage.status, 200);
    expectProcessing(await savedPage.text(), "mail-mail-paid-unprocessed", "processed");
    const successful = structuredClone(current);
    assert.match(await save([{ ...edit, processingStatus: "unprocessed" }], admin), /"ok":false/); assert.deepEqual(await read(), successful);
    assert.match(await save([mailEdit(current, "unlinked-notice", "processed"), { mailDocumentId: "missing", processingStatus: "processed" }], admin), /"ok":false/); assert.deepEqual(await read(), successful);
    assert.match(await save([{ ...mailEdit(current, "unlinked-notice", "processed"), processingStatus: "invalid" }], admin), /"ok":false/); assert.deepEqual(await read(), successful);
    assert.match(await save([mailEdit(current, "mail-paid-unprocessed", "unprocessed")], admin), /"ok":true/);
    current = await read();
    assert.equal(current.receivedInvoices[0].status, "PAID"); assert.equal(current.receivedInvoices[0].mailProcessed, false);
    assert.match(await save([mailEdit(current, "unlinked-notice", "processed"), { receivedInvoiceId: "standalone-invoice", invoiceUpdatedAt: current.receivedInvoices.at(-1)!.updatedAt, processingStatus: "processed" }], admin), /"ok":true/);
    current = await read(); assert.equal(current.mailDocuments.at(-1)!.mailProcessed, true); assert.equal(current.receivedInvoices.at(-1)!.mailProcessed, true);
    assert.match(await save([{ mailDocumentId: "unlinked-notice", mailUpdatedAt: current.mailDocuments.at(-1)!.updatedAt, category: "OTHER" }], admin), /"ok":true/);
    current = await read(); assert.equal(current.mailDocuments.at(-1)!.category, "OTHER"); assert.equal(current.mailDocuments.at(-1)!.mailProcessed, true);
    assert.equal(financial(current), financial(original));
    const pages: string[] = [];
    for (const page of ["mail-sorter", "received-invoices", "documents", "dashboard", "banking/integrity"]) {
      const response = await get(`/${page}?company=JAPAN`, admin); assert.equal(response.status, 200);
      const content = await response.text(); assert.ok(content.includes("合成"), page);
      if (page === "mail-sorter") {
        expectProcessing(content, "mail-mail-paid-unprocessed", "unprocessed");
        expectProcessing(content, "mail-unlinked-notice", "processed");
        expectProcessing(content, "invoice-standalone-invoice", "processed");
      }
      await writeFile(path.join(dataDir, page.replaceAll("/", "-") + ".html"), content); pages.push(page);
    }
    const reportResponse = await get("/api/banking/integrity?company=JAPAN&kind=mail_processing_mismatch", admin);
    assert.equal(reportResponse.status, 200);
    const report = await reportResponse.json();
    assert.equal(report.counts.payment_mismatch, 0); assert.equal(report.issues.length, 3);
    assert.ok(report.issues.every((row: { severity: string }) => row.severity === "INFO"));
    const staticPath = html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1]; assert.ok(staticPath);
    assert.equal((await get(staticPath.replaceAll("&amp;", "&"))).status, 200);
    assert.equal(await readFile(path.join(preview, "app-data.json"), "utf8"), initial);
    const result = { port, pages, syntheticLogin: "admin/mail_editor/guest passed", actions: "save/reload, authorization, stale version, atomic rejection, invalid input, category-only passed", paymentAndBankDataUnchanged: true, audit: true, paymentMismatch: 0, mailReferenceIssues: 3, previewUnchanged: true, visualChecks: "Claude担当: PC/tablet/mobile × light/dark; not run here" };
    await writeFile(path.join(dataDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ dataDir, ...result }));
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    console.log("Stopped only the standalone process started for this check.");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
