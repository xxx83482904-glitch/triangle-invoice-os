import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
export async function generatePWA(root = process.cwd()) {
  const out = path.join(root, "out");
  async function walk(directory) {
    return (
      await Promise.all(
        (await readdir(directory, { withFileTypes: true })).map((e) =>
          e.isDirectory()
            ? walk(path.join(directory, e.name))
            : [path.join(directory, e.name)],
        ),
      )
    ).flat();
  }
  const files = (await walk(out)).filter((f) => {
    const p = path.relative(out, f).replaceAll("\\", "/");
    return (
      p.startsWith("akira-kitchen/") &&
      !p.endsWith("sw.js") &&
      !p.endsWith(".txt") &&
      !p.endsWith(".map")
    );
  });
  const assets = files.map(
    (f) => "/" + path.relative(out, f).replaceAll("\\", "/"),
  );
  const isStartup = (url) =>
    url.includes("/_next/") ||
    url.endsWith("/index.html") ||
    url.endsWith(".webmanifest") ||
    url.includes("/fonts/") ||
    /\/(?:icon[^/]*|apple-touch-icon)\.(?:png|svg)$/.test(url) ||
    /\/media\/(?:home-|chef-home|title-cloud)/.test(url) ||
    /\/audio\/(?:home|rotate-device|tap-here)\.mp3$/.test(url);
  const precache = assets.filter(isStartup);
  const precacheBytes = (
    await Promise.all(
      files
        .filter((_, i) => isStartup(assets[i]))
        .map(async (f) => (await stat(f)).size),
    )
  ).reduce((a, b) => a + b, 0);
  if (precacheBytes > 8000000) throw new Error("Startup precache exceeds 8MB");
  const runtime = await readFile(new URL("./worker-runtime.js", import.meta.url), "utf8");
  const hash = createHash("sha256");
  hash.update(runtime);
  hash.update(JSON.stringify(assets));
  for (const f of files) hash.update(await readFile(f));
  const version = hash.digest("hex").slice(0, 16);
  const worker =
    "/* Home-only precache; scoped runtime cache and idle warm-up. */\n" +
    "const CACHE='akira-cooking-" +
    version +
    "';\n" +
    "const ASSETS=" +
    JSON.stringify(assets) +
    ";\n" +
    "const PRECACHE=" +
    JSON.stringify(precache) +
    ";\n" +
    runtime;
  await writeFile(path.join(out, "akira-kitchen/sw.js"), worker);
  await writeFile(
    path.join(root, "pwa-build.json"),
    JSON.stringify(
      {
        version,
        assets: assets.length,
        precacheAssets: precache.length,
        precacheBytes,
        scope: "/akira-kitchen/",
        offlineEntry: "/akira-kitchen/index.html",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PWA: " +
      precache.length +
      " startup assets, " +
      precacheBytes +
      " bytes; " +
      assets.length +
      " allowed runtime files.",
  );
  return { assets, precache, precacheBytes, version, worker };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await generatePWA();
