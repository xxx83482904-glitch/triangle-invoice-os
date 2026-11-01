import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { IntegrityIssue, IntegrityReport, IntegritySummary, IntegrityView } from "../src/lib/integrity-types";
import type { AcknowledgeIntegrityInput } from "../src/lib/integrity-acknowledgements";
import { generateAgentTokenSecret, issueAgentToken } from "../src/lib/agent-tokens";
import type { AppData } from "../src/lib/types";

// Run from the isolated production build with DATA_DIR from prepare-integrity-known-preview.ts.
// The preview stays intact: login, mutations and HTTP checks use a disposable synthetic copy.
async function main() {
  const preview = path.resolve(process.env.DATA_DIR || "missing"), root = process.cwd();
  assert.equal(path.dirname(preview).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.match(path.basename(preview), /^triangle-integrity-known-preview-/);
  const initial = await readFile(path.join(preview, "app-data.json"), "utf8");
  assert.ok((JSON.parse(initial) as AppData).users.some((row) => row.email === "admin@example.invalid"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "triangle-integrity-known-check-"));
  const seeded = JSON.parse(initial) as AppData, agentSecret = generateAgentTokenSecret(), bankSecret = generateAgentTokenSecret();
  for (const [secret, scope] of [[agentSecret, "integrity:read"], [bankSecret, "bank:read"]] as const) issueAgentToken(seeded, seeded.users.find((row) => row.id === "admin")!, { name: "synthetic-http", scopes: [scope], expiresInDays: 1, hash: secret.hash, prefix: secret.prefix });
  await writeFile(path.join(dataDir, "app-data.json"), JSON.stringify(seeded));
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
    return fetch(base + (name === "loginAction" ? "/login" : "/banking/integrity?company=JAPAN"), { method: "POST", body: await encodeReply(args), headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(15000) });
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
    for (let index = 0; index < 60; index++) {
      try { if ((await get("/login")).status === 200) { ready = true; break; } } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Standalone must start");
    const admin = await login("admin@example.invalid"), accounting = await login("accounting@example.invalid"), editor = await login("mail_editor@example.invalid");
    const route = "/banking/integrity?company=JAPAN";
    assert.equal((await get(route)).status, 307); assert.equal((await get(route, editor)).status, 307);
    assert.equal((await get("/banking/integrity?company=CHINA", admin)).status, 307);
    assert.equal((await get("/api/banking/integrity")).status, 401);
    assert.equal((await get("/api/banking/integrity", editor)).status, 403);
    assert.equal((await get("/api/banking/integrity?includeKnown=true", admin)).status, 400);
    const initialData = await read(), expectedSource = structuredClone(initialData);
    const view = async (stage: string, total: number, knownTotal: number, known = false, cookie = admin) => {
      const html = await htmlFor(route + (known ? "&known=1" : ""), stage, cookie);
      const props = propsFrom(html, "summary") as { summary: IntegritySummary; view: IntegrityView };
      assert.equal(props.summary.total, total); assert.equal(props.summary.knownTotal, knownTotal); assert.equal(props.view.knownOnly, known);
      assert.equal(props.view.filteredTotal, known ? knownTotal : total); assert.equal(props.view.items.length, known ? knownTotal : total);
      assert.ok(props.view.items.every((row) => Boolean(row.known) === known));
      return { html, ...props };
    };
    const json = async (includeKnown = false) => {
      const response = await get("/api/banking/integrity?company=JAPAN" + (includeKnown ? "&includeKnown=1" : ""), admin);
      assert.equal(response.status, 200); return response.json() as Promise<IntegrityReport>;
    };
    const agentResponse = (query = "", secret = agentSecret.plain) => fetch(base + "/api/agent/v1/integrity?company=JAPAN" + query, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000) });
    const checkApi = async (total: number, knownTotal: number) => {
      const normal = await json(), included = await json(true);
      assert.equal(normal.total, total); assert.equal(normal.knownTotal, knownTotal); assert.equal(normal.issues.length, total); assert.ok(normal.issues.every((row) => !row.known));
      assert.equal(included.issues.length, total + knownTotal); assert.equal(included.issues.filter((row) => row.known).length, knownTotal);
      for (const includeKnown of [false, true]) {
        const response = await agentResponse(includeKnown ? "&includeKnown=1" : ""); assert.equal(response.status, 200);
        const result = await response.json() as { items: IntegrityIssue[]; total: number; knownTotal: number; unresolvedTotal: number };
        assert.equal(result.total, total + (includeKnown ? knownTotal : 0)); assert.equal(result.knownTotal, knownTotal); assert.equal(result.unresolvedTotal, total);
        assert.deepEqual(result.items.map((row) => row.id), (includeKnown ? included : normal).issues.map((row) => row.id));
      }
      return included;
    };
    const first = await view("initial", 8, 0); assert.match(plain(first.html), /UPSIDERカード精算 4件/); assert.match(plain(first.html), /アプラスカード精算 1件/);
    await checkApi(8, 0);
    assert.equal((await agentResponse("&includeKnown=bogus")).status, 400); assert.equal((await agentResponse("&includeKnown=1", bankSecret.plain)).status, 403);
    const issue = first.view.items.find((row) => row.id === "reviewed_guess:guess-1")!;
    const single: AcknowledgeIntegrityInput = { mode: "ISSUE", kind: issue.kind, reason: "合成: 推測のままでよい", targets: [{ id: issue.id, fingerprint: issue.fingerprint }] };
    const save = async (input: AcknowledgeIntegrityInput, cookie = admin, company = "JAPAN") => (await call("acknowledgeIntegrityAction", [company, input], cookie)).text();
    const bytes = await readFile(path.join(dataDir, "app-data.json"), "utf8");
    assert.match(await save(single, editor), /"success":false/); assert.match(await save(single, admin, "CHINA"), /"success":false/);
    assert.match(await save({ ...single, reason: " " }), /"success":false/); assert.equal(await readFile(path.join(dataDir, "app-data.json"), "utf8"), bytes);
    assert.match(await save(single), /"success":true/);
    await view("after-individual", 7, 1); const known = await view("known-list", 7, 1, true);
    assert.match(plain(known.html), /合成: 推測のままでよい/); assert.match(plain(known.html), /合成検証管理者/); assert.match(plain(known.html), /既知を取り消す/);
    await checkApi(7, 1);
    const savedBytes = await readFile(path.join(dataDir, "app-data.json"), "utf8"); assert.match(await save(single), /"success":false/); assert.equal(await readFile(path.join(dataDir, "app-data.json"), "utf8"), savedBytes);
    const current = await json(), targets = current.issues.filter((row) => row.kind === "reviewed_guess").map(({ id, fingerprint }) => ({ id, fingerprint }));
    assert.equal(targets.length, 2); assert.match(await save({ mode: "KIND", kind: "reviewed_guess", reason: "合成: この種類を確認", targets }, accounting), /"success":true/);
    await view("after-kind", 5, 3); await checkApi(5, 3);
    // Simulate source changes only inside this disposable synthetic copy; no application migration.
    const writeSource = async (change: (data: AppData) => void) => { const data = await read(); change(data); change(expectedSource); await writeFile(path.join(dataDir, "app-data.json"), JSON.stringify(data)); };
    await writeSource((data) => { data.bankTransactions[0].updatedAt = "2099-01-01T00:00:00.000Z"; });
    await view("timestamp-only", 5, 3); await checkApi(5, 3);
    await writeSource((data) => { data.bankTransactions[0].amount = 1100; });
    const changed = await view("evidence-changed", 6, 2); assert.ok(changed.view.items.some((row) => row.id === issue.id)); await checkApi(6, 2);
    await writeSource((data) => { data.bankTransactions.push({ ...data.bankTransactions[1], id: "later-guess", sourceId: "later-guess", content: "合成後から追加された推測" }); });
    const added = await view("later-issue", 7, 2); assert.ok(added.view.items.some((row) => row.id === "reviewed_guess:later-guess"));
    const toRevoke = (await json(true)).issues.find((row) => row.id === "reviewed_guess:guess-2")!.known!;
    const revokeInput = { id: toRevoke.id, updatedAt: toRevoke.updatedAt, reason: "合成: 改めて確認する" };
    assert.match(await (await call("revokeIntegrityAcknowledgementAction", ["JAPAN", { ...revokeInput, reason: "" }], admin)).text(), /"success":false/);
    assert.match(await (await call("revokeIntegrityAcknowledgementAction", ["JAPAN", revokeInput], admin)).text(), /"success":true/);
    await view("revoked", 8, 1); await checkApi(8, 1);
    const revocationBytes = await readFile(path.join(dataDir, "app-data.json"), "utf8");
    assert.match(await (await call("revokeIntegrityAcknowledgementAction", ["JAPAN", revokeInput], admin)).text(), /"success":false/);
    assert.equal(await readFile(path.join(dataDir, "app-data.json"), "utf8"), revocationBytes);
    for (const kind of ["category_spread", "transfer_half"] as const) {
      const row = (await json()).issues.find((row) => row.kind === kind)!;
      assert.match(await save({ mode: "ISSUE", kind, reason: "合成: 意図を確認", targets: [{ id: row.id, fingerprint: row.fingerprint }] }), /"success":true/);
    }
    await view("final-open", 6, 3); await view("final-known", 6, 3, true); const finalReport = await checkApi(6, 3);
    const final = await read(); assert.equal(final.auditLogs.length - initialData.auditLogs.length, 5);
    for (const log of final.auditLogs.slice(0, 5)) assert.ok(JSON.stringify(log.beforeStateJson).includes('"collection":"integrityAcknowledgements"'));
    assert.equal(final.auditLogs.filter((row) => row.action === "ACKNOWLEDGE_INTEGRITY").length, 4);
    assert.equal(final.auditLogs.filter((row) => row.action === "REVOKE_INTEGRITY_ACKNOWLEDGEMENT").length, 1);
    const strip = (data: AppData) => { const copy = structuredClone(data); delete copy.integrityAcknowledgements; copy.auditLogs = []; return copy; };
    assert.deepEqual(strip(final), strip(expectedSource));
    const staticPath = first.html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1]; assert.ok(staticPath); assert.equal((await get(staticPath.replaceAll("&amp;", "&"))).status, 200);
    assert.equal(await readFile(path.join(preview, "app-data.json"), "utf8"), initial);
    await writeFile(path.join(dataDir, "integrity.json"), JSON.stringify(finalReport, null, 2));
    const result = { port, initialTotal: 8, initialKnown: 0, finalTotal: 6, finalKnown: 3, individualAndKindAcknowledged: true, reasonedRevocation: true, auditCount: 5,
      timestampIgnored: true, changedEvidenceReappears: true, laterIssuesVisible: true, permissionsAndStaleRejected: true, agentDefaultAndIncludeKnown: true, sourceDataUnchangedByActions: true, previewUnchanged: true,
      visualChecks: "Claude担当: 実クリック・通知・PC/tablet/mobile x light/darkは未確認" };
    await writeFile(path.join(dataDir, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ dataDir, ...result }));
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve)); if (child.exitCode === null) child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]); if (child.exitCode === null) child.kill("SIGKILL");
    console.log("Stopped only the standalone process started for this check.");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
