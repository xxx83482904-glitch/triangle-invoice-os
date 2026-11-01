import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "./test-server.mjs";
const server = await startServer(),
  browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
const runs = [];
try {
  for (const mbps of [4, 1.6])
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 2,
        serviceWorkers: "block",
      });
      const page = await context.newPage(),
        cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: (mbps * 1000000) / 8,
        uploadThroughput: 750000 / 8,
        connectionType: "cellular4g",
      });
      await page.addInitScript(() => {
        const ready = () => {
          const images = [...document.images].filter((i) =>
            /home-bento|home-cake|chef-home/.test(i.src),
          );
          if (
            images.length === 3 &&
            images.every((i) => i.complete && i.naturalWidth) &&
            !window.__homeReady
          )
            window.__homeReady = performance.now();
        };
        document.addEventListener("load", ready, true);
        document.addEventListener("DOMContentLoaded", ready);
      });
      await page.goto(server.base, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__homeReady > 0);
      await page.waitForSelector('[data-screen="1"][aria-busy="false"]');
      const data = await page.evaluate(() => ({
        homeImagesMs: Math.round(window.__homeReady),
        measuredAtMs: Math.round(performance.now()),
        paint: performance
          .getEntriesByType("paint")
          .map((p) => ({ name: p.name, ms: Math.round(p.startTime) })),
        transferBytes: performance
          .getEntriesByType("resource")
          .reduce((s, p) => s + p.transferSize, 0),
      }));
      runs.push({
        mbps,
        latencyMs: 150,
        deviceScaleFactor: 2,
        cache: "cold",
        ...data,
      });
      console.log(JSON.stringify(runs.at(-1)));
      await context.close();
    }
} finally {
  const output = path.resolve(
    fileURLToPath(
      new URL("../../docs/akira-kitchen/qa/browser-v3/", import.meta.url),
    ),
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "performance.json"),
    JSON.stringify(
      {
        conditions:
          "Local static export with gzip, Chrome CDP throughput/latency; no CPU throttle; all home meal/chef images decoded",
        runs,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await server.close();
}
