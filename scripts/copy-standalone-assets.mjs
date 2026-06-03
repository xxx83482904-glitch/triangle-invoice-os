import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneRoot = path.join(root, ".next", "standalone");

async function copyIfExists(source, destination) {
  if (!existsSync(source)) return;
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

if (existsSync(standaloneRoot)) {
  await copyIfExists(path.join(root, ".next", "static"), path.join(standaloneRoot, ".next", "static"));
  await copyIfExists(path.join(root, "public"), path.join(standaloneRoot, "public"));
}
