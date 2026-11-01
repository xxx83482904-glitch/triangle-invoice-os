import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { ObligationSummary } from "../src/lib/tax-obligations";
import type { ObligationMutation } from "../src/lib/obligation-edits";
import type { AppData } from "../src/lib/types";

// Run from the isolated production build with DATA_DIR from prepare-obligations-preview.ts.
// The preview stays intact: login, mutations and HTTP checks use a disposable synthetic copy.
async function main() {
  const preview = path.resolve(process.env.DATA_DIR || "missing"), root = process.cwd();
  assert.equal(path.dirname(preview).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(preview), /^triangle-obligations-preview-/);
  const initial = await readFile(path.join(preview, "app-data.json"), "utf8");
  assert.ok((JSON.parse(initial) as AppData).users.some((row) => row.email === "admin@example.invalid"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "triangle-obligations-check-"));
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
    return fetch(base + (name === "loginAction" ? "/login" : "/banking/obligations?company=JAPAN"), { method: "POST", body: await encodeReply(args), headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) });
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
  const financial = (data: AppData) => ({ received: data.receivedInvoices, mail: data.mailDocuments, payments: data.payments, banks: data.bankTransactions, reconciliations: data.bankReconciliations, projects: data.projects });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error("Standalone exited before readiness");
      try { if ((await get("/login")).status === 200) { ready = true; break; } } catch { /* startup */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    const route = "/banking/obligations?company=JAPAN";
    const anonymous = await get(route); assert.equal(anonymous.status, 307); assert.ok(anonymous.headers.get("location")?.includes("/login"));
    const admin = await login("admin@example.invalid"), accounting = await login("accounting@example.invalid"), editor = await login("mail_editor@example.invalid");
    const denied = await get(route, editor); assert.equal(denied.status, 307); assert.equal(denied.headers.get("location"), "/mail-sorter");
    const foreign = await get("/banking/obligations?company=CHINA", admin); assert.equal(foreign.status, 307);
    const before = await read();
    const summaryFor = async (stage: string, expectedCount: number, expectedAmount: number, expectedExcluded: number, cookie = admin) => {
      const html = await htmlFor(route, stage, cookie), summary = propsFrom(html, "manualInactive") as unknown as ObligationSummary;
      assert.equal(summary.items.length, expectedCount); assert.equal(summary.outstandingTotal, expectedAmount); assert.equal(summary.excluded.length, expectedExcluded);
      const visibleIds = [...html.matchAll(/data-obligation-id="([^"]+)"/g)].map((match) => match[1]).sort();
      assert.deepEqual(visibleIds, summary.items.map((row) => row.id).sort());
      for (const id of ["received:gas", "received:delivery", "received:none", "mail:mail-gas"]) assert.ok(!visibleIds.includes(id));
      return { html, summary };
    };
    const initialView = await summaryFor("initial", 6, 33400, 1);
    assert.match(plain(initialView.html), /名前による推定/); assert.match(plain(initialView.html), /支払先の区分/); assert.match(plain(initialView.html), /手入力（書類なし）/);
    assert.match(plain(initialView.html), /対象外 1件/);
    assert.match(initialView.html, /<details[^>]*><summary[^>]*>対象外/);
    const partners = await htmlFor("/partners?company=JAPAN&tab=vendors", "partners", admin);
    assert.match(plain(partners), /税金・社会保険の区分/); assert.ok(partners.includes('name="obligationKind"'));
    await summaryFor("accounting", 6, 33400, 1, accounting);
    const stateAfterReads = await read(); assert.deepEqual(financial(stateAfterReads), financial(before));
    const save = async (input: ObligationMutation, cookie = admin, company = "JAPAN") => (await call("saveObligationAction", [company, input], cookie)).text();
    const vendorInput = { id: "gas", updatedAt: before.vendors.find((row) => row.id === "gas")!.updatedAt, obligationKind: "NONE" };
    assert.match(await (await call("saveVendorObligationKindAction", ["JAPAN", vendorInput], accounting)).text(), /"success":true/);
    assert.equal((await read()).vendors.find((row) => row.id === "gas")!.obligationKind, "NONE");
    const afterVendor = JSON.stringify(await read());
    assert.match(await (await call("saveVendorObligationKindAction", ["JAPAN", vendorInput], admin)).text(), /"success":false/);
    assert.equal(JSON.stringify(await read()), afterVendor);
    const tax = initialView.summary.items.find((row) => row.id === "received:tax")!;
    const exclude = { action: "exclude" as const, id: tax.id, version: tax.version, reason: "合成HTTP検証の対象外判断" };
    assert.match(await save({ ...exclude, reason: " " }), /"success":false/);
    assert.match(await save(exclude, editor), /"success":false/);
    assert.match(await save(exclude, admin, "CHINA"), /"success":false/);
    assert.equal(JSON.stringify(await read()), afterVendor);
    assert.match(await save(exclude), /"success":true/);
    const excluded = await summaryFor("excluded", 5, 23400, 2);
    assert.ok(excluded.summary.excluded.some((row) => row.reason === exclude.reason && row.createdById === "admin"));
    const afterExclude = JSON.stringify(await read());
    assert.match(await save(exclude), /"success":false/); assert.equal(JSON.stringify(await read()), afterExclude);
    const decision = excluded.summary.excluded.find((row) => row.targetId === tax.id)!;
    assert.match(await save({ action: "restoreExclusion", id: decision.id, version: decision.updatedAt, reason: "合成税金として復元" }), /"success":true/);
    await summaryFor("restored", 6, 33400, 1);
    const validCreate = { action: "create" as const, title: "合成HTTP加算金", party: "合成南都税事務所", amount: 3400, dueDate: "", memo: "書類なしの合成検証" };
    const beforeInvalid = JSON.stringify(await read());
    assert.match(await save({ ...validCreate, title: "" }), /"success":false/); assert.match(await save({ ...validCreate, amount: 0 }), /"success":false/);
    assert.equal(JSON.stringify(await read()), beforeInvalid);
    assert.match(await save(validCreate, accounting), /"success":true/);
    await summaryFor("manual-created", 7, 36800, 1);
    const manual = (await read()).manualObligations!.find((row) => row.title === validCreate.title)!;
    assert.equal(manual.createdById, "accounting"); assert.equal(manual.dueDate, "");
    assert.match(await save({ action: "pay", id: manual.id, version: manual.updatedAt, reason: "合成支払確認", paymentDate: "2026-10-30" }), /"success":true/);
    await summaryFor("manual-paid", 6, 33400, 1);
    const afterPay = JSON.stringify(await read());
    assert.match(await save({ action: "pay", id: manual.id, version: manual.updatedAt, reason: "二重送信", paymentDate: "2026-10-30" }), /"success":false/); assert.equal(JSON.stringify(await read()), afterPay);
    for (const [action, expectedCount, expectedAmount] of [["reopen", 7, 36800], ["cancel", 6, 33400], ["restoreManual", 7, 36800]] as const) {
      const current = (await read()).manualObligations!.find((row) => row.id === manual.id)!;
      assert.match(await save({ action, id: manual.id, version: current.updatedAt, reason: "合成理由付き操作" }), /"success":true/);
      await summaryFor("manual-" + action, expectedCount, expectedAmount, 1);
    }
    const mail = (await summaryFor("before-mail-exclusion", 7, 36800, 1)).summary.items.find((row) => row.id === "mail:mail-tax")!;
    assert.match(await save({ action: "exclude", id: mail.id, version: mail.version, reason: "合成郵便物の対象外判断" }), /"success":true/);
    await summaryFor("mail-excluded", 6, 36800, 2);
    const vendorForm = new FormData(); vendorForm.set("company", "JAPAN"); vendorForm.set("companyName", "合成新規納付先"); vendorForm.set("obligationKind", "SOCIAL_INSURANCE");
    const createdVendor = await call("createVendor", [vendorForm], admin); assert.equal(createdVendor.status, 200); await createdVendor.text();
    const final = await read(); assert.equal(final.vendors.find((row) => row.companyName === "合成新規納付先")!.obligationKind, "SOCIAL_INSURANCE");
    assert.equal(final.auditLogs.length - before.auditLogs.length, 10);
    assert.ok(final.auditLogs.filter((row) => row.action.endsWith("_OBLIGATION") || row.action === "EXCLUDE_OBLIGATION").every((row) => row.beforeStateJson));
    assert.ok(final.auditLogs.some((row) => JSON.stringify(row.beforeStateJson).includes('"collection":"obligationExclusions"')));
    assert.ok(final.auditLogs.some((row) => JSON.stringify(row.beforeStateJson).includes('"collection":"manualObligations"')));
    assert.deepEqual(financial(final), financial(before));
    const manualFinal = final.manualObligations!.find((row) => row.id === manual.id)!;
    assert.deepEqual(manualFinal.history.map((row) => row.action), ["CREATE", "PAY", "REOPEN", "CANCEL", "RESTORE"]);
    const integrityResponse = await get("/api/banking/integrity?company=JAPAN", admin); assert.equal(integrityResponse.status, 200);
    await writeFile(path.join(dataDir, "integrity.json"), JSON.stringify(await integrityResponse.json(), null, 2));
    const staticPath = initialView.html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1]; assert.ok(staticPath);
    assert.equal((await get(staticPath.replaceAll("&amp;", "&"))).status, 200);
    assert.equal(await readFile(path.join(preview, "app-data.json"), "utf8"), initial);
    const result = { port, initial: { count: 6, outstanding: 33400, excluded: 1 }, ordinaryVendorsExcluded: true, inferredLabel: true, vendorCreateAndUpdate: true,
      excludeRestore: true, manualCreatePayReopenCancelRestore: true, permissionsAndStaleRejected: true, auditCount: 10,
      accountingSourceRowsUnchanged: true, previewUnchanged: true, integrityJson: 200,
      visualChecks: "Claude担当: PC/tablet/mobile x light/dark、実クリックと成功/失敗表示は未確認" };
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
