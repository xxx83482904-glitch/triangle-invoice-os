import { spawnSync } from "node:child_process";
import { cp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { generatePWA } from "./build-akira-pwa.mjs";
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build", "--webpack"],
  {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_AKIRA_STANDALONE: "1" },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await cp(
  path.join(process.cwd(), "out/_next"),
  path.join(process.cwd(), "out/akira-kitchen/_next"),
  { recursive: true },
);
// Keep editing masters in source control, outside the deployed runtime.
const exportRoot = path.resolve(process.cwd(), "out/akira-kitchen");
for (const name of await readdir(exportRoot)) {
  if (/^illustration-.*\.png$/.test(name))
    await rm(path.join(exportRoot, name));
}
await rm(path.join(exportRoot, "fonts/MPLUSRounded1c-Black.ttf"), {
  force: true,
});
await generatePWA();
