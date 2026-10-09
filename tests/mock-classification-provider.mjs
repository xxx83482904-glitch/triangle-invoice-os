import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";

const root = path.resolve(process.env.DATA_DIR || "missing");
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.ok(path.basename(root).startsWith("triangle-banking-preview-"));
assert.equal(process.env.OPENAI_API_KEY, "local-classification-mock-only");
assert.equal(process.env.SESSION_SECRET, "local-banking-preview-not-for-production");

const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://api.openai.com/")) return original(input, init);
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  const body = JSON.parse(String(init.body));
  assert.equal(body.response_format.json_schema.name, "bank_account_categories");
  const payload = JSON.parse(body.messages[1].content);
  assert.ok(payload.transactions.length <= 50);
  const travel = payload.categories.find((row) => row.name === "旅費交通費");
  const decisions = payload.transactions.map((row) => {
    const match = /JRW SHINKANSEN|エスライド/.test(row.content);
    return { bankRef: row.ref, categoryRef: match ? travel.ref : null, confidence: match ? "medium" : "unknown", reason: match ? "テストAI応答: 交通サービスの利用候補です" : "テストAI応答: 購入内容と用途が必要です", quote: match ? row.content : "" };
  });
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ decisions }) } }] }), { headers: { "Content-Type": "application/json" } });
};
