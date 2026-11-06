import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { sidebarAttribute, sidebarInitScript, sidebarStorageKey } from "../src/lib/sidebar-preference";

test("sidebar attributes retain the two existing saved preferences", () => {
  assert.equal(sidebarAttribute("expanded"), "expanded");
  assert.equal(sidebarAttribute("collapsed"), "collapsed");
});

test("a missing sidebar preference leaves the attribute unset for CSS auto mode", () => {
  assert.equal(sidebarAttribute(null), null);
});

test("invalid sidebar preferences are treated as missing", () => {
  for (const stored of ["", "auto", "true", "false", "EXPANDED", " collapsed ", "unknown", "<script>"]) {
    assert.equal(sidebarAttribute(stored), null);
  }
});

function runInit(storage: { getItem: (key: string) => string | null }, initial?: string) {
  const attributes = new Map(initial ? [["data-sidebar", initial]] : []);
  runInNewContext(sidebarInitScript, {
    window: { localStorage: storage },
    document: {
      documentElement: {
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        removeAttribute: (key: string) => attributes.delete(key),
      },
    },
  });
  return attributes;
}

for (const stored of ["expanded", "collapsed", null, "auto", "invalid"]) {
  test(`the pre-paint script applies ${JSON.stringify(stored)} without requiring a viewport`, () => {
    const attributes = runInit({ getItem: (key) => {
      assert.equal(key, sidebarStorageKey);
      return stored;
    } }, "stale");
    assert.equal(attributes.get("data-sidebar") ?? null, sidebarAttribute(stored));
    assert.equal(attributes.size, sidebarAttribute(stored) === null ? 0 : 1);
  });
}

test("a failed storage read does not prevent auto mode or throw before paint", () => {
  const attributes = runInit({ getItem: () => { throw new Error("Storage unavailable"); } });
  assert.equal(attributes.size, 0);
});

test("blocked access to localStorage does not throw before paint", () => {
  assert.doesNotThrow(() => runInNewContext(sidebarInitScript, {
    window: { get localStorage() { throw new Error("Access denied"); } },
  }));
});
