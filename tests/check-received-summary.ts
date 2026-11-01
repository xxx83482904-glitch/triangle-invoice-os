import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { filterReceivedInvoices, receivedListTotals, type ReceivedInvoiceListRow } from "../src/lib/received-invoice-list";
import type { AppData } from "../src/lib/types";

// Run from the isolated production build with DATA_DIR from prepare-received-summary-preview.ts.
// The preview stays intact: login and read-only HTTP checks use a disposable synthetic copy.
async function main() {
  const preview = path.resolve(process.env.DATA_DIR || "missing"), root = process.cwd();
  assert.equal(path.dirname(preview).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(preview), /^triangle-received-summary-preview-/);
  const initial = await readFile(path.join(preview, "app-data.json"), "utf8");
  assert.ok((JSON.parse(initial) as AppData).users.some((row) => row.email === "admin@example.invalid"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "triangle-received-summary-check-"));
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
    return fetch(base + (name === "loginAction" ? "/login" : "/received-invoices?company=JAPAN"), { method: "POST", body: await encodeReply(args), headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) });
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
  const section = (html: string) => {
    const match = html.match(/<section aria-label="受領請求書の集計"[\s\S]*?<\/section>/);
    assert.ok(match, "Summary cards are rendered");
    return match[0].replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "");
  };
  type Row = ReceivedInvoiceListRow & { id: string; paymentOutstandingAmount: number };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error("Standalone exited before readiness");
      try { if ((await get("/login")).status === 200) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    const anonymous = await get("/received-invoices?company=JAPAN");
    assert.equal(anonymous.status, 307); assert.ok(anonymous.headers.get("location")?.includes("/login"));
    const admin = await login("admin@example.invalid"), accounting = await login("accounting@example.invalid"), chief = await login("chief@example.invalid");
    const before = await read();
    const htmlFor = async (url: string, file: string, cookie = admin) => {
      const response = await get(url, cookie); assert.equal(response.status, 200);
      const html = await response.text(); await writeFile(path.join(dataDir, file + ".html"), html); return html;
    };
    const html = await htmlFor("/received-invoices?company=JAPAN", "received-unpaid");
    const props = propsFrom(html, "invoices"), rows = props.invoices as Row[];
    assert.equal(rows.length, 13);
    const unpaid = filterReceivedInvoices(rows, "unpaid", "", "2026-11-01"), totals = receivedListTotals(unpaid);
    assert.equal(totals.count, 6); assert.equal(totals.total, 49500); assert.equal(totals.paid, 7000); assert.equal(totals.unpaid, 42500);
    const card = section(html);
    for (const value of ["表示中の絞り込み：未払い", "検索：なし", "期間：全期間（日付なしを含む）", "49,500", "7,000", "42,500", "表示中6件", "支払対象6件", "一部支払を含む", "アーカイブ・却下", "月の折りたたみは集計に影響しません"]) assert.ok(card.includes(value), value);
    const allHtml = await htmlFor("/received-invoices?company=JAPAN&document=archived", "received-all-archived");
    const allCard = section(allHtml);
    for (const value of ["表示中の絞り込み：すべて", "268,500", "44,000", "42,500", "表示中13件", "表示中4件"]) assert.ok(allCard.includes(value), value);
    assert.ok(allHtml.includes("未払い集計対象外（アーカイブ）"));
    assert.equal(rows.find((row) => row.id === "archived")!.paymentOutstandingAmount, 90000);
    assert.equal(rows.find((row) => row.id === "archived")!.unpaidAmount, 0);
    const groupHtml = await htmlFor("/received-invoices?company=JAPAN&document=group-old", "received-all-group");
    assert.ok(groupHtml.includes("未払い集計対象外（債務グループの支払対象外）"));
    const paid = filterReceivedInvoices(rows, "paid", "", "2026-11-01");
    assert.deepEqual(paid.map((row) => row.id).sort(), ["overpaid", "paid"]);
    const searched = receivedListTotals(filterReceivedInvoices(rows, "unpaid", "合成支払先B", "2026-11-01"));
    assert.equal(searched.count, 1); assert.equal(searched.total, 20000); assert.equal(searched.paid, 5000); assert.equal(searched.unpaid, 15000);
    for (const year of ["", "&year=2026"]) {
      const dashboardHtml = await htmlFor("/dashboard?company=JAPAN" + year, year ? "dashboard-2026" : "dashboard");
      const summary = propsFrom(dashboardHtml, "summary").summary as { outgoing: { amount: number; count: number }; payables: { id: string }[] };
      assert.equal(summary.outgoing.amount, totals.unpaid); assert.equal(summary.outgoing.count, totals.count);
      assert.deepEqual(summary.payables.map((row) => row.id.replace(/^received:/, "")).sort(), unpaid.map((row) => row.id).sort());
    }
    const accountingHtml = await htmlFor("/received-invoices?company=JAPAN", "received-accounting", accounting);
    assert.equal(section(accountingHtml), card);
    const chiefHtml = await htmlFor("/received-invoices?company=JAPAN", "received-chief", chief);
    assert.ok(!chiefHtml.includes('aria-label="受領請求書の集計"'));
    const chiefProps = propsFrom(chiefHtml, "invoices"); assert.equal(chiefProps.showTotals, false);
    assert.ok(!(chiefProps.invoices as Row[]).some((row) => row.id === "partial"));
    const api = await get("/api/banking/integrity?company=JAPAN", admin); assert.equal(api.status, 200);
    const integrity = await api.json(); await writeFile(path.join(dataDir, "integrity.json"), JSON.stringify(integrity, null, 2));
    const staticPath = html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1]; assert.ok(staticPath);
    assert.equal((await get(staticPath.replaceAll("&amp;", "&"))).status, 200);
    assert.deepEqual(await read(), before);
    assert.equal(await readFile(path.join(preview, "app-data.json"), "utf8"), initial);
    const result = { port, totals, all: receivedListTotals(rows), search: searched, unpaidIds: unpaid.map((row) => row.id),
      pages: "received unpaid/all/archived/debt group, dashboard current/prior year, accounting/chief passed",
      permissions: "anonymous redirects, chief totals hidden and project scope retained", originalFinancialDataUnchanged: true, previewUnchanged: true,
      visualChecks: "Claude担当: filter/search/month collapse interactions and PC/tablet/mobile × light/dark not run here" };
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
