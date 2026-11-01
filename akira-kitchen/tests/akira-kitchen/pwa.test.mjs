import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createServer } from "node:http";
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
      "/akira-kitchen/index.html",
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
    ["https://example.test/akira-kitchen/?x=1", "navigate", "/akira-kitchen/index.html"],
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
    { url: "https://example.test/akira-kitchen-other/", method: "GET", mode: "navigate" },
    { url: "https://example.test/api/data", method: "POST" },
    { url: "https://example.test/_next/static/chunks/host.js", method: "GET" },
    { url: "https://outside.test/image.png", method: "GET" },
  ]) {
    let handled = false;
    listeners.fetch({ request, respondWith: () => (handled = true) });
    assert.equal(handled, false);
  }
});
test("offline reload returns a non-redirected response when the host redirects directories", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/akira-kitchen/") {
      res.writeHead(307, { location: "/akira-kitchen/index.html" });
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(req.url);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const redirected = await fetch(origin + "/akira-kitchen/");
    assert.equal(redirected.redirected, true, "fixture reproduces Synology's directory redirect");
    await redirected.text();
    const handlers = {}, stored = new Map();
    const cache = {
      addAll: async (urls) => {
        for (const url of urls) stored.set(url, await fetch(origin + url));
      },
      match: async (url) => stored.get(url)?.clone(),
    };
    vm.runInNewContext(generated.worker, {
      URL, Response, caches: { open: async () => cache },
      fetch: () => { throw new Error("offline"); },
      self: { location: { origin }, addEventListener: (type, handler) => { handlers[type] = handler; } },
    });
    let installation;
    handlers.install({ waitUntil: (promise) => { installation = promise; } });
    await installation;
    for (const path of ["/akira-kitchen/", "/akira-kitchen/index.html"]) {
      let navigation;
      handlers.fetch({
        request: { url: origin + path, method: "GET", mode: "navigate", redirect: "manual" },
        respondWith: (promise) => { navigation = promise; },
      });
      const response = await navigation;
      assert.equal(response.redirected, false, "redirected responses cause browser navigation errors");
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "/akira-kitchen/index.html");
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test("build changes invalidate the app cache", async () => {
  await writeFile(
    path.join(root, "out/akira-kitchen/_next/static/chunks/app.js"),
    "/* new build */",
  );
  assert.notEqual((await generatePWA(root)).version, generated.version);
});
