import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { AppData } from "../src/lib/types";

// Real HTTP checks against the already-running, synthetic localhost preview only.
async function main() {
  const root = path.resolve(process.env.DATA_DIR || "missing");
  assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(root).startsWith("triangle-banking-preview-"));
  const base = "http://localhost:3018";
  const read = async () => JSON.parse(await readFile(path.join(root, "app-data.json"), "utf8")) as AppData;
  const initial = await read();
  assert.ok(initial.users.some((row) => row.email === "admin@example.invalid"));
  assert.ok(initial.bankAccounts.every((row) => row.name.startsWith("テスト")));
  const manifest = JSON.parse(await readFile(".next/dev/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
  const require = createRequire(import.meta.url);
  const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node") as { encodeReply: (args: unknown[]) => Promise<string | FormData> };
  const call = async (name: string, args: unknown[], cookie = "") => {
    const id = Object.entries(manifest.node).find(([, action]) => action.exportedName === name)?.[0];
    assert.ok(id);
    return fetch(`${base}/${name === "loginAction" ? "login" : "banking/forecast?company=JAPAN"}`, {
      method: "POST", body: await encodeReply(args), redirect: "manual",
      headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    });
  };
  const login = async (role: string) => {
    const form = new FormData(); form.set("email", `${role}@example.invalid`); form.set("password", "local-banking-test-only");
    const response = await call("loginAction", [{ error: "" }, form]);
    await response.text();
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("triangle-session="))?.split(";")[0];
    assert.ok(cookie, role); return cookie;
  };
  const row = initial.bankAccounts.find((item) => item.sourceSubId === "branch")!;
  assert.ok(row.forecastSettings);
  const input = { ...row.forecastSettings, incomePercent: 15 };
  for (const cookie of ["", await login("billing_editor"), await login("mail_editor")]) {
    const page = await fetch(`${base}/banking/forecast?company=JAPAN`, { redirect: "manual", headers: { Cookie: cookie } });
    assert.equal(page.status, 307);
    await (await call("saveBankForecastAction", ["JAPAN", row.id, row.updatedAt, input], cookie)).text();
    assert.deepEqual((await read()).bankAccounts, initial.bankAccounts);
  }
  const admin = await login("admin"), accounting = await login("accounting");
  for (const [company, version, settings] of [["CHINA", row.updatedAt, input], ["JAPAN", "stale", input], ["JAPAN", row.updatedAt, { ...input, openingBalance: 1e15 }]] as const) {
    assert.match(await (await call("saveBankForecastAction", [company, row.id, version, settings], admin)).text(), /"success":false/);
    assert.deepEqual((await read()).bankAccounts, initial.bankAccounts);
  }
  assert.match(await (await call("saveBankForecastAction", ["JAPAN", row.id, row.updatedAt, input], accounting)).text(), /"success":true/);
  let saved = (await read()).bankAccounts.find((item) => item.id === row.id)!;
  assert.equal(saved.forecastSettings?.incomePercent, 15);
  assert.match(await (await call("saveBankForecastAction", ["JAPAN", row.id, saved.updatedAt, row.forecastSettings], admin)).text(), /"success":true/);
  const undo = new FormData(); undo.set("returnPath", "/banking/forecast?company=JAPAN");
  await (await call("undoLastAction", [undo], admin)).text();
  saved = (await read()).bankAccounts.find((item) => item.id === row.id)!;
  assert.equal(saved.forecastSettings?.incomePercent, 15);
  assert.match(await (await call("saveBankForecastAction", ["JAPAN", row.id, saved.updatedAt, row.forecastSettings], admin)).text(), /"success":true/);
  const final = await read(); saved = final.bankAccounts.find((item) => item.id === row.id)!;
  assert.deepEqual(saved.forecastSettings, row.forecastSettings);
  assert.deepEqual(final.bankTransactions, initial.bankTransactions);
  assert.deepEqual(final.issuedInvoices, initial.issuedInvoices); assert.deepEqual(final.payments, initial.payments);
  assert.ok(final.auditLogs.some((item) => item.action === "BANK_FORECAST_SETTINGS" && item.beforeStateJson));
  console.log("PASS: authenticated forecast settings persist and Undo restores them; anonymous/billing/mail users, wrong company, stale version and invalid values are rejected; source movements/invoices/payments are unchanged; undo audit exists.");
}
void main();
