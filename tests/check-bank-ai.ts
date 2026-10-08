import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { prepareBankAi } from "../src/lib/bank-ai";
import { bankToday } from "../src/lib/banking";
import type { AppData } from "../src/lib/types";

// Only the isolated synthetic preview is allowed. This test never calls the provider.
async function main() {
  const root = path.resolve(process.env.DATA_DIR || "missing");
  assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(root).startsWith("triangle-banking-preview-"));
  const read = async () => JSON.parse(await readFile(path.join(root, "app-data.json"), "utf8")) as AppData;
  const initial = await read(), base = "http://localhost:3018";
  assert.ok(initial.users.some((row) => row.email === "admin@example.invalid"));
  assert.ok(initial.bankAccounts.length && initial.bankAccounts.every((row) => row.name.startsWith("テスト")));
  await (await fetch(`${base}/login`)).text();
  const require = createRequire(import.meta.url);
  const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node") as { encodeReply: (args: unknown[]) => Promise<string | FormData> };
  const call = async (name: string, args: unknown[], cookie = "") => {
    const manifest = JSON.parse(await readFile(".next/dev/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
    const id = Object.entries(manifest.node).find(([, action]) => action.exportedName === name)?.[0]; assert.ok(id, name);
    return fetch(`${base}/${name === "loginAction" ? "login" : "banking/reconcile?company=JAPAN&view=checks"}`, { method: "POST", body: await encodeReply(args), redirect: "manual", headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, Cookie: cookie } });
  };
  const login = async (role: string) => {
    const form = new FormData(); form.set("email", `${role}@example.invalid`); form.set("password", "local-banking-test-only");
    const response = await call("loginAction", [{ error: "" }, form]); await response.text();
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("triangle-session="))?.split(";")[0]; assert.ok(cookie, role); return cookie;
  };
  const admin = await login("admin"), accounting = await login("accounting");
  const statusResponse = await fetch(`${base}/api/system/ocr-settings`, { headers: { Cookie: admin } });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json() as Record<string, unknown>;
  assert.equal(status.openAiConfigured, false, "Do not run this test with a configured API key");
  assert.equal(status.openAiApiKey, undefined);
  for (const [cookie, isAdmin] of [[admin, true], [accounting, false]] as const) {
    const response = await fetch(`${base}/banking/reconcile?company=JAPAN&view=checks`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200); const html = await response.text();
    for (const text of ["AI横断チェック", "AI・確認事項", "APIキーが未設定", "受領請求書と未連携"]) assert.ok(html.includes(text), text);
    assert.equal(/>AI設定<\/button>/.test(html), isAdmin, "Admin-only settings button");
  }
  const scope = { mode: "month", month: bankToday().slice(0, 7) } as const;
  const prepared = prepareBankAi(await read(), "JAPAN", scope);
  assert.ok(prepared.banks.length && prepared.invoices.length);
  const request = { scope, revision: prepared.preview.revision, consent: true };
  const before = await read();
  const unchanged = async () => {
    const current = await read();
    for (const key of ["bankTransactions", "bankReconciliations", "payments", "issuedInvoices", "receivedInvoices", "mailDocuments", "bankAiUsage"] as const) assert.deepEqual(current[key], before[key], key);
    assert.equal(current.auditLogs.filter((row) => row.action === "BANK_AI_REQUEST").length, before.auditLogs.filter((row) => row.action === "BANK_AI_REQUEST").length);
  };
  for (const cookie of ["", await login("billing_editor"), await login("mail_editor")]) {
    const response = await fetch(`${base}/banking/reconcile?company=JAPAN&view=checks`, { redirect: "manual", headers: { Cookie: cookie } }); assert.equal(response.status, 307);
    const body = await (await call("analyzeBankDocumentsAction", ["JAPAN", request], cookie)).text();
    assert.ok(!body.includes('"success":true')); await unchanged();
  }
  for (const cookie of [admin, accounting]) {
    for (const [company, input] of [["JAPAN", request], ["JAPAN", { ...request, consent: false }], ["JAPAN", { ...request, revision: "0".repeat(64) }], ["FORGED", request]] as const) {
      const body = await (await call("analyzeBankDocumentsAction", [company, input], cookie)).text();
      assert.match(body, /"success":false/); await unchanged();
    }
  }
  for (const cookie of [accounting, await login("billing_editor"), await login("mail_editor")]) {
    for (const method of ["GET", "POST"]) {
      const response = await fetch(`${base}/api/system/ocr-settings`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
      assert.equal(response.status, 403);
    }
  }
  const future = await (await fetch(`${base}/banking/reconcile?company=JAPAN&view=checks&checkMonth=9999-12`, { headers: { Cookie: admin } })).text();
  assert.ok(future.includes(`value="${scope.month}"`));
  await unchanged();
  console.log("PASS: real HTTP AI pages, admin-only settings, no-key/consent/schema/role guards, normalized month. No provider request or financial/usage mutation.");
}
void main();
