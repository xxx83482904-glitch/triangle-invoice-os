import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCardPress } from "../src/lib/list-selection";

// Just enough of a DOM element for the press rules: closest() finds the nearest match by selector kind.
class FakeElement extends EventTarget {
  constructor(readonly control: FakeElement | null = null, readonly opens = false) { super(); }
  closest(selector: string) { return selector === "[data-selection-open]" ? (this.opens ? this : this.control?.opens ? this.control : null) : this.control ?? (this.opens ? this : null); }
  hasAttribute(name: string) { return name === "data-selection-open" && this.opens; }
}
(globalThis as unknown as { Element: unknown }).Element = FakeElement;

const card = new FakeElement();

test("a press on the card's own area selects it", () => {
  assert.equal(isCardPress(new FakeElement(), card), true);
});

test("a press on a control inside the card keeps the control's action", () => {
  const select = new FakeElement();
  assert.equal(isCardPress(new FakeElement(select), card), false);
});

test("a press on the title opens the item without selecting it", () => {
  const title = new FakeElement(null, true);
  assert.equal(isCardPress(title, card), false);
  assert.equal(isCardPress(new FakeElement(title), card), false);
});

test("a card that is itself role=button still selects", () => {
  assert.equal(isCardPress(new FakeElement(card), card), true);
});

test("a press with no element target does nothing", () => {
  assert.equal(isCardPress(null, card), false);
});

const lists = [
  "src/app/mail-sorter/ocr-documents-table.tsx", "src/app/received-invoices/received-invoices-workspace.tsx", "src/components/app/documents-workspace.tsx",
  "src/components/app/estimates-list.tsx", "src/app/projects/projects-workspace.tsx", "src/components/app/banking-workspace.tsx", "src/components/app/selectable-records-table.tsx",
];
for (const file of lists) {
  test(`${file} shows its items as cards and has no select-all checkbox`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /record-cards?\b/);
    assert.doesNotMatch(source, /SelectAllCheckbox/);
  });
}

for (const [file, labels] of [
  ["src/app/mail-sorter/ocr-documents-table.tsx", ["郵便物の分類で絞り込み"]],
  ["src/components/app/documents-workspace.tsx", ["請求書の状態で絞り込み", "入金状態で絞り込み", "請求書のまとめ方", "並び順", "書類種別", "書類分類"]],
  ["src/components/app/estimates-list.tsx", ["見積書の並び順", "見積書の状態"]],
  ["src/components/app/banking-workspace.tsx", ["入出金で絞り込み", "確認状態で絞り込み", "並び順", "検索の一致条件", "自動分類の対象"]],
  ["src/components/app/bank-reconciliation-workspace.tsx", ["照合状態", "請求書の照合状態"]],
  ["src/components/app/bank-accounts-workspace.tsx", ["口座の並び順"]],
] as const) {
  test(`${file} offers its fixed choices as tabs`, () => {
    const source = readFileSync(file, "utf8");
    for (const label of labels) {
      assert.match(source, new RegExp(`<OptionTabs label="${label}"`));
      assert.doesNotMatch(source, new RegExp(`<select[^>]*aria-label="${label}"`));
    }
  });
}

for (const file of ["src/components/app/bank-reconciliation-workspace.tsx", "src/components/app/bank-review-panel.tsx", "src/components/app/bank-insights-workspace.tsx"]) {
  test(`${file} picks its month with the tabs`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<MonthTabs\b/);
    assert.doesNotMatch(source, /type="month"/);
  });
}
