import test from "node:test";
import assert from "node:assert/strict";
import { indexedDB, IDBObjectStore } from "fake-indexeddb";
import { bundle } from "./bundle.mjs";
import { newRecipe } from "../../src/app/akira-kitchen/cooking-model.ts";
globalThis.indexedDB = indexedDB;
const storage = await bundle(
  "storage-compat",
  "src/app/akira-kitchen/cooking-storage.ts",
);
const make = () => {
  const recipe = newRecipe("bento");
  return {
    id: recipe.id,
    createdAt: new Date().toISOString(),
    recipe,
    image: new Blob(
      ['<svg xmlns="http://www.w3.org/2000/svg"><circle r="20"/></svg>'],
      { type: "image/svg+xml" },
    ),
  };
};
test("normal Blob and WebKit byte fallback coexist in the same album", async () => {
  const first = make();
  await storage.putArtwork(first);
  const original = IDBObjectStore.prototype.put;
  const second = make();
  let fallback = 0;
  IDBObjectStore.prototype.put = function (value, ...args) {
    if (value.image instanceof Blob) {
      fallback++;
      throw new DOMException("WebKit Blob unavailable", "UnknownError");
    }
    return original.call(this, value, ...args);
  };
  try {
    await storage.putArtwork(second);
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  const works = await storage.listArtworks();
  assert.equal(fallback, 1);
  assert.equal(works.length, 2);
  for (const work of [first, second]) {
    const stored = works.find((w) => w.id === work.id);
    assert.ok(stored.image instanceof Blob);
    assert.equal(await stored.image.text(), await work.image.text());
    assert.deepEqual(stored.recipe, work.recipe);
  }
  await storage.deleteArtwork(second.id);
  assert.equal((await storage.listArtworks()).length, 1);
});
test("quota errors propagate for retry and leave previous artwork untouched", async () => {
  const before = await storage.listArtworks(),
    original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () {
    throw new DOMException("full", "QuotaExceededError");
  };
  try {
    await assert.rejects(storage.putArtwork(make()), {
      name: "QuotaExceededError",
    });
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  assert.deepEqual(
    (await storage.listArtworks()).map((w) => w.id),
    before.map((w) => w.id),
  );
});
