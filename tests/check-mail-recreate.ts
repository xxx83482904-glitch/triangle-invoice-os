import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AppData } from "../src/lib/types";

// Run from the isolated production build with DATA_DIR from prepare-mail-recreate-preview.ts.
// The preview stays intact: all Server Action writes use a fresh disposable copy.
async function main() {
  const preview = path.resolve(process.env.DATA_DIR || "missing"), root = process.cwd();
  assert.equal(path.dirname(preview).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(preview), /^triangle-mail-recreate-preview-/);
  const initial = await readFile(path.join(preview, "app-data.json"), "utf8");
  assert.ok((JSON.parse(initial) as AppData).users.some((row) => row.email === "admin@example.invalid"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "triangle-mail-recreate-check-"));
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
  const reflect = async (fields: Record<string, string>, cookie: string) => {
    const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return (await call("reflectMailDocumentToReceivedInvoice", [form], cookie)).text();
  };
  const fields = (data: AppData, id: string, extra: Record<string, string> = {}) => {
    const mail = data.mailDocuments.find((row) => row.id === id)!;
    return { mailDocumentId: id, mailUpdatedAt: mail.updatedAt, ...extra };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error("Standalone exited before readiness");
      try { if ((await get("/login")).status === 200) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    const admin = await login("admin@example.invalid"), mailEditor = await login("mail_editor@example.invalid");
    const response = await get("/mail-sorter?company=JAPAN", admin); assert.equal(response.status, 200);
    const html = await response.text(); await writeFile(path.join(dataDir, "mail-sorter-before.html"), html);
    // Inspect server-rendered RSC props for every row, including editors hidden until clicked.
    const chunks = [...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)].map((match) => JSON.parse(match[1])[1]).filter((chunk) => typeof chunk === "string").join("");
    const defaults = [...chunks.matchAll(/"reflectDefaults":(\{[^{}]*\})/g)].map((match) => JSON.parse(match[1]));
    const a = { vendorId: "vendor-a", projectId: "project-a", issueDate: "2026-09-10", dueDate: "2026-10-10", total: "12300", status: "REVIEWING" };
    const b = { vendorId: "vendor-b", projectId: "project-b", issueDate: "2026-10-05", dueDate: "2026-11-20", total: "45600", status: "REVIEWING" };
    const c = { vendorId: "", projectId: "", issueDate: "", dueDate: "", total: "", status: "REVIEWING" };
    const d = { ...c, vendorId: "vendor-b", projectId: "project-b", issueDate: "2026-08-12", total: "7800" };
    assert.deepEqual(defaults, [a, b, c, d]);
    const before = await read();
    assert.match(await reflect(fields(before, "mail-c", c), admin), /"ok":false/); assert.deepEqual(await read(), before);
    assert.match(await reflect(fields(before, "mail-c", { ...c, vendorId: "vendor-b" }), admin), /案件を選択/); assert.deepEqual(await read(), before);
    await reflect(fields(before, "mail-a", a), ""); assert.deepEqual(await read(), before);
    assert.match(await reflect(fields(before, "mail-a", a), admin), /"ok":true/);
    let current = await read(); const saved = structuredClone(current);
    assert.match(await reflect(fields(before, "mail-a", a), admin), /"ok":false/); assert.deepEqual(await read(), saved);
    assert.match(await reflect(fields(current, "mail-a", a), admin), /連携済み/); assert.deepEqual(await read(), saved);
    assert.match(await reflect(fields(current, "mail-b", { ...b, issueDate: "2026-02-30" }), mailEditor), /実在する日付/); assert.deepEqual(await read(), saved);
    assert.match(await reflect(fields(current, "mail-b", b), mailEditor), /"ok":true/);
    current = await read();
    assert.match(await reflect(fields(current, "mail-c", { ...c, vendorId: "vendor-b", projectId: "project-b" }), admin), /"ok":true/);
    current = await read();
    for (const [id, expected] of [["mail-a", a], ["mail-b", b], ["mail-c", { ...c, vendorId: "vendor-b", projectId: "project-b" }]] as const) {
      const mail = current.mailDocuments.find((row) => row.id === id)!;
      const invoice = current.receivedInvoices.find((row) => row.id === mail.relatedReceivedInvoiceId)!;
      assert.equal(invoice.vendorId, expected.vendorId); assert.equal(invoice.projectId, expected.projectId);
      assert.equal(invoice.issueDate, expected.issueDate); assert.equal(invoice.dueDate, expected.dueDate); assert.equal(invoice.total, Number(expected.total));
      assert.equal(invoice.originalFileName, mail.originalFileName); assert.equal(mail.mailProcessed, before.mailDocuments.find((row) => row.id === id)!.mailProcessed);
    }
    assert.deepEqual(current.receivedInvoices.filter((row) => row.deletedAt), before.receivedInvoices);
    assert.deepEqual(current.payments, before.payments); assert.deepEqual(current.bankTransactions, before.bankTransactions); assert.deepEqual(current.bankReconciliations, before.bankReconciliations);
    assert.equal(current.auditLogs.filter((row) => row.action === "REFLECT_MAIL_DOCUMENT_TO_RECEIVED_INVOICE" && row.beforeStateJson).length, 3);
    const pages = [];
    for (const page of ["mail-sorter", "received-invoices", "documents", "dashboard", "banking/integrity"]) {
      const pageResponse = await get("/" + page + "?company=JAPAN", admin); assert.equal(pageResponse.status, 200);
      await writeFile(path.join(dataDir, page.replaceAll("/", "-") + ".html"), await pageResponse.text()); pages.push(page);
    }
    const api = await get("/api/banking/integrity?company=JAPAN", admin); assert.equal(api.status, 200);
    const report = await api.json(); assert.equal(report.counts.payment_mismatch, 0);
    const staticPath = html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1]; assert.ok(staticPath);
    assert.equal((await get(staticPath.replaceAll("&amp;", "&"))).status, 200);
    assert.equal(await readFile(path.join(preview, "app-data.json"), "utf8"), initial);
    const result = { port, pages, defaults, actions: "required errors, optional blank save, stale replay, duplicate link, invalid dates, A/B recreation passed", auditCount: 3, originalFinancialDataUnchanged: true, paymentMismatch: 0, previewUnchanged: true, visualChecks: "Claude担当: A→B→C form switching and PC/tablet/mobile × light/dark not run here" };
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
