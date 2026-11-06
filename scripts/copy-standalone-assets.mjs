import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveBuildSha } from "./build-sha.mjs";

async function copyIfExists(source, destination) {
  if (!existsSync(source)) return;
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

/**
 * @param {string} [root]
 * @param {Parameters<typeof resolveBuildSha>[0]} [options]
 */
export async function copyStandaloneAssets(root = process.cwd(), options = {}) {
  root = path.resolve(root);
  const standaloneRoot = path.join(root, ".next", "standalone");
  const marker = path.join(root, ".next", "triangle-build-sha");
  // A failed or SHA-less postbuild must not leave an earlier success marker.
  await rm(marker, { force: true });
  if (!existsSync(standaloneRoot)) return;

  await copyIfExists(path.join(root, ".next", "static"), path.join(standaloneRoot, ".next", "static"));
  await copyIfExists(path.join(root, "public"), path.join(standaloneRoot, "public"));

  // Publish completion only after both asset copies have succeeded.
  const sha = resolveBuildSha(options);
  if (sha) await writeFile(marker, `${sha}\n`, "utf8");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  copyStandaloneAssets().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
