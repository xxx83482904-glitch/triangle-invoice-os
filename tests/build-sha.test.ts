import assert from "node:assert/strict";
import test from "node:test";
import { resolveBuildSha } from "../scripts/build-sha.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";
const noGit = () => { assert.fail("An explicit SHA must not run Git"); };

test("build SHA uses the explicit environment value before Git", () => {
  assert.equal(resolveBuildSha({ env: { TRIANGLE_BUILD_SHA: sha }, run: noGit }), sha);
});

test("build SHA trims and lowercases an explicit value", () => {
  assert.equal(resolveBuildSha({ env: { TRIANGLE_BUILD_SHA: ` \n${sha.toUpperCase()}\t` }, run: noGit }), sha);
});

test("build SHA falls back to git rev-parse HEAD for unset, empty or blank values", () => {
  for (const value of [undefined, "", " \n\t "]) {
    const calls: [string, string[]][] = [];
    const result = resolveBuildSha({
      env: { TRIANGLE_BUILD_SHA: value },
      run: (command, args) => { calls.push([command, args]); return ` ${sha.toUpperCase()}\n`; },
    });
    assert.equal(result, sha);
    assert.deepEqual(calls, [["git", ["rev-parse", "HEAD"]]]);
  }
});

test("build SHA rejects explicit junk without falling back to Git", () => {
  for (const value of ["junk", sha.slice(0, 7), `${sha}0`, `${sha.slice(0, 39)}g`, `${sha}\n${sha}`]) {
    assert.equal(resolveBuildSha({ env: { TRIANGLE_BUILD_SHA: value }, run: noGit }), "");
  }
});

test("build SHA rejects invalid Git output", () => {
  for (const value of ["", " \n", "HEAD", sha.slice(0, 7), `${sha}0`, `${sha.slice(0, 39)}g`]) {
    assert.equal(resolveBuildSha({ env: {}, run: () => value }), "");
  }
});

test("build SHA is unknown when Git fails", () => {
  assert.equal(resolveBuildSha({ env: {}, run: () => { throw new Error("No Git metadata"); } }), "");
});
