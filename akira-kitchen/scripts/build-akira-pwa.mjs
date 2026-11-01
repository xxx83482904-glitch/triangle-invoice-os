import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
export async function generatePWA(root = process.cwd()) {
  const out = path.join(root, "out");
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) =>
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
  const assets = files
    .map((f) => "/" + path.relative(out, f).replaceAll("\\", "/"))
    .filter((f) => !f.endsWith("index.html"));
  assets.unshift("/akira-kitchen/");
  const hash = createHash("sha256");
  for (const file of files) hash.update(await readFile(file));
  const version = hash.digest("hex").slice(0, 16);
  const worker = `/* Generated from the complete static build. */
const CACHE='akira-cooking-${version}';
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('akira-cooking-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'&&url.pathname.startsWith('/akira-kitchen')){
  event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match('/akira-kitchen/'))||fetch(event.request)));return;
 }
 if(!ASSETS.includes(url.pathname))return;
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(event.request)));
});
`;
  await writeFile(path.join(out, "akira-kitchen/sw.js"), worker);
  await writeFile(
    path.join(root, "pwa-build.json"),
    JSON.stringify(
      {
        version,
        assets: assets.length,
        scope: "/akira-kitchen/",
        offlineEntry: "/akira-kitchen/",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`PWA: ${assets.length} local assets, cache ${version}`);
  return { assets, version, worker };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(
      new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"),
    )
)
  await generatePWA();
