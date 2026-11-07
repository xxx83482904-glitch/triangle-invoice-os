import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBuildSha, rememberRunningBuild, runningBuildSha } from "../src/lib/build-info";

const original = "0123456789abcdef0123456789abcdef01234567";
const replacement = "abcdef0123456789abcdef0123456789abcdef01";
const key = Symbol.for("triangle.runningBuildSha");

function isolatedBuild(check: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Reflect.deleteProperty(globalThis, key);
  try { check(); }
  finally {
    Reflect.deleteProperty(globalThis, key);
    if (previous) Object.defineProperty(globalThis, key, previous);
  }
}

test("build SHA normalization accepts full hex, trims and lowercases", () => {
  assert.equal(normalizeBuildSha(original), original);
  assert.equal(normalizeBuildSha(` \n${original.toUpperCase()}\t`), original);
});

test("build SHA normalization rejects short, long, junk and non-string values", () => {
  for (const value of ["", " ", original.slice(0, 7), `${original}0`, `${original.slice(0, 39)}g`, "not-a-sha", null, undefined, 42, {}, [original]]) {
    assert.equal(normalizeBuildSha(value), null);
  }
});

test("the first startup SHA wins and is shared under the process-global symbol", () => isolatedBuild(() => {
  assert.equal(runningBuildSha(), null);
  rememberRunningBuild(original);
  assert.equal(Reflect.get(globalThis, key), original);
  rememberRunningBuild(replacement);
  rememberRunningBuild(null);
  assert.equal(runningBuildSha(), original);
}));

test("an unknown startup SHA also wins, with no fallback to an inlined environment value", () => isolatedBuild(() => {
  const previous = process.env.TRIANGLE_BUILD_SHA;
  process.env.TRIANGLE_BUILD_SHA = replacement;
  try {
    assert.equal(runningBuildSha(), null);
    rememberRunningBuild(null);
    rememberRunningBuild(replacement);
    assert.equal(runningBuildSha(), null);
  } finally {
    if (previous === undefined) delete process.env.TRIANGLE_BUILD_SHA;
    else process.env.TRIANGLE_BUILD_SHA = previous;
  }
}));
