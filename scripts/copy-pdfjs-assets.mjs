import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The in-app PDF viewer loads pdf.js's worker, CMaps (Japanese fonts that are not embedded),
// standard fonts and image decoders from /pdfjs. Copy them from the installed package so the
// files always match the library version; public/pdfjs is generated and not committed.
export async function copyPdfjsAssets(root = process.cwd()) {
  root = path.resolve(root);
  const require = createRequire(path.join(root, "package.json"));
  const packageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const target = path.join(root, "public", "pdfjs");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(path.join(packageRoot, "build", "pdf.worker.min.mjs"), path.join(target, "pdf.worker.min.mjs"));
  for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
    const source = path.join(packageRoot, folder);
    if (existsSync(source)) await cp(source, path.join(target, folder), { recursive: true });
  }
  return target;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  copyPdfjsAssets().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
