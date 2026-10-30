import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { fromBuffer } from "yauzl";

async function main() {
  const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3041";
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Local fixtures only");
  const query = "company=JAPAN&start=2026-09-01&end=2027-08-31&basis=document&undated=1";
  async function request(scope: string, format: string, id?: string, extra = "") {
    const token = id ? await new SignJWT({ id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode("triangle-invoice-os-local-development-secret")) : "";
    return fetch(`${base}/api/section-export?${query}&scope=${scope}&format=${format}${extra}`, { headers: token ? { cookie: `triangle-session=${token}` } : {}, redirect: "manual" });
  }
  assert.equal((await request("all", "zip")).status, 401);
  for (const id of ["manager", "mail", "billing"]) assert.equal((await request("all", "zip", id)).status, 403);
  assert.equal((await request("received", "zip", "billing")).status, 403);
  assert.equal((await request("issued", "csv", "billing")).status, 200);
  assert.equal((await request("estimate", "csv", "billing")).status, 200);
  assert.equal((await request("mail", "csv", "mail")).status, 200);
  assert.equal((await request("all", "zip", "admin", "&company=CHINA")).status, 403);
  assert.equal((await request("all", "zip", "admin", "&start=2026-02-30")).status, 400);
  for (const scope of ["issued", "estimate", "received", "mail", "banking", "all"]) {
    const response = await request(scope, "preview", "admin"); assert.equal(response.status, 200);
    const preview = await response.json(); assert.ok(preview.documents.every((r: { sourceId: string }) => r.sourceId !== "issued-cn"));
    const csv = await request(scope, "csv", "admin"); assert.equal(csv.status, 200);
    assert.ok(csv.headers.get("cache-control")?.includes("no-store"));
    const zipResponse = await request(scope, "zip", "admin"); assert.equal(zipResponse.status, 200);
    assert.equal(zipResponse.headers.get("content-type"), "application/zip");
    const bytes = Buffer.from(await zipResponse.arrayBuffer());
    const entries = await new Promise<string[]>((resolve, reject) => fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const names: string[] = []; zip.on("error", reject); zip.on("end", () => resolve(names));
      zip.on("entry", (entry) => { names.push(entry.fileName); zip.readEntry(); }); zip.readEntry();
    }));
    assert.ok(entries.includes("index.html")); assert.ok(entries.includes("manifest.json"));
    if (scope !== "banking") assert.ok(entries.some((p) => p.startsWith("files/")), `${scope}: original or generated PDFs must be included`);
    console.log(`${scope}: preview ${preview.documents.length} documents / ${preview.bank.length} transactions; ZIP ${bytes.length} bytes, ${entries.length} entries`);
  }
  console.log("Section export API checks passed: authorization, periods, CSV, streamed ZIP, originals and generated PDFs.");
}
void main();
