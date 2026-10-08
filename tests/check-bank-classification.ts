import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import type { AppData } from "../src/lib/types";

// This script writes only to a disposable preview, never to production.
async function main() {
  const root = path.resolve(process.env.DATA_DIR || "missing");
  assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(root).startsWith("triangle-banking-preview-"));
  const base = "http://localhost:3019";
  const secret = new TextEncoder().encode("local-banking-preview-not-for-production");
  const read = async () => JSON.parse(await readFile(path.join(root, "app-data.json"), "utf8")) as AppData;
  const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
  const require = createRequire(import.meta.url);
  const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node") as { encodeReply: (args: unknown[]) => Promise<string | FormData> };
  const cookie = async (id: string) => `triangle-session=${await new SignJWT({ id, role: "ADMIN" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(secret)}`;
  const call = async (name: string, args: unknown[], actor?: string) => {
    const actionId = Object.entries(manifest.node).find(([, action]) => action.exportedName === name)?.[0];
    assert.ok(actionId);
    return fetch(`${base}/banking?company=JAPAN`, {
      method: "POST", body: await encodeReply(args), redirect: "manual",
      headers: { "Next-Action": actionId, Accept: "text/x-component", Origin: base, ...(actor ? { Cookie: await cookie(actor) } : {}) },
    });
  };
  const initial = await read();
  const source = initial.bankTransactions.find((row) => row.id === "auto-preview")!;
  assert.ok(source);
  for (const actor of [undefined, "billing_editor", "mail_editor"]) {
    await (await call("applyBankRulesAction", ["JAPAN"], actor)).text();
    assert.deepEqual((await read()).bankTransactions, initial.bankTransactions);
  }
  const invalid = await call("applyBankRulesAction", ["CHINA", [source.id]], "admin");
  assert.match(await invalid.text(), /"success":false/);
  const stale = { id: source.id, updatedAt: "stale", categoryId: source.categoryId, treatment: source.treatment, reviewed: false, memo: "Stale change" };
  assert.match(await (await call("saveBankEditsAction", ["JAPAN", [stale]], "admin")).text(), /"success":false/);
  assert.deepEqual((await read()).bankTransactions, initial.bankTransactions);
  const category = initial.accountingCategories.find((row) => row.company === "JAPAN" && row.name === "水道光熱費")!;
  const saved = await call("saveBankEditsAction", ["JAPAN", [{ ...stale, updatedAt: source.updatedAt, categoryId: category.id, memo: "Saved after automatic classification" }]], "accounting");
  assert.match(await saved.text(), /"success":true/);
  const applied = await call("applyBankRulesAction", ["JAPAN"], "admin");
  assert.match(await applied.text(), /"success":true/);
  const final = await read(), current = final.bankTransactions.find((row) => row.id === source.id)!;
  assert.equal(current.categoryId, category.id); assert.equal(current.classificationSource, "MANUAL");
  assert.equal(current.memo, "Saved after automatic classification"); assert.equal(current.amount, source.amount);
  assert.deepEqual(final.payments, initial.payments); assert.deepEqual(final.issuedInvoices, initial.issuedInvoices);
  assert.ok(final.auditLogs.some((row) => row.action === "BANK_CLASSIFY" && row.beforeStateJson));
  console.log("PASS: classification actions reject anonymous/forged roles and foreign-company selections; stale edits rejected; accounting edits persist through bulk classification; amounts, invoices and payments unchanged; undo audit recorded.");
}

void main();
