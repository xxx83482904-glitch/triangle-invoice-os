import assert from "node:assert/strict";
import test from "node:test";
import { BASES, MAX_PIECES, MAX_WORKS, constrainPosition, createLocalId, getColors, missionProgress, newRecipe, parseRecipe, readSavedState } from "../src/app/akira-kitchen/model.ts";

const piece = (food, index = 0) => ({ id: `piece-${index}`, food, x: 50, y: 43, rotation: 0 });
const withFood = (mode, foods, mission = null) => ({ ...newRecipe(mode, mission), items: foods.map(piece) });

test("color discovery counts distinct colors, not the number of ingredients", () => {
  const recipe = withFood("bento", ["tomato", "sausage", "egg"], "rainbow");
  assert.equal(getColors(recipe.items).length, 2);
  assert.equal(missionProgress(recipe).complete, false);
  recipe.items.push(piece("broccoli", 3));
  assert.equal(missionProgress(recipe).complete, true);
  recipe.items.push(piece("rice", 4));
  assert.equal(missionProgress(recipe).complete, true);
});

test("count challenge requires exactly three strawberries and ignores other food", () => {
  const recipe = withFood("cake", ["strawberry", "strawberry", "cream"], "berries");
  assert.equal(missionProgress(recipe).complete, false);
  recipe.items.push(piece("strawberry", 3));
  assert.equal(missionProgress(recipe).complete, true);
  recipe.items.push(piece("strawberry", 4));
  assert.equal(missionProgress(recipe).complete, false);
  assert.match(missionProgress(recipe).hint, /1こ はずす/);
});

test("shape challenge counts onigiri and free play does not require a challenge", () => {
  assert.equal(missionProgress(withFood("bento", ["rice", "egg", "rice"], "triangles")).complete, true);
  assert.equal(missionProgress(withFood("bento", ["rice", "rice", "rice"], "triangles")).complete, false);
  assert.equal(missionProgress(newRecipe("bento")), null);
});

test("dragging outside either dish keeps food inside its usable surface", () => {
  for (const x of [-500, 0, 20, 50, 80, 100, 700]) for (const y of [-500, 0, 30, 50, 100, 700]) {
    const bento = constrainPosition("bento", x, y);
    assert.ok(bento.x >= 24 && bento.x <= 76 && bento.y >= 33 && bento.y <= 65);
    const cake = constrainPosition("cake", x, y);
    assert.ok(Math.hypot((cake.x - 50) / 25, (cake.y - 43) / 18) <= 1.00001);
  }
});

test("saved data survives a JSON round trip including layout, flavor, and settings", () => {
  const recipe = { ...withFood("cake", ["strawberry", "cream"], "berries"), base: "chocolate" };
  const work = { ...recipe, id: "art-1", title: "あきらのケーキ", createdAt: "2026-11-01T00:00:00.000Z", missionComplete: false };
  const value = { version: 1, works: [work], draft: recipe, settings: { sound: false, voice: true } };
  assert.deepEqual(readSavedState(JSON.stringify(value)), value);
});

test("broken or unsupported storage recovers to usable defaults", () => {
  for (const input of [null, "", "{broken", "null", "[]", '{"version":99}', '{"version":1,"works":{}}']) {
    const result = readSavedState(input);
    assert.deepEqual(result.works, []);
    assert.equal(result.draft, null);
    assert.equal(result.settings.sound, true);
  }
});

test("stored food is validated, deduplicated and clamped without trusting achievement flags", () => {
  const recipe = parseRecipe({ mode: "bento", base: "unknown", mission: "berries", items: [
    piece("rice"), piece("egg"), piece("not-a-food", 1), piece("cream", 2),
    { ...piece("tomato", 3), x: Infinity }, { ...piece("broccoli", 4), x: 999, y: -999, rotation: 90 },
  ] });
  assert.equal(recipe.base, BASES.bento[0].id);
  assert.equal(recipe.mission, null);
  assert.equal(recipe.items.length, 2);
  assert.deepEqual(recipe.items[1], { id: "piece-4", food: "broccoli", x: 76, y: 33, rotation: 30 });
  const saved = readSavedState(JSON.stringify({ version: 1, works: [{ ...newRecipe("cake", "berries"), id: "1", title: "test", createdAt: "2026-11-01", missionComplete: true }] }));
  assert.equal(saved.works[0].missionComplete, false);
});

test("stored collections obey size limits, invalid dates and duplicate artwork are rejected", () => {
  const recipe = parseRecipe(withFood("bento", Array.from({ length: 100 }, () => "rice")));
  assert.equal(recipe.items.length, MAX_PIECES);
  const works = Array.from({ length: 100 }, (_, i) => ({ ...newRecipe("bento"), id: String(i), title: "test", createdAt: "2026-11-01" }));
  assert.equal(readSavedState(JSON.stringify({ version: 1, works })).works.length, MAX_WORKS);
  assert.equal(readSavedState(JSON.stringify({ version: 1, works: [works[0], works[0], { ...works[1], createdAt: "bad" }] })).works.length, 1);
});

test("a local HTTP iPad can generate unique IDs without crypto.randomUUID", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const secureRandom = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: secureRandom } });
    const ids = Array.from({ length: 100 }, () => createLocalId());
    assert.equal(new Set(ids).size, 100);
    assert.ok(ids.every((id) => /^[a-f0-9]{32}$/.test(id)));
  } finally { Object.defineProperty(globalThis, "crypto", original); }
});
