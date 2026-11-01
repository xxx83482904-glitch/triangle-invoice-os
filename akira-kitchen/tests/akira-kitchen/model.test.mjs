import test from "node:test";
import assert from "node:assert/strict";
import {
  newRecipe,
  progress,
  STAGES,
  addPiece,
  movePiece,
  place,
  bound,
  MAX_PIECES,
  parseSession,
  parseRecipe,
  parseSettings,
  BACK,
  NEXT,
  TITLES,
} from "../../src/app/akira-kitchen/cooking-model.ts";
test("all 17 screens have a title and a route back home; workflow has no dead ends", () => {
  for (let i = 1; i <= 17; i++) {
    assert.ok(TITLES[i]);
    let cursor = i;
    for (let n = 0; n < 18 && cursor !== 1; n++) cursor = BACK[cursor];
    assert.equal(cursor, 1);
  }
  for (const path of [
    [3, 4, 5, 6, 7, 8, 9, 10, 16],
    [11, 12, 13, 14, 15, 16],
  ])
    for (let i = 0; i < path.length - 1; i++)
      assert.equal(NEXT[path[i]], path[i + 1]);
});
test("all cooking stages finish with imprecise taps, never skip a whole stage", () => {
  for (const [process, stages] of Object.entries(STAGES)) {
    let r = newRecipe("bento");
    r = progress(r, process, 999);
    assert.equal(r.progress[process], 1);
    for (let i = 0; i < 100; i++) r = progress(r, process, 0.17);
    assert.equal(r.progress[process], stages.length);
  }
});
test("completed food and cooking choices persist independently", () => {
  let r = newRecipe("bento");
  r.rice = "ume";
  r.egg = "cheese";
  r.chicken = "salt";
  r.carrotShape = "star";
  for (const p of ["rice", "egg", "chicken", "broccoli", "carrot", "tomato"])
    for (let i = 0; i < STAGES[p].length; i++) r = progress(r, p, 1);
  assert.equal(r.ready.length, 6);
  assert.equal(r.vegetables.length, 3);
  for (const food of r.ready) r = addPiece(r, food);
  assert.deepEqual(
    r.items.slice(0, 3).map((p) => p.variant),
    ["ume", "cheese", "salt"],
  );
  assert.equal(r.items.find((p) => p.food === "carrot").variant, "star");
});
test("duplicates are allowed and nearby placements snap apart without moving existing food", () => {
  let r = newRecipe("bento");
  r = addPiece(r, "onigiri");
  const first = { ...r.items[0] };
  r = addPiece(r, "onigiri");
  assert.deepEqual(r.items[0], first);
  assert.ok(
    Math.hypot(
      r.items[0].x - r.items[1].x,
      (r.items[0].y - r.items[1].y) * 0.8,
    ) >= 17,
  );
  assert.notEqual(r.items[0].id, r.items[1].id);
});
test("drag bounds keep full food inside bento and cake surface", () => {
  for (const mode of ["bento", "cake"])
    for (const x of [-999, 0, 50, 100, 999])
      for (const y of [-999, 0, 50, 100, 999]) {
        const p = bound(mode, { x, y });
        if (mode === "bento") {
          assert.ok(p.x >= 15 && p.x <= 85 && p.y >= 23 && p.y <= 66);
        } else
          assert.ok(((p.x - 50) / 29) ** 2 + ((p.y - 33) / 12) ** 2 <= 1.00001);
      }
});
test("reposition changes only selected food; capacity stays bounded", () => {
  let r = newRecipe("cake");
  for (let i = 0; i < 40; i++) r = addPiece(r, "strawberry");
  assert.equal(r.items.length, MAX_PIECES);
  const before = r.items[1];
  const moved = movePiece(r, r.items[0].id, { x: 4, y: 4 });
  assert.deepEqual(moved.items[1], before);
  assert.notDeepEqual(moved.items[0], r.items[0]);
  assert.deepEqual(place("cake", { x: 50, y: 43 }, [], undefined), {
    x: 50,
    y: 43,
  });
});
test("session round-trip preserves food, strokes, choices, settings and progress", () => {
  const r = addPiece(newRecipe("cake"), "banana", { x: 60, y: 38 });
  r.cake = "chocolate";
  r.strokes = [
    [
      { x: 40, y: 35 },
      { x: 50, y: 40 },
    ],
  ];
  const saved = {
    version: 2,
    recipe: r,
    screen: 14,
    settings: { sound: false, bgm: true, volume: 0.25, language: "ja" },
  };
  assert.deepEqual(parseSession(JSON.stringify(saved)), saved);
});
test("corrupt data is bounded, invalid numbers/ids rejected, unknown settings normalized", () => {
  assert.equal(parseSession("{broken"), null);
  assert.equal(parseRecipe({ mode: "alien" }), null);
  assert.deepEqual(parseSettings({ volume: Infinity, language: "en" }), {
    sound: true,
    bgm: false,
    volume: 0.55,
    language: "ja",
  });
  const r = newRecipe("bento");
  r.items = [
    { id: "a", food: "onigiri", x: Infinity, y: 20 },
    { id: "b", food: "onigiri", x: 1000, y: -10 },
    { id: "b", food: "onigiri", x: 20, y: 20 },
  ];
  const parsed = parseRecipe(r);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].x, 85);
  assert.equal(parsed.items[0].y, 23);
});
