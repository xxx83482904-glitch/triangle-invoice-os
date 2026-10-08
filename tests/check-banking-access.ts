import assert from "node:assert/strict";
import { SignJWT } from "jose";

async function main() {
  const base = new URL(process.argv[2] || "http://localhost:3018");
  if (!["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("Only a disposable local preview may be tested");
  const secret = new TextEncoder().encode("triangle-invoice-os-local-development-secret");
  const cookie = async (id: string) => `triangle-session=${await new SignJWT({ id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1m").sign(secret)}`;
  const api = new URL("/api/banking/sync?company=JAPAN", base);
  assert.equal((await fetch(api)).status, 401);
  const adminCookie = await cookie("admin");
  const allowed = await fetch(api, { headers: { Cookie: adminCookie } });
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get("cache-control"), "no-store");
  assert.equal((await allowed.json()).configured, false);
  const japan = await fetch(new URL("/banking?company=JAPAN", base), { headers: { Cookie: adminCookie } });
  assert.equal(japan.status, 200); assert.match(await japan.text(), /テスト法人カード/);
  const china = await fetch(new URL("/banking?company=CHINA", base), { headers: { Cookie: adminCookie } });
  assert.equal(china.status, 200); assert.doesNotMatch(await china.text(), /テスト法人カード|テスト交通費/);
  assert.equal((await fetch(api, { headers: { Cookie: await cookie("accounting") } })).status, 200);
  for (const id of ["billing_editor", "mail_editor"]) {
    const auth = await cookie(id);
    assert.equal((await fetch(api, { headers: { Cookie: auth } })).status, 403);
    assert.equal((await fetch(api, { method: "POST", headers: { Cookie: auth, Origin: base.origin, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "recent" }) })).status, 403);
    const page = await fetch(new URL("/banking?company=JAPAN", base), { headers: { Cookie: auth }, redirect: "manual" });
    assert.equal(page.status, 307);
  }
  for (const origin of [undefined, "https://untrusted.example.invalid"]) {
    const response = await fetch(api, { method: "POST", headers: { Cookie: adminCookie, "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ mode: "recent" }) });
    assert.equal(response.status, 403);
  }
  const unconfigured = await fetch(api, { method: "POST", headers: { Cookie: adminCookie, Origin: base.origin, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "recent" }) });
  assert.equal(unconfigured.status, 400); assert.match((await unconfigured.json()).error, /未設定/);
  console.log("PASS: unauthenticated access, role limits, company isolation, origin protection, and unconfigured sync");
}
void main();
