import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { PayrollSummary } from "../src/lib/payroll-summary";
import type { PayrollSettingsView, PayrollSettingsInput } from "../src/lib/payroll-settings";
import type { AppData } from "../src/lib/types";

// Run from the isolated production build with DATA_DIR from prepare-payroll-preview.ts.
// The preview stays intact: login, mutations and HTTP checks use a disposable synthetic copy.
async function main() {
  const preview = path.resolve(process.env.DATA_DIR || "missing"), root = process.cwd();
  assert.equal(path.dirname(preview).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(preview), /^triangle-payroll-preview-/);
  const initial = await readFile(path.join(preview, "app-data.json"), "utf8");
  assert.ok((JSON.parse(initial) as AppData).users.some((row) => row.email === "admin@example.invalid"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "triangle-payroll-check-"));
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
    return fetch(base + (name === "loginAction" ? "/login" : "/banking/payroll?company=JAPAN"), { method: "POST", body: await encodeReply(args), headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) });
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


  const htmlFor = async (url: string, file: string, cookie: string) => {
    const response = await get(url, cookie); assert.equal(response.status, 200);
    const html = await response.text(); await writeFile(path.join(dataDir, file + ".html"), html); return html;
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error("Standalone exited before readiness");
      try { if ((await get("/login")).status === 200) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    const route = "/banking/payroll?company=JAPAN";
    assert.equal((await get(route)).status, 307);
    const admin = await login("admin@example.invalid"), accounting = await login("accounting@example.invalid"), editor = await login("mail_editor@example.invalid");
    assert.equal((await get(route, editor)).status, 307);
    assert.equal((await get("/banking/payroll?company=CHINA", admin)).status, 307);
    const initialData = await read();
    const view = async (stage: string, expectedYear: number, expectedTotal: number, cookie = admin, year?: string) => {
      const html = await htmlFor(route + (year === undefined ? "" : "&year=" + encodeURIComponent(year)), stage, cookie);
      const props = propsFrom(html, "yearSource") as { summary: PayrollSummary; settings: PayrollSettingsView; yearSource: string; years: number[] };
      assert.equal(props.summary.year, expectedYear); assert.equal(props.summary.total, expectedTotal);
      const checked = [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes('name="categoryIds"') && /\bchecked(?:=|\s|>)/.test(tag)).map((tag) => tag.match(/value="([^"]*)"/)![1]).sort();
      assert.deepEqual(checked, [...props.settings.categoryIds].sort());
      return { html, ...props };
    };
    const first = await view("initial", 2026, 1290000);
    assert.equal(first.yearSource, "LATEST_PAYROLL"); assert.equal(first.settings.mode, "DEFAULT"); assert.equal(first.summary.categoryIds.length, 6);
    assert.ok(!first.summary.rows.some((row) => /税理士|社労士|税務署|年金|福利|区役所/.test(row.payee)));
    assert.ok(first.summary.rows.some((row) => row.payee === "合成ミドリ"));
    assert.match(plain(first.html), /初期対象/);
    const direct = await view("direct-url", 2025, 200000, admin, "2025"); assert.equal(direct.yearSource, "URL");
    const beforePreference = JSON.stringify(await read());
    const remember = async (year: number, cookie: string) => {
      const response = await call("rememberPayrollYearAction", ["JAPAN", year], cookie);
      assert.match(await response.text(), /"success":true/);
      const value = response.headers.getSetCookie().find((row) => row.startsWith("triangle-payroll-year-")); assert.ok(value);
      assert.match(value, /Path=\/banking\/payroll/i); assert.match(value, /HttpOnly/i); assert.match(value, /SameSite=lax/i);
      return cookie + "; " + value.split(";")[0];
    };
    const adminRemembered = await remember(2025, admin);
    assert.equal((await view("remembered", 2025, 200000, adminRemembered)).yearSource, "REMEMBERED");
    await view("url-over-memory", 2026, 1290000, adminRemembered, "2026");
    await view("memory-unchanged-by-url", 2025, 200000, adminRemembered);
    await view("different-user", 2026, 1290000, accounting + "; " + adminRemembered.split("; ").at(-1));
    const accountingRemembered = await remember(2024, accounting);
    await view("accounting-memory", 2024, 190000, accountingRemembered);
    await view("admin-memory-isolated", 2025, 200000, adminRemembered);
    await view("invalid-url-fallback", 2025, 200000, adminRemembered, "invalid");
    await view("invalid-cookie-fallback", 2026, 1290000, admin + "; triangle-payroll-year-admin-JAPAN=invalid");
    for (const args of [["JAPAN", 9999], ["CHINA", 2025], ["JAPAN", 2025.5]]) {
      const response = await call("rememberPayrollYearAction", args, admin);
      assert.match(await response.text(), /"success":false/); assert.equal(response.headers.getSetCookie().length, 0);
    }
    assert.match(await (await call("rememberPayrollYearAction", ["JAPAN", 2025], editor)).text(), /"success":false/);
    assert.equal(JSON.stringify(await read()), beforePreference);
    const save = async (input: PayrollSettingsInput, cookie = admin, company = "JAPAN") => (await call("savePayrollSettingsAction", [company, input], cookie)).text();
    const selection = { mode: "CUSTOM" as const, categoryIds: ["officer"], updatedAt: "" };
    assert.match(await save(selection, editor), /"success":false/);
    assert.match(await save(selection, admin, "CHINA"), /"success":false/);
    assert.equal(JSON.stringify(await read()), beforePreference);
    assert.match(await save(selection), /"success":true/);
    const officer = await view("officer-only", 2026, 400000, adminRemembered, "2026");
    assert.equal(officer.settings.mode, "CUSTOM"); assert.deepEqual(officer.settings.categoryIds, ["officer"]);
    const savedBytes = JSON.stringify(await read());
    assert.match(await save(selection), /"success":false/);
    assert.match(await save({ ...selection, updatedAt: officer.settings.updatedAt, categoryIds: ["unknown"] }), /"success":false/);
    assert.match(await save({ ...selection, updatedAt: officer.settings.updatedAt, categoryIds: ["salary", "salary"] }), /"success":false/);
    assert.equal(JSON.stringify(await read()), savedBytes);
    assert.match(await save({ mode: "CUSTOM", categoryIds: [], updatedAt: officer.settings.updatedAt }, accountingRemembered), /"success":true/);
    const empty = await view("empty-targets", 2026, 0, admin, "2026");
    assert.equal(empty.settings.mode, "CUSTOM"); assert.deepEqual(empty.summary.categoryIds, []);
    assert.match(plain(empty.html), /この年度に対象科目が付いた明細はありません/);
    assert.match(await save({ mode: "CUSTOM", categoryIds: ["fee"], updatedAt: empty.settings.updatedAt }), /"success":true/);
    const external = await view("explicit-external", 2026, 75000, admin, "2026");
    await view("new-default-year-after-target-change", 2027, 60000);
    assert.match(await save({ mode: "DEFAULT", updatedAt: external.settings.updatedAt }), /"success":true/);
    const restored = await view("reset-defaults", 2026, 1290000);
    assert.equal(restored.settings.mode, "DEFAULT"); await view("remembered-year-after-reset", 2025, 200000, adminRemembered);
    const final = await read();
    assert.equal(final.auditLogs.length - initialData.auditLogs.length, 4);
    for (const log of final.auditLogs.slice(0, 4)) {
      assert.equal(log.action, "SAVE_PAYROLL_SETTINGS");
      assert.ok(JSON.stringify(log.beforeStateJson).includes('"collection":"payrollSettings"'));
    }
    const strip = (data: AppData) => { const copy = structuredClone(data); delete copy.payrollSettings; copy.auditLogs = []; return copy; };
    assert.deepEqual(strip(final), strip(initialData));
    const staticPath = first.html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1]; assert.ok(staticPath);
    assert.equal((await get(staticPath.replaceAll("&amp;", "&"))).status, 200);
    const integrityResponse = await get("/api/banking/integrity?company=JAPAN", admin); assert.equal(integrityResponse.status, 200);
    await writeFile(path.join(dataDir, "integrity.json"), JSON.stringify(await integrityResponse.json(), null, 2));
    assert.equal(await readFile(path.join(preview, "app-data.json"), "utf8"), initial);
    const result = { port, defaultYear: 2026, defaultTotal: 1290000, defaultCategoryCount: 6, customOfficerTotal: 400000, explicitFeeTotal: 75000,
      emptyTargetsPersisted: true, resetDefaults: true, cookieMemoryAndUserIsolation: true, urlPriority: true, preferencesDoNotWriteData: true,
      permissionsAndStaleRejected: true, auditCount: 4, sourceDataUnchanged: true, previewUnchanged: true,
      visualChecks: "Claude担当: チェックの実クリック、保存通知、年度切替とPC/tablet/mobile x light/darkは未確認" };
    await writeFile(path.join(dataDir, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ dataDir, ...result }));
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    console.log("Stopped only the standalone process started for this check.");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
