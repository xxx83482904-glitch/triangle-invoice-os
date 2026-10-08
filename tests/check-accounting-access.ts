import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import type { AppData } from "../src/lib/types";

// Only targets a disposable local fixture. Never run against production data.
async function main() {
  const root = path.resolve(process.env.DATA_DIR || "missing");
  assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(root).startsWith("triangle-accounting-preview-"));
  const base = "http://localhost:3019";
  const secret = new TextEncoder().encode("local-accounting-preview-not-for-production");
  const read = async () => JSON.parse(await readFile(path.join(root, "app-data.json"), "utf8")) as AppData;
  const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName: string }> };
  const require = createRequire(import.meta.url);
  const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.node") as { encodeReply: (args: unknown[]) => Promise<string | FormData> };
  const cookie = async (id: string) => `triangle-session=${await new SignJWT({ id, role: "ADMIN" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(secret)}`;
  const call = async (name: string, fields: Record<string, string>, session?: string) => {
    const id = Object.entries(manifest.node).find(([, action]) => action.exportedName === name)?.[0];
    assert.ok(id);
    const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, value);
    const body = await encodeReply([{ error: "" }, data]);
    return fetch(`${base}/${name === "reviewRegistrationAction" ? "users" : name === "loginAction" ? "login" : "register"}`, {
      method: "POST", body, headers: { "Next-Action": id, Accept: "text/x-component", Origin: base, ...(session ? { Cookie: session } : {}) }, redirect: "manual",
    });
  };
  for (const [id, expected] of [["test-pending", 307], ["test-accounting", 307], ["test-admin", 200]] as const) {
    const response = await fetch(`${base}/users`, { headers: { Cookie: await cookie(id) }, redirect: "manual" });
    assert.equal(response.status, expected, id);
  }
  const blocked = await fetch(`${base}/api/export/projects?company=JAPAN`, { headers: { Cookie: await cookie("test-pending") }, redirect: "manual" });
  assert.equal(blocked.status, 307);
  assert.equal(new URL(blocked.headers.get("location")!, base).pathname, "/login");
  const login = await call("loginAction", { email: "pending@example.invalid", password: "local-accounting-test-only" });
  assert.ok(!login.headers.get("set-cookie")?.includes("triangle-session="));
  const email = `integration-${Date.now()}@example.invalid`;
  const registered = await call("registerAction", { name: "Integration applicant", email, password: "local-accounting-test-only", role: "ADMIN", accessStatus: "ACTIVE" });
  assert.ok((await registered.text()).includes('"success":true'));
  assert.ok(!registered.headers.get("set-cookie")?.includes("triangle-session="));
  let user = (await read()).users.find((item) => item.email === email)!;
  assert.equal(user.accessStatus, "PENDING"); assert.equal(user.role, "MAIL_EDITOR");
  const review = { id: user.id, updatedAt: user.updatedAt, decision: "APPROVE", role: "BILLING_EDITOR" };
  for (const session of [undefined, await cookie("test-accounting"), await cookie(user.id)]) {
    await (await call("reviewRegistrationAction", review, session)).text();
    assert.equal((await read()).users.find((item) => item.id === user.id)?.accessStatus, "PENDING");
  }
  const approved = await call("reviewRegistrationAction", review, await cookie("test-admin"));
  assert.ok((await approved.text()).includes('"success":true'));
  user = (await read()).users.find((item) => item.id === user.id)!;
  assert.equal(user.accessStatus, "ACTIVE"); assert.equal(user.role, "BILLING_EDITOR");
  const approvedLogin = await call("loginAction", { email, password: "local-accounting-test-only" });
  assert.ok(approvedLogin.headers.get("set-cookie")?.includes("triangle-session="));
  const stale = await call("reviewRegistrationAction", review, await cookie("test-admin"));
  assert.ok(!(await stale.text()).includes('"success":true'));
  const audits = (await read()).auditLogs.filter((log) => ["REQUEST_REGISTRATION", "REVIEW_REGISTRATION"].includes(log.action));
  assert.ok(audits.length >= 2);
  assert.ok(audits.every((log) => !log.beforeStateJson && !JSON.stringify(log.afterJson).includes("passwordHash")));
  console.log("PASS: registration -> pending login blocked -> admin approval -> login; forged session roles, API access, unauthorized and stale actions blocked; no credential/undo leakage in approval audit.");
}

void main();
