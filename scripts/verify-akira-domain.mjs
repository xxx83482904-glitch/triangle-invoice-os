import assert from "node:assert/strict";
import https from "node:https";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const origin = "https://akira.kuremasato.com";
const release = JSON.parse(await readFile(new URL("../public/akira-kitchen/release.json", import.meta.url), "utf8"));
function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "accept-encoding": "identity" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url);
        if (!redirects || next.origin !== origin) return reject(new Error("Unexpected redirect"));
        return resolve(get(next, redirects - 1));
      }
      const chunks = [];
      res.on("data", (data) => chunks.push(data));
      res.on("end", () => resolve({ url: String(url), status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.setTimeout(25000, () => req.destroy(new Error("HTTPS request timed out")));
    req.on("error", reject);
  });
}
const entry = await get(origin + "/");
assert.equal(entry.status, 200);
assert.match(entry.body.toString("utf8"), /あきらくんと おりょうり/);
assert.equal(new URL(entry.url).pathname, "/akira-kitchen/index.html");
const report = { origin, checkedAt: new Date().toISOString(), cache: release.cache, entry: { status: entry.status, finalUrl: entry.url }, files: [], excludedPaths: [], existingServices: [] };
const queue = Object.entries(release.files);
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const [file, expected] = queue.shift();
    assert.ok(!file.includes("..") && !file.startsWith("/"));
    const response = await get(origin + "/akira-kitchen/" + file + "?verify=" + release.cache);
    const actual = createHash("sha256").update(response.body).digest("hex");
    report.files.push({ file, status: response.status, matches: actual === expected, type: response.headers["content-type"] });
  }
}));
const worker = await get(origin + "/akira-kitchen/sw.js");
report.worker = { status: worker.status, cacheControl: worker.headers["cache-control"], type: worker.headers["content-type"], matchesCache: worker.body.toString("utf8").includes(release.cache) };
for (const path of ["/login", "/api/admin/deploy", "/design-fee-calculator/index.html"]) {
  const response = await get(origin + path);
  report.excludedPaths.push({ path, status: response.status });
}
for (const url of ["https://invoice.kuremasato.com/login", "https://invoice-cn.kuremasato.com/login", "https://trianglejp14f.synology.me/akira-kitchen/index.html"]) {
  const response = await get(url);
  report.existingServices.push({ url, status: response.status });
}
report.files.sort((a, b) => a.file.localeCompare(b.file));
report.passed = report.files.every((f) => f.status === 200 && f.matches)
  && report.excludedPaths.every((p) => p.status === 404)
  && report.existingServices.every((s) => s.status === 200)
  && report.worker.matchesCache && /javascript/.test(report.worker.type)
  && /no-store/.test(report.worker.cacheControl);
await writeFile(new URL("../docs/akira-kitchen-domain-verification.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, entry: report.entry, files: report.files.length, mismatches: report.files.filter((f) => !f.matches || f.status !== 200), worker: report.worker, excludedPaths: report.excludedPaths, existingServices: report.existingServices }));
if (!report.passed) process.exit(1);
