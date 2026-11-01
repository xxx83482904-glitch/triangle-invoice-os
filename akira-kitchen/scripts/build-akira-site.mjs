import { spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
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
await cp(path.join(process.cwd(), "out/_next"), path.join(process.cwd(), "out/akira-kitchen/_next"), { recursive: true });
await generatePWA();
