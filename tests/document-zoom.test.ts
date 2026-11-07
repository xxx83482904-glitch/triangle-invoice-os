import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clampZoom, fitScale, nextZoomStep, ZOOM_MAX, ZOOM_MIN } from "../src/lib/document-zoom";
import { copyPdfjsAssets } from "../scripts/copy-pdfjs-assets.mjs";

test("zoom stays within bounds and survives bad input", () => {
  assert.equal(clampZoom(0), ZOOM_MIN);
  assert.equal(clampZoom(100), ZOOM_MAX);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(clampZoom(1.23456), 1.235);
});

test("zoom buttons move to the next preset from any current value", () => {
  assert.equal(nextZoomStep(1, 1), 1.25);
  assert.equal(nextZoomStep(1, -1), 0.75);
  assert.equal(nextZoomStep(0.83, 1), 1);
  assert.equal(nextZoomStep(0.83, -1), 0.75);
  assert.equal(nextZoomStep(6, 1), ZOOM_MAX);
  assert.equal(nextZoomStep(0.2, -1), ZOOM_MIN);
});

test("fit modes use the widest page for width and the first page for a whole-page view", () => {
  const pages = [{ width: 600, height: 800 }, { width: 800, height: 600 }];
  assert.equal(fitScale("width", pages, { width: 400, height: 300 }), 0.5);
  assert.equal(fitScale("page", pages, { width: 400, height: 300 }), 0.375);
  assert.equal(fitScale("page", [{ width: 400, height: 200 }], { width: 800, height: 1000 }), 2);
  assert.equal(fitScale("width", [], { width: 800, height: 600 }), 1);
});

test("pdf.js assets are copied from the installed package into public/pdfjs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pdfjs-assets-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}");
    // Resolve the real package from this repository by pointing node_modules at it.
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
    const target = await copyPdfjsAssets(root);
    for (const file of ["pdf.worker.min.mjs", "cmaps/UniJIS-UCS2-H.bcmap", "standard_fonts", "wasm"]) assert.ok(existsSync(path.join(target, file)), file);
    const version = JSON.parse(await readFile(path.resolve("node_modules/pdfjs-dist/package.json"), "utf8")).version;
    assert.ok((await readFile(path.join(target, "pdf.worker.min.mjs"), "utf8")).includes(version));
  } finally { await rm(root, { recursive: true, force: true }); }
});
