import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { copyStandaloneAssets } from "../scripts/copy-standalone-assets.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";

function fixture(t: TestContext, standalone = true) {
  const parent = path.resolve(tmpdir());
  const root = path.resolve(mkdtempSync(path.join(parent, "triangle-postbuild-")));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("triangle-postbuild-"));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(path.join(root, ".next", "static"), { recursive: true });
  mkdirSync(path.join(root, "public"), { recursive: true });
  writeFileSync(path.join(root, ".next", "static", "asset.js"), "static asset");
  writeFileSync(path.join(root, "public", "asset.txt"), "public asset");
  if (standalone) {
    mkdirSync(path.join(root, ".next", "standalone"), { recursive: true });
    writeFileSync(path.join(root, ".next", "standalone", "server.js"), "// fake server");
  }
  return { root, marker: path.join(root, ".next", "triangle-build-sha") };
}

test("postbuild copies static and public assets before writing exactly the SHA and LF", async (t) => {
  const { root, marker } = fixture(t);
  await copyStandaloneAssets(root, {
    env: {},
    run: () => {
      assert.equal(existsSync(marker), false);
      assert.equal(readFileSync(path.join(root, ".next", "standalone", ".next", "static", "asset.js"), "utf8"), "static asset");
      assert.equal(readFileSync(path.join(root, ".next", "standalone", "public", "asset.txt"), "utf8"), "public asset");
      return `${sha}\n`;
    },
  });
  assert.deepEqual(readFileSync(marker), Buffer.from(`${sha}\n`));
});

test("postbuild uses the same normalized explicit SHA as the Next config", async (t) => {
  const { root, marker } = fixture(t);
  await copyStandaloneAssets(root, {
    env: { TRIANGLE_BUILD_SHA: ` ${sha.toUpperCase()}\n` },
    run: () => { assert.fail("Explicit SHA must win"); },
  });
  assert.equal(readFileSync(marker, "utf8"), `${sha}\n`);
});

test("postbuild leaves no marker for invalid explicit or Git SHAs, or Git failure", async (t) => {
  const { root, marker } = fixture(t);
  for (const options of [
    { env: { TRIANGLE_BUILD_SHA: "invalid" }, run: () => sha },
    { env: {}, run: () => "not a SHA" },
    { env: {}, run: () => "" },
    { env: {}, run: () => { throw new Error("No Git metadata"); } },
  ]) {
    writeFileSync(marker, `${sha}\n`);
    await copyStandaloneAssets(root, options);
    assert.equal(existsSync(marker), false);
    assert.equal(readFileSync(path.join(root, ".next", "standalone", "public", "asset.txt"), "utf8"), "public asset");
  }
});

test("postbuild leaves no marker when standalone output is absent", async (t) => {
  const { root, marker } = fixture(t, false);
  writeFileSync(marker, `${sha}\n`);
  await copyStandaloneAssets(root, { env: { TRIANGLE_BUILD_SHA: sha } });
  assert.equal(existsSync(marker), false);
});

test("postbuild removes an old marker and never publishes completion when an asset copy fails", async (t) => {
  const { root, marker } = fixture(t);
  writeFileSync(marker, `${sha}\n`);
  // A file in place of the destination's parent blocks the static copy.
  writeFileSync(path.join(root, ".next", "standalone", ".next"), "not a directory");
  await assert.rejects(copyStandaloneAssets(root, { env: { TRIANGLE_BUILD_SHA: sha } }));
  assert.equal(existsSync(marker), false);
});
