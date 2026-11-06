import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCardPress, isOpenPress, isSelectionControl, pressSelects } from "../src/lib/list-selection";

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
  "src/components/app/estimates-list.tsx", "src/app/projects/projects-workspace.tsx", "src/components/app/banking-workspace.tsx", "src/components/app/records-table.tsx",
];
for (const file of lists) {
  const ledger = file === "src/components/app/banking-workspace.tsx";
  test(`${file} ${ledger ? "keeps mobile cards and a ledger header checkbox" : "shows its items as cards and has no select-all checkbox"}`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /record-cards?\b/);
    if (ledger) {
      assert.match(source, /<th scope="col"><BankSelectAllCheckbox/);
      assert.match(source, /onChange=\{selection\.selectAll\}/);
      assert.match(readFileSync("src/components/app/bank-ledger-controls.tsx", "utf8"), /aria-checked=\{some \? "mixed" : all\}/);
    } else assert.doesNotMatch(source, /SelectAllCheckbox/);
  });
}

test("bank ledger always selects on press and opens details with a button or Enter", () => {
  const source = readFileSync("src/components/app/banking-workspace.tsx", "utf8");
  assert.match(source, /useListSelection\([^\n]+pickMode: true/);
  assert.doesNotMatch(source, /cardPressProps|selection\.picking/);
  assert.match(source, /<RecordDetail wide=\{false\}/);
  const table = source.slice(source.indexOf('<table className="bank-ledger-table'), source.indexOf('className="bank-ledger-cards'));
  const cards = source.slice(source.indexOf('className="bank-ledger-cards'), source.indexOf('<div ref={sentinel}'));
  for (const view of [table, cards]) {
    assert.match(view, /selection\.rowProps\(row.id\)/);
    assert.match(view, /<Button[^>]*aria-label=\{`\$\{row.content \|\| "摘要なし"\}の詳細`\}[^>]*onClick=\{\(\) => setDetailId\(row.id\)\}><ScrollText[^>]*\/>詳細<\/Button>/);
    assert.match(view, /onKeyDown=\{\(event\) => \{ if \(event.target === event.currentTarget && event.key === "Enter" && !isSelectionGesture\(event\)\) \{ event.preventDefault\(\); setDetailId\(row.id\);/);
  }
  assert.doesNotMatch(cards, /<details|<Input|<select/);
});

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

test("a list in review mode leaves presses to open the item until something is selected", () => {
  assert.equal(pressSelects(false, 0), false);
  assert.equal(pressSelects(true, 0), true);
  assert.equal(pressSelects(false, 2), true);
});

test("a press opens a card, except on a control or at the end of a text drag", () => {
  assert.equal(isOpenPress(new FakeElement(), card), true);
  assert.equal(isOpenPress(new FakeElement(new FakeElement()), card), false);
  assert.equal(isOpenPress(new FakeElement(), card, "selected text"), false);
  assert.equal(isOpenPress(new FakeElement(null, true), card), true);
});

test("the fold-out fields inside a card count as a control", () => {
  let selector = "";
  class Probe extends FakeElement { override closest(value: string) { selector ||= value; return null; } }
  (globalThis as unknown as { Element: unknown }).Element = Probe;
  isSelectionControl(new Probe(), card);
  (globalThis as unknown as { Element: unknown }).Element = FakeElement;
  assert.match(selector, /\bdetails\b/);
});

test("mail sorter starts in review mode, so going through the list selects nothing", () => {
  const source = readFileSync("src/app/mail-sorter/ocr-documents-table.tsx", "utf8");
  assert.match(source, /useState\(false\);\s*const \[detailOpen/);
  assert.match(source, /disabled: isMoving, pickMode \}/);
  assert.match(source, /<OptionTabs label="郵便物の選び方"/);
});

for (const file of ["src/app/received-invoices/received-invoices-workspace.tsx", "src/app/projects/projects-workspace.tsx"]) {
  test(`${file} has nothing to do in bulk, so pressing a card only opens it`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /cardPressProps\(/);
    assert.doesNotMatch(source, /useListSelection|RowSelectionCheckbox|SelectionToolbar/);
  });
}

test("partners have no selection left", () => {
  const source = readFileSync("src/components/app/records-table.tsx", "utf8");
  assert.doesNotMatch(source, /useListSelection|RowSelectionCheckbox|SelectionToolbar/);
});

for (const file of ["src/app/mail-sorter/ocr-documents-table.tsx", "src/app/received-invoices/received-invoices-workspace.tsx", "src/app/projects/projects-workspace.tsx"]) {
  test(`${file} keeps the opened item in view`, () => {
    assert.match(readFileSync(file, "utf8"), /<RecordDetail\b/);
  });
}

for (const file of ["src/app/mail-sorter/ocr-documents-table.tsx", "src/components/app/documents-workspace.tsx", "src/components/app/estimates-list.tsx", "src/components/app/banking-workspace.tsx"]) {
  test(`${file} folds its less used filters`, () => {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<FilterPanel\b/);
    assert.doesNotMatch(source, /workspace-filter-panel/);
  });
}

test("the detail panel does not close on a stray press, so typed values survive", () => {
  assert.match(readFileSync("src/components/app/record-detail.tsx", "utf8"), /onInteractOutside=\{\(event\) => event\.preventDefault\(\)\}/);
});
