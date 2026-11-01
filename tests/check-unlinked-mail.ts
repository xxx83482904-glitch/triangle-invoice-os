import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { requiredMailIds } from "./unlinked-mail-fixture";
import type { AppData } from "../src/lib/types";

// Run from the isolated production build with DATA_DIR from prepare-unlinked-mail-preview.ts.
// The preview stays intact: login and read-only HTTP checks use a disposable synthetic copy.
async function main() {
  const preview = path.resolve(process.env.DATA_DIR || "missing"), root = process.cwd();
  assert.equal(path.dirname(preview).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(preview), /^triangle-unlinked-mail-preview-/);
  const initial = await readFile(path.join(preview, "app-data.json"), "utf8");
  assert.ok((JSON.parse(initial) as AppData).users.some((row) => row.email === "admin@example.invalid"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "triangle-unlinked-mail-check-"));
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
    return fetch(base + (name === "loginAction" ? "/login" : "/mail-sorter?company=JAPAN&link=required"), { method: "POST", body: await encodeReply(args), headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) });
  };
  const login = async (email: string) => {
    const form = new FormData(); form.set("email", email); form.set("password", "local-banking-test-only");
    const response = await call("loginAction", [{ error: "" }, form]);
    const cookie = response.headers.getSetCookie().find((row) => row.startsWith("triangle-session="))?.split(";")[0];
    await response.text(); assert.ok(cookie, "Synthetic login must succeed"); return cookie;
  };
  const propsFrom = (html: string, key: string): Record<string, unknown> => {
    const chunks = [...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)].map((match) => JSON.parse(match[1])[1]).filter((chunk) => typeof chunk === "string").join("");
    const walk = (value: unknown): Record<string, unknown> | undefined => {
      if (!value || typeof value !== "object") return;
      if (!Array.isArray(value) && key in value) return value as Record<string, unknown>;
      for (const nested of Object.values(value)) { const found = walk(nested); if (found) return found; }
    };
    for (const line of chunks.split("\n")) {
      try { const found = walk(JSON.parse(line.slice(line.indexOf(":") + 1), (_key, value) => value === "$undefined" ? undefined : value)); if (found) return found; } catch { /* non-JSON RSC entry */ }
    }
    throw new Error("Missing serialized props: " + key);
  };
  const plain = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");
  type Row = { id: string; mailDocumentId?: string; receivedInvoiceId?: string };
  const financial = (data: AppData) => ({ received: data.receivedInvoices, issued: data.issuedInvoices, payments: data.payments, bankTransactions: data.bankTransactions, bankReconciliations: data.bankReconciliations });
  const saveMail = async (id: string, fields: Record<string, string>, cookie: string, version?: string) => {
    const data = await read(), mail = data.mailDocuments.find((row) => row.id === id)!;
    const form = new FormData(); form.set("changes", JSON.stringify([{ mailDocumentId: id, mailUpdatedAt: version || mail.updatedAt, ...fields }]));
    return (await call("saveMailSorterBulkEdits", [form], cookie)).text();
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error("Standalone exited before readiness");
      try { if ((await get("/login")).status === 200) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    const route = "/mail-sorter?company=JAPAN&link=required";
    const anonymous = await get(route); assert.equal(anonymous.status, 307); assert.ok(anonymous.headers.get("location")?.includes("/login"));
    const admin = await login("admin@example.invalid"), editor = await login("mail_editor@example.invalid"), chief = await login("chief@example.invalid");
    const denied = await get(route, chief); assert.equal(denied.status, 307); assert.equal(denied.headers.get("location"), "/projects");
    const before = await read();
    const htmlFor = async (url: string, file: string, cookie = admin) => {
      const response = await get(url, cookie); assert.equal(response.status, 200);
      const html = await response.text(); await writeFile(path.join(dataDir, file + ".html"), html); return html;
    };
    const checkCount = async (expected: number, stage: string) => {
      const banking = await htmlFor("/banking/reconcile?company=JAPAN&view=checks&checkKind=unlinked_mail", stage + "-reconcile");
      const bankProps = propsFrom(banking, "unlinkedMailCount"); assert.equal(bankProps.unlinkedMailCount, expected);
      const review = bankProps.review as { counts: { unlinked_mail: number }; filteredTotal: number; items: { id: string; links: { href: string }[] }[] };
      assert.equal(review.counts.unlinked_mail, expected); assert.equal(review.filteredTotal, expected);
      const html = await htmlFor(route, stage + "-mail");
      const props = propsFrom(html, "linkRequiredOnly"), rows = props.rows as Row[];
      assert.equal(props.linkRequiredOnly, true); assert.deepEqual(props.folders, []); assert.equal(rows.length, expected);
      assert.ok(rows.every((row) => row.mailDocumentId && !row.receivedInvoiceId));
      assert.deepEqual(rows.map((row) => row.mailDocumentId).sort(), review.items.map((row) => row.id.replace(/^mail:/, "")).sort());
      assert.match(plain(html), new RegExp("受領請求書への連携が必要な郵便物 " + expected + "件"));
      if (expected) {
        assert.match(plain(banking), new RegExp("受領請求書への連携が必要な郵便物が " + expected + "件あります"));
        assert.ok(banking.includes('href="/mail-sorter?company=JAPAN&amp;link=required"'));
        assert.ok(review.items.every((row) => row.links.some((link) => link.href === route)));
      } else {
        assert.ok(!plain(banking).includes("連携が必要な郵便物が"));
        assert.ok(!html.includes('aria-label="郵便物をCSV出力"'));
      }
      return { html, props, rows };
    };
    const initialView = await checkCount(10, "initial");
    assert.deepEqual(initialView.rows.map((row) => row.mailDocumentId).sort(), [...requiredMailIds].sort());
    const csvHref = initialView.html.match(/href="([^" ]*\/api\/export\/ocr-documents[^" ]*)"/)?.[1]?.replaceAll("&amp;", "&");
    assert.ok(csvHref); assert.deepEqual(new URL(base + csvHref).searchParams.get("ids")!.split(",").sort(), requiredMailIds.map((id) => "mail-" + id).sort());
    const csv = await get(csvHref, admin); assert.equal(csv.status, 200);
    const csvText = await csv.text(); assert.ok(csvText.includes("open-invoice.pdf")); assert.ok(!csvText.includes("processed-1.pdf"));
    const allHtml = await htmlFor("/mail-sorter?company=JAPAN", "all-mail");
    const allProps = propsFrom(allHtml, "linkRequiredOnly"), allRows = allProps.rows as Row[];
    assert.equal(allProps.linkRequiredOnly, false);
    for (const id of ["mail-processed-1", "mail-category-NOTICE", "invoice-direct-ocr"]) assert.ok(allRows.some((row) => row.id === id), id);
    const badFilter = propsFrom(await htmlFor("/mail-sorter?company=JAPAN&link=unknown", "unknown-filter"), "linkRequiredOnly");
    assert.equal(badFilter.linkRequiredOnly, false);
    const redirect = await get("/mail-sorter?link=required", admin); assert.equal(redirect.status, 307); assert.equal(redirect.headers.get("location"), route);
    const editorHtml = await htmlFor(route, "mail-editor", editor);
    assert.deepEqual((propsFrom(editorHtml, "linkRequiredOnly").rows as Row[]).map((row) => row.id).sort(), initialView.rows.map((row) => row.id).sort());
    const integrityBeforeResponse = await get("/api/banking/integrity?company=JAPAN", admin); assert.equal(integrityBeforeResponse.status, 200);
    const integrityBefore = await integrityBeforeResponse.json();
    assert.deepEqual(await read(), before);
    assert.match(await saveMail("open-invoice", { processingStatus: "processed" }, editor), /"ok":true/);
    await checkCount(9, "processed");
    const afterProcessed = await read();
    assert.match(await saveMail("open-invoice", { processingStatus: "unprocessed" }, editor, before.mailDocuments.find((row) => row.id === "open-invoice")!.updatedAt), /"ok":false/);
    assert.deepEqual(await read(), afterProcessed);
    const receipt = (await read()).mailDocuments.find((row) => row.id === "open-receipt")!;
    const link = await call("linkMailDocumentAction", ["JAPAN", { mailDocumentId: receipt.id, mailUpdatedAt: receipt.updatedAt, receivedInvoiceId: "live" }], admin);
    assert.match(await link.text(), /"success":true/); await checkCount(8, "linked");
    const category = new FormData(); category.set("mailDocumentId", "duplicate-b"); category.set("category", "NOTICE");
    const categoryResponse = await call("updateMailDocumentCategory", [category], editor); assert.equal(categoryResponse.status, 200); await categoryResponse.text();
    await checkCount(7, "reclassified");
    assert.match(await saveMail("open-invoice", { processingStatus: "unprocessed" }, editor), /"ok":true/);
    await checkCount(8, "reopened");
    const linkedReceipt = (await read()).mailDocuments.find((row) => row.id === "open-receipt")!;
    const unlink = await call("unlinkMailDocumentAction", ["JAPAN", { mailDocumentId: linkedReceipt.id, mailUpdatedAt: linkedReceipt.updatedAt }], admin);
    assert.match(await unlink.text(), /"success":true/); const remaining = await checkCount(9, "unlinked");
    const current = await read(), remainingIds = new Set(remaining.rows.map((row) => row.mailDocumentId));
    const finish = new FormData(); finish.set("changes", JSON.stringify(current.mailDocuments.filter((row) => remainingIds.has(row.id)).map((row) => ({ mailDocumentId: row.id, mailUpdatedAt: row.updatedAt, processingStatus: "processed" }))));
    assert.match(await (await call("saveMailSorterBulkEdits", [finish], editor)).text(), /"ok":true/);
    await checkCount(0, "complete");
    const final = await read(); assert.deepEqual(financial(final), financial(before));
    assert.equal(final.auditLogs.length - before.auditLogs.length, 6);
    const integrityResponse = await get("/api/banking/integrity?company=JAPAN", admin); assert.equal(integrityResponse.status, 200);
    const integrity = await integrityResponse.json();
    const structuralIds = (report: { issues: { id: string; kind: string }[] }) => report.issues.filter((row) => row.kind === "mail_link").map((row) => row.id).sort();
    assert.deepEqual(structuralIds(integrity), structuralIds(integrityBefore));
    await writeFile(path.join(dataDir, "integrity.json"), JSON.stringify(integrity, null, 2));
    const staticPath = initialView.html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1]; assert.ok(staticPath);
    assert.equal((await get(staticPath.replaceAll("&amp;", "&"))).status, 200);
    assert.equal(await readFile(path.join(preview, "app-data.json"), "utf8"), initial);
    const result = { port, initialRequired: 10, requiredIds: requiredMailIds, countsAfterActions: [9, 8, 7, 8, 9, 0],
      listReviewBannerAgreement: true, scopedCsv: true, permissions: "anonymous/chief rejected, mail editor allowed", staleRejected: true,
      auditCount: 6, structuralChecksRetained: true, financialDataUnchanged: true, previewUnchanged: true,
      visualChecks: "Claude担当: navigation/filter reset, processing notifications and PC/tablet/mobile × light/dark not run here" };
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
