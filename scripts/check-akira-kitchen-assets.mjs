import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import config from "../next.config.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = path.join(root, "public/akira-kitchen");
const html = await readFile(path.join(folder, "index.html"), "utf8");
assert.match(html, /あきらくんと おりょうり/);
const links = [...html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map((match) => match[1]);
assert.ok(links.some((url) => url.startsWith("/akira-kitchen/_next/static/")));
for (const url of links) assert.ok(url.startsWith("/akira-kitchen/"), `Unscoped resource: ${url}`);
const sw = await readFile(path.join(folder, "sw.js"), "utf8");
const assets = JSON.parse(sw.match(/const ASSETS=(\[[^;]+\]);/)[1]);
assert.ok(assets.length >= 30);
for (const url of assets) {
  assert.ok(url.startsWith("/akira-kitchen/"), `Unscoped offline asset: ${url}`);
  const relative = url.slice("/akira-kitchen/".length) || "index.html";
  await readFile(path.join(folder, relative));
}
const release = JSON.parse(await readFile(path.join(folder, "release.json"), "utf8"));
for (const [file, hash] of Object.entries(release.files)) {
  assert.equal(createHash("sha256").update(await readFile(path.join(folder, file))).digest("hex"), hash, file);
}
const manifest = JSON.parse(await readFile(path.join(folder, "manifest.webmanifest"), "utf8"));
assert.equal(manifest.scope, "/akira-kitchen/");
assert.equal(manifest.start_url, "/akira-kitchen/");
const redirects = await config.redirects();
assert.ok(redirects.some((rule) => rule.source === "/akira-kitchen" && rule.destination === "/akira-kitchen/index.html"));
assert.ok(redirects.some((rule) => rule.source === "/design-fee-calculator" && rule.destination === "/design-fee-calculator/index.html"));
const headers = await config.headers();
for (const url of ["/akira-kitchen/sw.js", "/akira-kitchen/index.html"])
  assert.ok(headers.some((rule) => rule.source === url && rule.headers.some((header) => header.key === "Cache-Control" && header.value.includes("no-store"))));
console.log(JSON.stringify({ result: "passed", releaseFiles: Object.keys(release.files).length, precachedAssets: assets.length, resourcePaths: "scoped", hostRoutes: "preserved" }));
