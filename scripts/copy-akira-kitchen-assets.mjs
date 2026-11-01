import { cp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const from = path.join(root, "akira-kitchen/out/akira-kitchen");
const to = path.join(root, "public/akira-kitchen");
// Copy the already checked export only. No invoice app/runtime files are inputs.
await readFile(path.join(from, "index.html"));
await readFile(path.join(from, "sw.js"));
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
// Remove only superseded runtime masters inside the explicit cooking-app target.
// Original PNG/TTF sources remain in akira-kitchen/public for future editing.
for (const name of await readdir(to)) {
  if (/^illustration-[a-z0-9-]+\.png$/.test(name))
    await rm(path.join(to, name));
}
await rm(path.join(to, "fonts/MPLUSRounded1c-Black.ttf"), { force: true });

async function walk(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) => {
        const p = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(p) : [p];
      }),
    )
  ).flat();
}
const files = {};
for (const file of (await walk(from)).sort()) {
  files[path.relative(from, file).replaceAll("\\", "/")] = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
const version = JSON.parse(
  await readFile(path.join(root, "akira-kitchen/package.json"), "utf8"),
).version;
const cache = JSON.parse(
  await readFile(path.join(root, "akira-kitchen/pwa-build.json"), "utf8"),
);
await writeFile(
  path.join(to, "release.json"),
  JSON.stringify(
    { app: "akira-kitchen", version, cache: cache.version, files },
    null,
    2,
  ) + "\n",
);
console.log(
  `Published ${Object.keys(files).length} static files under /akira-kitchen/ (cache ${cache.version}).`,
);
