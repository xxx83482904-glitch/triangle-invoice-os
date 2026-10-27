import test from "node:test";
import assert from "node:assert/strict";
import { isSelectionGesture, selectListItem, selectListScope, type SelectionState } from "../src/lib/list-selection";

const ids = ["a", "b", "c", "d", "e", "f"];
const empty = (): SelectionState => ({ selected: new Set(), anchor: null });
const values = (state: SelectionState) => [...state.selected].sort();

test("Ctrl and Command toggle only the target without mutating prior selection", () => {
  const first = selectListItem(empty(), ids, "a", { ctrlKey: true });
  const next = selectListItem(first, ids, "d", { metaKey: true });
  assert.deepEqual(values(next), ["a", "d"]);
  assert.deepEqual(values(first), ["a"]);
  assert.deepEqual(values(selectListItem(next, ids, "a", { ctrlKey: true })), ["d"]);
});

test("Shift follows current display order in either direction", () => {
  const first = selectListItem(empty(), ids, "e");
  assert.deepEqual(values(selectListItem(first, ids, "b", { shiftKey: true })), ["b", "c", "d", "e"]);
  const reordered = ["e", "a", "d", "f", "b", "c"];
  assert.deepEqual(values(selectListItem(first, reordered, "d", { shiftKey: true })), ["a", "d", "e"]);
});

test("Repeated Shift retains its original anchor and is additive", () => {
  let state = selectListItem(empty(), ids, "c");
  state = selectListItem(state, ids, "e", { shiftKey: true });
  assert.equal(state.anchor, "c");
  state = selectListItem(state, ids, "a", { shiftKey: true });
  assert.deepEqual(values(state), ["a", "b", "c", "d", "e"]);
  assert.equal(state.anchor, "c");
});

test("Shift on an already selected row does not deselect the range", () => {
  let state = selectListItem(empty(), ids, "a");
  state = selectListItem(state, ids, "d", { shiftKey: true });
  assert.deepEqual(values(selectListItem(state, ids, "d", { shiftKey: true })), ["a", "b", "c", "d"]);
});

test("Checkbox check and uncheck can explicitly set an entire range", () => {
  let state = selectListItem(empty(), ids, "b", { checked: true });
  state = selectListItem(state, ids, "e", { shiftKey: true, checked: true });
  assert.deepEqual(values(state), ["b", "c", "d", "e"]);
  state = selectListItem(state, ids, "d", { shiftKey: true, checked: false });
  assert.deepEqual(values(state), ["e"]);
  assert.equal(state.anchor, "b");
});

test("Filtered or folded-out items never enter a new range", () => {
  const state = selectListItem(empty(), ids, "a");
  assert.deepEqual(values(selectListItem(state, ["a", "e", "f"], "f", { shiftKey: true })), ["a", "e", "f"]);
});

test("A missing anchor falls back to the target and unknown targets do nothing", () => {
  const state = selectListItem(empty(), ids, "a");
  const next = selectListItem(state, ["d", "e"], "e", { shiftKey: true });
  assert.deepEqual(values(next), ["a", "e"]);
  assert.equal(next.anchor, "e");
  assert.equal(selectListItem(next, ["d", "e"], "missing", { shiftKey: true }), next);
});

test("Incremental loading retains both selection and range anchor", () => {
  const all = Array.from({ length: 120 }, (_, index) => String(index));
  const state = selectListItem(empty(), all.slice(0, 50), "48");
  const next = selectListItem(state, all.slice(0, 100), "52", { shiftKey: true, ctrlKey: true });
  assert.deepEqual([...next.selected], ["48", "49", "50", "51", "52"]);
});

test("Select all applies only to displayed rows and preserves hidden selections", () => {
  const previous = new Set(["hidden", "a"]);
  const selected = selectListScope(previous, ["a", "b"], true);
  assert.deepEqual([...selected], ["hidden", "a", "b"]);
  assert.deepEqual([...selectListScope(selected, ["a", "b"], false)], ["hidden"]);
  assert.deepEqual([...previous], ["hidden", "a"]);
  assert.deepEqual([...selectListScope(previous, [], false)], ["hidden", "a"]);
});

test("Only Shift, Ctrl or Command without Alt are row selection gestures", () => {
  assert.equal(isSelectionGesture({}), false);
  for (const gesture of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true, ctrlKey: true }]) assert.equal(isSelectionGesture(gesture), true);
  assert.equal(isSelectionGesture({ ctrlKey: true, altKey: true }), false);
});
