#!/usr/bin/env node
// Minimal client for the agent API. Reads TRIANGLE_API_URL and TRIANGLE_API_TOKEN from the environment
// (put them in .env.local, never in the repository).
//   node scripts/agent-cli.mjs read bank-transactions start=2026-10-01 end=2026-10-31 reviewed=false
//   node scripts/agent-cli.mjs dry-run ./batch.json
//   node scripts/agent-cli.mjs apply ./batch.json
import { readFileSync } from "node:fs";

const [command, ...rest] = process.argv.slice(2);
const base = (process.env.TRIANGLE_API_URL || "").replace(/\/$/, "");
const token = process.env.TRIANGLE_API_TOKEN || "";
if (!base || !token) { console.error("TRIANGLE_API_URL と TRIANGLE_API_TOKEN を設定してください"); process.exit(2); }
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function call(path, init) {
  const response = await fetch(`${base}/api/agent/v1${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  console.log(JSON.stringify({ status: response.status, body }, null, 2));
  if (!response.ok) process.exit(1);
}

if (command === "read") {
  const [resource, ...pairs] = rest;
  if (!resource) { console.error("read <resource> [key=value ...]"); process.exit(2); }
  const params = new URLSearchParams(pairs.map((pair) => pair.split("=", 2)));
  await call(`/${resource}${params.size ? `?${params}` : ""}`);
} else if (command === "dry-run" || command === "apply") {
  const [file] = rest;
  if (!file) { console.error(`${command} <batch.json>`); process.exit(2); }
  const body = JSON.parse(readFileSync(file, "utf8"));
  body.dryRun = command === "dry-run";
  await call("/batch", { method: "POST", body: JSON.stringify(body) });
} else if (command === "describe") {
  await call("");
} else {
  console.error("commands: describe | read <resource> [k=v ...] | dry-run <batch.json> | apply <batch.json>");
  process.exit(2);
}
