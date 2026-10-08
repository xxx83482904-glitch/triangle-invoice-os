import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fixture } from "./document-fixture";
import { bankToday } from "../src/lib/banking";
import type { AppData } from "../src/lib/types";
import type { ReconcileInput } from "../src/lib/bank-reconciliation";

// Mutating integration test: only the disposable, synthetic preview may be used.
async function main() {
  const root = path.resolve(process.env.DATA_DIR || "missing");
  assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(root).startsWith("triangle-banking-preview-"));
  const file = path.join(root, "app-data.json"), read = async () => JSON.parse(await readFile(file, "utf8")) as AppData;
  const data = await read(), base = "http://localhost:3018", prefix = `reconcile-preview-${Date.now()}`;
  assert.ok(data.users.some((row) => row.email === "admin@example.invalid"));
  assert.ok(data.bankAccounts.length && data.bankAccounts.every((row) => row.name.startsWith("テスト")));
  await copyFile(file, path.join(root, `before-${prefix}.json`));
  const sample = fixture(), account = data.bankAccounts.find((row) => row.sourceSubId === "branch")!;
  assert.equal(account.forecastSettings?.accountKind, "BANK");
  const today = bankToday(), timestamp = new Date().toISOString(), common = { createdAt: timestamp, updatedAt: timestamp };
  const clientId = `${prefix}-client`, vendorId = `${prefix}-vendor`, projectId = `${prefix}-project`;
  data.clients.push({ ...sample.clients[0], ...common, id: clientId, companyName: "テスト照合 クライアント" });
  data.vendors.push({ ...sample.vendors[0], ...common, id: vendorId, companyName: "テスト照合 制作会社" });
  data.projects.push({ ...sample.projects[0], ...common, id: projectId, clientId, name: "テスト照合 日本案件" });
  const issuedId = `${prefix}-issued`, existingId = `${prefix}-existing`, receivedId = `${prefix}-received`, mailId = `${prefix}-mail`;
  for (const [id, number] of [[issuedId, "テスト照合-001"], [existingId, "テスト照合-002"]]) data.issuedInvoices.push({ ...sample.issuedInvoices[0], ...common, id, projectId, clientId, invoiceNumber: number, status: id === existingId ? "PAID" : "ISSUED", needsReview: false, issueDate: today, dueDate: today });
  data.receivedInvoices.push({ ...sample.receivedInvoices[0], ...common, id: receivedId, projectId, vendorId, status: "SCHEDULED", mailProcessed: false, issueDate: today, dueDate: today, originalFileName: "テスト照合 制作費.pdf" });
  data.mailDocuments.push({ ...sample.mailDocuments[0], ...common, id: mailId, relatedReceivedInvoiceId: receivedId, title: "テスト照合 制作費", mailProcessed: false });
  data.mailDocuments.push({ ...sample.mailDocuments[0], ...common, id: `${prefix}-orphan`, relatedReceivedInvoiceId: undefined, title: "テスト照合 未連携の領収書", mailProcessed: false });
  const paymentId = `${prefix}-payment`;
  data.payments.push({ ...common, id: paymentId, type: "INCOME", source: "INVOICE_STATUS", issuedInvoiceId: existingId, amount: 12000, paymentDate: today, method: "ステータス変更", createdById: "admin" });
  const incomeId = `${prefix}-income`, expenseId = `${prefix}-expense`, existingBankId = `${prefix}-bank-existing`;
  for (const [id, side, amount, content] of [[incomeId, "INCOME", 12000, "テスト照合 クライアント テスト照合-001"], [existingBankId, "INCOME", 12000, "テスト照合 クライアント テスト照合-002"], [expenseId, "EXPENSE", 8000, "テスト照合 制作会社"]] as const) {
    data.bankTransactions.unshift({ ...common, id, company: "JAPAN", officeCode: account.officeCode, sourceId: id, bankAccountId: account.id, transactionDate: today, amount, side, content, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "UNASSIGNED", reviewed: false, memo: "" });
  }
  data.bankReconciliations ||= [];
  await writeFile(file, JSON.stringify(data, null, 2));
  await (await fetch(`${base}/login`)).text();
  const require = createRequire(import.meta.url);
  const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node") as { encodeReply: (args: unknown[]) => Promise<string | FormData> };
  const call = async (name: string, args: unknown[], cookie = "") => {
    const manifest = JSON.parse(await readFile(".next/dev/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
    const id = Object.entries(manifest.node).find(([, action]) => action.exportedName === name)?.[0]; assert.ok(id, name);
    return fetch(`${base}/${name === "loginAction" ? "login" : "banking/reconcile?company=JAPAN"}`, { method: "POST", body: await encodeReply(args), redirect: "manual", headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, Cookie: cookie } });
  };
  const login = async (role: string) => {
    const form = new FormData(); form.set("email", `${role}@example.invalid`); form.set("password", "local-banking-test-only");
    const response = await call("loginAction", [{ error: "" }, form]); await response.text();
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("triangle-session="))?.split(";")[0]; assert.ok(cookie, role); return cookie;
  };
  const admin = await login("admin"), accounting = await login("accounting");
  for (const cookie of [admin, accounting]) {
    const response = await fetch(`${base}/banking/reconcile?company=JAPAN&transaction=${incomeId}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200); const html = await response.text();
    for (const text of ["銀行・請求書の照合", "テスト照合-001", "請求書番号が摘要に一致", "受領請求書と未連携の郵便物"]) assert.ok(html.includes(text), text);
  }
  async function input(kind: "issued" | "received", invoiceId: string, transactionId: string, amount: number, extra: Partial<ReconcileInput> = {}): Promise<ReconcileInput> {
    const current = await read(), bank = current.bankTransactions.find((row) => row.id === transactionId)!, invoice = (kind === "issued" ? current.issuedInvoices : current.receivedInvoices).find((row) => row.id === invoiceId)!;
    return { transactionId, transactionUpdatedAt: bank.updatedAt, invoiceKind: kind, invoiceId, invoiceUpdatedAt: invoice.updatedAt, amount, mode: "new", acknowledged: true, ...extra };
  }
  const expenseInput = await input("received", receivedId, expenseId, 3000), before = await read();
  const assertUntouched = async () => { const current = await read(); for (const key of ["bankTransactions", "bankReconciliations", "payments", "issuedInvoices", "receivedInvoices", "mailDocuments"] as const) assert.deepEqual(current[key], before[key], key); };
  for (const cookie of ["", await login("billing_editor"), await login("mail_editor")]) {
    const response = await fetch(`${base}/banking/reconcile?company=JAPAN`, { redirect: "manual", headers: { Cookie: cookie } }); assert.equal(response.status, 307);
    await (await call("confirmBankReconciliationAction", ["JAPAN", expenseInput], cookie)).text(); await assertUntouched();
  }
  for (const [company, request] of [["CHINA", expenseInput], ["JAPAN", { ...expenseInput, invoiceUpdatedAt: "stale" }], ["JAPAN", { ...expenseInput, amount: 9000 }]] as const) {
    assert.match(await (await call("confirmBankReconciliationAction", [company, request], admin)).text(), /"success":false/); await assertUntouched();
  }
  assert.match(await (await call("confirmBankReconciliationAction", ["JAPAN", expenseInput], accounting)).text(), /"success":true/);
  let current = await read(); assert.equal(current.receivedInvoices.find((row) => row.id === receivedId)!.status, "SCHEDULED"); assert.equal(current.mailDocuments.find((row) => row.id === mailId)!.mailProcessed, false);
  assert.match(await (await call("confirmBankReconciliationAction", ["JAPAN", expenseInput], accounting)).text(), /"success":false/);
  assert.match(await (await call("confirmBankReconciliationAction", ["JAPAN", await input("received", receivedId, expenseId, 5000)], accounting)).text(), /"success":true/);
  current = await read(); assert.equal(current.receivedInvoices.find((row) => row.id === receivedId)!.status, "PAID"); assert.equal(current.mailDocuments.find((row) => row.id === mailId)!.mailProcessed, true);
  const link = current.bankReconciliations.find((row) => row.invoiceId === receivedId && row.amount === 5000)!;
  assert.match(await (await call("removeBankReconciliationAction", ["JAPAN", link.id, link.updatedAt], admin)).text(), /"success":true/);
  current = await read(); assert.equal(current.mailDocuments.find((row) => row.id === mailId)!.mailProcessed, false);
  const undo = new FormData(); undo.set("returnPath", "/banking/reconcile?company=JAPAN");
  await (await call("undoLastAction", [undo], admin)).text();
  current = await read(); assert.equal(current.mailDocuments.find((row) => row.id === mailId)!.mailProcessed, true); assert.equal(current.bankReconciliations.find((row) => row.id === link.id)!.deletedAt, undefined);
  const existingPayment = current.payments.find((row) => row.id === paymentId)!, paymentCount = current.payments.length;
  assert.match(await (await call("confirmBankReconciliationAction", ["JAPAN", await input("issued", existingId, existingBankId, 12000, { mode: "existing", paymentId, paymentUpdatedAt: existingPayment.updatedAt })], accounting)).text(), /"success":true/);
  current = await read(); assert.equal(current.payments.length, paymentCount); assert.deepEqual(current.payments.find((row) => row.id === paymentId), existingPayment);
  const html = await (await fetch(`${base}/banking/reconcile?company=JAPAN&invoice=${encodeURIComponent(`issued:${existingId}`)}&status=all`, { headers: { Cookie: admin } })).text();
  assert.ok(html.includes("紐づけ済みの記録"));
  assert.deepEqual(current.bankTransactions, before.bankTransactions);
  assert.ok(current.auditLogs.some((row) => row.action === "BANK_RECONCILE" && row.beforeStateJson));
  console.log("PASS: page permissions, action permissions, company/version/amount guards, partial/full payment, linked mail, existing payment reuse, unlink and real Undo persistence. Bank source unchanged.");
  console.log(`Preview: ${base}/banking/reconcile?company=JAPAN&transaction=${incomeId}`);
}
void main();
