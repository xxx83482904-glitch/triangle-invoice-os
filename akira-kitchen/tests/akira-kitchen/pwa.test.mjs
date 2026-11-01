import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generatePWA } from "../../scripts/build-akira-pwa.mjs";
const root = await mkdtemp(path.join(os.tmpdir(), "akira-pwa-test-"));
for (const folder of ["out/akira-kitchen/_next/static/chunks", "out/_next/static/chunks"])
  await mkdir(path.join(root, folder), { recursive: true });
for (const [file, body] of [
  ["akira-kitchen/index.html", "<h1>offline cooking</h1>"],
  ["akira-kitchen/_next/static/chunks/app.js", "/* cooking app */"],
  ["_next/static/chunks/host.js", "/* unrelated host app */"],
  ["akira-kitchen/chef.png", "image"],
  ["akira-kitchen/sw.js", "old worker"],
])
  await writeFile(path.join(root, "out", file), body);
const generated = await generatePWA(root);
const listeners = {},
  stores = new Map([
    ["unrelated-cache", new Map()],
    ["akira-cooking-old", new Map()],
  ]);
let claimed = false,
  network = 0;
const caches = {
  keys: async () => [...stores.keys()],
  delete: async (key) => stores.delete(key),
  open: async (key) => {
    if (!stores.has(key)) stores.set(key, new Map());
    const store = stores.get(key);
    return {
      addAll: async (urls) => {
        for (const url of urls) store.set(url, new Response(url));
      },
      match: async (key) =>
        store.get(typeof key === "string" ? key : key.url)?.clone(),
    };
  },
};
vm.runInNewContext(generated.worker, {
  URL,
  Response,
  caches,
  fetch: async () => {
    network++;
    throw new Error("offline");
  },
  self: {
    location: { origin: "https://example.test" },
    clients: {
      claim: async () => {
        claimed = true;
      },
    },
    addEventListener: (event, fn) => {
      listeners[event] = fn;
    },
  },
});
test("precache includes app shell, character and all chunk files", () => {
  assert.deepEqual(
    generated.assets.sort(),
    [
      "/akira-kitchen/_next/static/chunks/app.js",
      "/akira-kitchen/",
      "/akira-kitchen/chef.png",
    ].sort(),
  );
  assert.ok(!generated.assets.includes("/akira-kitchen/sw.js"));
});
test("installation caches atomically; activation removes only this apps old cache", async () => {
  let p;
  listeners.install({ waitUntil: (v) => (p = v) });
  await p;
  listeners.activate({ waitUntil: (v) => (p = v) });
  await p;
  assert.ok(claimed);
  assert.ok(stores.has("unrelated-cache"));
  assert.ok(!stores.has("akira-cooking-old"));
});
test("offline navigation and JS respond from precache without network", async () => {
  for (const [url, mode, expected] of [
    ["https://example.test/akira-kitchen/?x=1", "navigate", "/akira-kitchen/"],
    [
      "https://example.test/akira-kitchen/_next/static/chunks/app.js",
      "cors",
      "/akira-kitchen/_next/static/chunks/app.js",
    ],
  ]) {
    let p;
    listeners.fetch({
      request: { url, mode, method: "GET" },
      respondWith: (v) => (p = v),
    });
    assert.ok(p);
    assert.equal(await (await p).text(), expected);
  }
  assert.equal(network, 0);
});
test("worker ignores unrelated application routes, writes and external requests", () => {
  for (const request of [
    { url: "https://example.test/invoices", method: "GET", mode: "navigate" },
    { url: "https://example.test/api/data", method: "POST" },
    { url: "https://example.test/_next/static/chunks/host.js", method: "GET" },
    { url: "https://outside.test/image.png", method: "GET" },
  ]) {
    let handled = false;
    listeners.fetch({ request, respondWith: () => (handled = true) });
    assert.equal(handled, false);
  }
});
test("build changes invalidate the app cache", async () => {
  await writeFile(
    path.join(root, "out/akira-kitchen/_next/static/chunks/app.js"),
    "/* new build */",
  );
  assert.notEqual((await generatePWA(root)).version, generated.version);
});
