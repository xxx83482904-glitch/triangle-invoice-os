import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { AppData } from "../src/lib/types";

async function main() {
  const root = path.resolve(process.env.DATA_DIR || "missing");
  assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(root).startsWith("triangle-banking-preview-"));
  const read = async () => JSON.parse(await readFile(path.join(root, "app-data.json"), "utf8")) as AppData;
  const initial = await read();
  assert.ok(initial.users.some((row) => row.email === "admin@example.invalid"));
  assert.ok(initial.bankAccounts.every((row) => row.name.startsWith("テスト")));
  const base = "http://localhost:3018";
  await (await fetch(`${base}/login`)).text();
  const manifest = JSON.parse(await readFile(".next/dev/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
  const require = createRequire(import.meta.url);
  const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node") as { encodeReply: (args: unknown[]) => Promise<string | FormData> };
  const loginId = Object.entries(manifest.node).find(([, action]) => action.exportedName === "loginAction")?.[0];
  assert.ok(loginId);
  const login = async (role: string) => {
    const form = new FormData(); form.set("email", `${role}@example.invalid`); form.set("password", "local-banking-test-only");
    const response = await fetch(`${base}/login`, { method: "POST", body: await encodeReply([{ error: "" }, form]), redirect: "manual", headers: { "Next-Action": loginId, Accept: "text/x-component", Origin: base } });
    await response.text();
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("triangle-session="))?.split(";")[0];
    assert.ok(cookie, role); return cookie;
  };
  for (const cookie of ["", await login("billing_editor"), await login("mail_editor")]) {
    const response = await fetch(`${base}/banking/insights?company=JAPAN`, { redirect: "manual", headers: { Cookie: cookie } });
    assert.equal(response.status, 307);
    assert.ok(!(await response.text()).includes("テスト 事務所賃料"));
  }
  for (const cookie of [await login("admin"), await login("accounting")]) {
    const get = async (url: string) => {
      const response = await fetch(`${base}${url}`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200); return response.text();
    };
    const html = await get("/banking/insights?company=JAPAN");
    for (const text of ["出金の傾向・注意", "通常より大きい出金", "同日・同額の重複候補", "定期支払いの増額候補", "増減の内訳・勘定科目", "テスト 事務所賃料"]) assert.ok(html.includes(text), text);
    const wrongCompany = await get("/banking/insights?company=CHINA&account=" + encodeURIComponent(initial.bankAccounts.find((row) => row.sourceSubId === "branch")!.id));
    assert.ok(wrongCompany.includes("対象の口座が見つかりません")); assert.ok(!wrongCompany.includes("テスト 事務所賃料"));
    const target = initial.bankTransactions.find((row) => row.id.startsWith("spending-preview-") && row.content === "テスト 事務所賃料")!;
    const detail = await get(`/banking?company=JAPAN&transaction=${encodeURIComponent(target.id)}`);
    assert.ok(detail.includes("指定された明細を表示中")); assert.ok(detail.includes(target.content)); assert.ok(!detail.includes("テスト 制作委託費"));
  }
  const after = await read();
  assert.deepEqual(after.bankTransactions, initial.bankTransactions); assert.deepEqual(after.bankAccounts, initial.bankAccounts);
  assert.deepEqual(after.issuedInvoices, initial.issuedInvoices); assert.deepEqual(after.payments, initial.payments);
  console.log("PASS: admin/accounting can view spending insights and exact drill-down; anonymous/billing/mail are denied; cross-company isolation holds; source transactions, accounts, invoices and payments remain unchanged.");
}
void main();
