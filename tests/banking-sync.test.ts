import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixture, admin, timestamp } from "./document-fixture";

test("sync commits complete months, resumes safely and serializes concurrent edits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-banking-sync-test-"));
  const keys = ["DATA_DIR", "DATABASE_URL", "MONEYFORWARD_JAPAN_API_KEY", "MONEYFORWARD_JAPAN_OFFICE_CODE", "MONEYFORWARD_CHINA_API_KEY", "MONEYFORWARD_CHINA_OFFICE_CODE"];
  const previous = new Map(keys.map((key) => [key, process.env[key]])), originalFetch = globalThis.fetch;
  try {
    process.env.DATA_DIR = root; process.env.DATABASE_URL = "";
    process.env.MONEYFORWARD_JAPAN_API_KEY = "synthetic-test-key"; process.env.MONEYFORWARD_JAPAN_OFFICE_CODE = "0000-0001";
    process.env.MONEYFORWARD_CHINA_API_KEY = "synthetic-test-key"; process.env.MONEYFORWARD_CHINA_OFFICE_CODE = "0000-0001";
    const data = fixture();
    data.users.push({ ...admin, name: "Test admin", email: "admin@example.invalid", passwordHash: "unused-test-hash", createdAt: timestamp, updatedAt: timestamp });
    await writeFile(path.join(root, "app-data.json"), JSON.stringify(data));
    const { queueBankSync, runBankSync, setBankAutoSync, bankSyncBusy } = await import("../src/lib/banking-sync");
    const { readData, mutateData, withDataMutationLock } = await import("../src/lib/store");
    let failSeptember = true;
    const months: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === "https://api.biz.moneyforward.com" && url.pathname === "/auth/exchange") {
        assert.equal(init?.method, "POST");
        return Response.json({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600 });
      }
      assert.equal(url.origin, "https://api-accounting.moneyforward.com"); assert.equal(init?.method, "GET"); assert.equal(url.searchParams.get("office_code"), "0000-0001");
      if (url.pathname.endsWith("/offices")) return Response.json({ code: "0000-0001", name: "Synthetic office", accounting_periods: [{ start_date: "2020-08-01", end_date: "2020-09-30" }] });
      if (url.pathname.endsWith("/connected_accounts")) return Response.json({ connected_accounts: [{ id: "bank", name: "Synthetic bank", is_manual: false, connected_sub_accounts: [] }] });
      if (url.pathname.endsWith("/accounts")) return Response.json({ accounts: [] });
      assert.ok(url.pathname.endsWith("/transactions"));
      const date = url.searchParams.get("start_date")!; months.push(date);
      if (failSeptember && date === "2020-09-01") return new Response("never-log-test-secret", { status: 403 });
      return Response.json({ transactions: [{ id: date, date, value: 1000, side: "INCOME", content: "Synthetic transaction", memo: null, journalizing_status: "none", connected_account_id: "bank", connected_sub_account_id: null }], metadata: { total_count: 1, total_pages: 1 } });
    };
    const request = { mode: "range" as const, start: "2020-08-01", end: "2020-09-30" };
    const job = await queueBankSync("JAPAN", request, admin);
    assert.ok(bankSyncBusy((await readData()).bankSyncStates[0]));
    await assert.rejects(queueBankSync("JAPAN", request, admin), /実行中/);
    await runBankSync(job);
    let saved = await readData();
    assert.equal(saved.bankTransactions.length, 1); assert.equal(saved.bankSyncStates[0].status, "ERROR");
    assert.equal(saved.bankSyncStates[0].completedThrough, "2020-08-31");
    assert.ok(!JSON.stringify(saved).includes("never-log-test-secret"));
    assert.ok(saved.auditLogs.filter((log) => log.action.startsWith("BANK_SYNC")).every((log) => !log.beforeStateJson));
    failSeptember = false; months.length = 0;
    const resumed = await queueBankSync("JAPAN", request, admin); assert.ok(resumed.resume);
    await runBankSync(resumed);
    saved = await readData();
    assert.deepEqual(months, ["2020-09-01"]); assert.equal(saved.bankTransactions.length, 2);
    assert.equal(saved.bankSyncStates[0].status, "SUCCESS"); assert.equal(saved.bankSyncStates[0].lastSuccessAt, undefined);
    await runBankSync(await queueBankSync("JAPAN", request, admin));
    assert.equal((await readData()).bankTransactions.length, 2);
    await assert.rejects(queueBankSync("CHINA", request, admin), /別の会社/);
    await assert.rejects(setBankAutoSync({ id: "accountant", role: "ACCOUNTING" }, "JAPAN", true), /管理者/);
    await setBankAutoSync(admin, "JAPAN", true); assert.equal((await readData()).bankSyncStates[0].autoSync, true);
    const events: string[] = [];
    const held = withDataMutationLock(async () => { events.push("locked"); await new Promise((resolve) => setTimeout(resolve, 10)); events.push("released"); });
    const changed = mutateData(admin.id, "BANK_TEST_EDIT", "BankTransaction", "test", (draft) => { events.push("edited"); draft.bankTransactions[0].memo = "Persistent local edit"; });
    await held; await changed;
    assert.deepEqual(events, ["locked", "released", "edited"]);
    assert.equal((await readData()).bankTransactions[0].memo, "Persistent local edit");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    const absolute = path.resolve(root);
    if (path.dirname(absolute) === path.resolve(os.tmpdir()) && path.basename(absolute).startsWith("triangle-banking-sync-test-")) await rm(absolute, { recursive: true, force: true });
  }
});
