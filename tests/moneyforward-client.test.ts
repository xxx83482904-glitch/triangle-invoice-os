import assert from "node:assert/strict";
import test from "node:test";
import { MoneyForwardClient, bankingError } from "../src/lib/moneyforward-client";

const config = { apiKey: "mf_api_prd_TEST_ONLY", officeCode: "0000-0001" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const token = () => json({ access_token: "TEST_TOKEN", token_type: "Bearer", expires_in: 3600 });
const row = (id: string) => ({ id, date: "2026-09-01", value: 12000, side: "INCOME", content: "Test", memo: null, journalizing_status: "none", connected_account_id: "bank", connected_sub_account_id: null });
const sleep = async () => undefined;

test("exchange uses the official endpoint, reads are scoped, all pages are consumed", async () => {
  const calls: Array<{ url: string; method: string; authorization: string }> = [];
  const mock: typeof fetch = async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method || "GET", authorization: headers.get("Authorization") || "" });
    if (url.endsWith("/auth/exchange")) return token();
    const page = new URL(url).searchParams.get("page");
    return json({ transactions: [row(page === "1" ? "a" : "b")], metadata: { total_count: 2, total_pages: 2 } });
  };
  const client = new MoneyForwardClient(config, mock, sleep);
  assert.equal((await client.transactions("2026-09-01", "2026-09-30")).length, 2);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://api.biz.moneyforward.com/auth/exchange");
  assert.equal(calls[0].method, "POST"); assert.equal(calls[0].authorization, `Bearer ${config.apiKey}`);
  for (const call of calls.slice(1)) {
    assert.equal(call.method, "GET"); assert.equal(call.authorization, "Bearer TEST_TOKEN");
    const url = new URL(call.url); assert.equal(url.origin, "https://api-accounting.moneyforward.com"); assert.equal(url.searchParams.get("office_code"), config.officeCode);
    assert.equal(url.searchParams.has("connected_account_id"), false); assert.equal(url.searchParams.has("journalizing_statuses"), false);
  }
});
test("expired tokens refresh once; response secrets never enter errors", async () => {
  let exchanges = 0, reads = 0;
  const client = new MoneyForwardClient(config, async (input) => {
    if (String(input).endsWith("/auth/exchange")) { exchanges++; return token(); }
    if (++reads === 1) return json({ secret: "DO_NOT_LEAK" }, 401);
    return json({ code: config.officeCode, name: "Test Office", accounting_periods: [] });
  }, sleep);
  assert.equal((await client.office()).name, "Test Office"); assert.equal(exchanges, 2);
  const denied = new MoneyForwardClient(config, async () => json({ token: "DO_NOT_LEAK" }, 403), sleep);
  await assert.rejects(denied.office(), (error: unknown) => bankingError(error).includes("閲覧権限") && !bankingError(error).includes("DO_NOT_LEAK"));
});
test("bank subaccounts and card services are retained", async () => {
  const client = new MoneyForwardClient(config, async (input) => String(input).endsWith("/auth/exchange") ? token() : json({ connected_accounts: [{ id: "bank", name: "Bank", is_manual: false, connected_sub_accounts: [{ id: "b1", name: "Branch 1" }, { id: "b2", name: "Branch 2" }] }, { id: "card", name: "Card", is_manual: false, connected_sub_accounts: [] }] }), sleep);
  const accounts = await client.accounts(); assert.equal(accounts.length, 4); assert.equal(accounts[2].subId, "b2"); assert.equal(accounts[3].id, "card");
});
test("accounting categories and subcategories preserve source hierarchy", async () => {
  const client = new MoneyForwardClient(config, async (input) => String(input).endsWith("/auth/exchange") ? token() : json({ accounts: [{ id: "expense", name: "Travel", account_group: "EXPENSE", available: true, sub_accounts: [{ id: "train", name: "Train" }] }, { id: "old", name: "Old", account_group: "EXPENSE", available: false, sub_accounts: [] }] }), sleep);
  const categories = await client.categories(); assert.equal(categories.length, 3); assert.equal(categories[1].parentSourceId, "expense"); assert.equal(categories[2].available, false);
});
test("changing pagination totals or duplicate transaction IDs fail the whole month", async () => {
  for (const kind of ["duplicate", "changed", "truncated"]) {
    let reads = 0;
    const client = new MoneyForwardClient(config, async (input) => {
      if (String(input).endsWith("/auth/exchange")) return token();
      reads++;
      return json({ transactions: kind === "truncated" && reads === 2 ? [] : [row(kind === "duplicate" ? "same" : String(reads))], metadata: { total_count: kind === "changed" && reads === 2 ? 3 : 2, total_pages: 2 } });
    }, sleep);
    await assert.rejects(client.transactions("2026-09-01", "2026-09-30"), kind);
  }
});
test("rate limits retry with a bound and never send data to non-official endpoints", async () => {
  let reads = 0; const waits: number[] = [];
  const client = new MoneyForwardClient(config, async (input, init) => {
    assert.equal(init?.redirect, "error");
    if (String(input).endsWith("/auth/exchange")) return token();
    reads++; return reads < 3 ? new Response("", { status: 429, headers: { "Retry-After": "9999" } }) : json({ transactions: [], metadata: { total_count: 0, total_pages: 0 } });
  }, async (ms) => { waits.push(ms); });
  assert.deepEqual(await client.transactions("2026-09-01", "2026-09-30"), []);
  assert.deepEqual(waits, [10000, 10000]); assert.equal(reads, 3);
});
test("foreign offices and invalid monetary data are rejected", async () => {
  const wrong = new MoneyForwardClient(config, async (input) => String(input).endsWith("/auth/exchange") ? token() : json({ code: "9999-9999", name: "Other", accounting_periods: [] }), sleep);
  await assert.rejects(wrong.office(), /事業者/);
  const bad = new MoneyForwardClient(config, async (input) => String(input).endsWith("/auth/exchange") ? token() : json({ transactions: [{ ...row("bad"), value: -1 }], metadata: { total_count: 1, total_pages: 1 } }), sleep);
  await assert.rejects(bad.transactions("2026-09-01", "2026-09-30"));
});
