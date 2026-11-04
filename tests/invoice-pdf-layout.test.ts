import test from "node:test";
import assert from "node:assert/strict";
import { defaultPdfLayout, fitCandidates, minimumFontScale, normalizePdfLayout, pdfLayoutFromQuery, pdfLayoutQuery, planPdfPages, resolvePdfLayout, samePdfLayout, wrapText, type PdfPlan, type PdfPlanInput, type PlannedBlock, type ResolvedPdfLayout } from "../src/lib/invoice-pdf-layout";

// A stand-in for pdfkit's widthOfString: full-width characters take the type size, others about half.
const measure = (text: string, size: number) => [...text].reduce((width, char) => width + (char.charCodeAt(0) > 0x2e7f ? size : size * 0.55), 0);

function input(count: number, options: { notes?: boolean; longName?: boolean; details?: boolean; kind?: PdfPlanInput["kind"] } = {}): PdfPlanInput {
  return {
    kind: options.kind ?? "invoice", recipient: "株式会社サンプル 御中", subject: "THE PERFUME OIL FACTORY イラスト製作費",
    items: Array.from({ length: count }, (_, i) => ({
      description: options.longName && i % 4 === 1 ? `明細${i + 1} ${"長い品名の折り返し確認 ".repeat(6)}` : `明細${i + 1} ロゴデザイン`,
      details: options.details && i % 3 === 0 ? "初回提案・修正2回\n納品データを含む" : undefined,
      quantity: "1", unitPrice: "15,000", amount: "15,000",
    })),
    totals: [["税抜計", "315,000"], ["消費税 (10%)", "31,500"], ["合計", "346,500"]],
    notes: options.notes ? "お振込みの際は請求書番号をご記入ください。\n納品物の著作権は入金確認後に譲渡されます。\nご不明点は担当までご連絡ください。" : undefined,
  };
}
const plan = (count: number, options: Parameters<typeof input>[1] = {}, layout: Partial<ResolvedPdfLayout> = {}) => planPdfPages(input(count, options), { ...defaultPdfLayout, ...layout }, measure);
const kinds = (page: PdfPlan["pages"][number]) => page.blocks.map((block) => block.kind);
const itemIndexes = (page: PdfPlan["pages"][number]) => page.blocks.flatMap((block) => block.kind === "item" ? [block.index] : []);
function assertWithinPages(result: PdfPlan) {
  for (const page of result.pages) {
    assert.ok(page.used <= page.capacity + 1e-6, `page content ${page.used} exceeds capacity ${page.capacity}`);
    assert.ok(page.tableTop + result.metrics.tableHeaderH + page.used <= result.metrics.contentBottom + 1e-6);
  }
}

test("wrapText breaks on width and on new lines without losing characters", () => {
  const lines = wrapText("あいうえお\nかきくけこさしすせそ", 30, 10, measure);
  assert.deepEqual(lines, ["あいう", "えお", "かきく", "けこさ", "しすせ", "そ"]);
  assert.deepEqual(wrapText("", 30, 10, measure), [""]);
});

test("short documents keep the standard layout and fill the ruled area to eight rows", () => {
  for (const count of [1, 5]) {
    const result = plan(count, { notes: count === 5 });
    assert.equal(result.pages.length, 1);
    assert.equal(result.applied.fitted, false);
    assert.equal(result.applied.fontScale, 1);
    const page = result.pages[0];
    assert.equal(page.blocks.filter((block) => block.kind === "item").length, count);
    assert.equal(page.blocks.filter((block) => block.kind === "blank").length, 8 - count);
    assert.deepEqual(kinds(page).slice(-2), count === 5 ? ["notes", "bank"] : ["totals", "bank"]);
    assert.ok(page.tableHeader);
    assertWithinPages(result);
  }
});

test("documents that only just overflow are tightened step by step, never below 8pt body text", () => {
  const twelve = plan(12, { notes: true });
  assert.equal(twelve.pages.length, 1);
  const twenty = plan(20);
  assert.equal(twenty.pages.length, 1);
  assert.equal(twenty.applied.fitted, true);
  assert.ok(twenty.applied.fontScale >= minimumFontScale - 1e-9);
  assert.equal(twenty.layout.density, "standard", "the chosen settings are reported unchanged; only `applied` shows the fit");
  assert.ok(twenty.applied.density === "compact" || twenty.applied.margin === "narrow" || twenty.applied.fontScale < 1);
  assertWithinPages(twenty);
  const ladder = fitCandidates(defaultPdfLayout);
  assert.deepEqual(ladder.slice(0, 2).map((candidate) => [candidate.layout.density, candidate.layout.margin, candidate.fontScale]), [["compact", "standard", 1], ["compact", "narrow", 1]]);
  assert.ok(ladder.every((candidate) => candidate.fontScale >= minimumFontScale - 1e-9));
  assert.equal(ladder.at(-1)?.fontScale, minimumFontScale);
  const relaxedLarge = fitCandidates({ ...defaultPdfLayout, density: "relaxed", fontSize: "large", margin: "wide" });
  assert.deepEqual(relaxedLarge.slice(0, 4).map((candidate) => [candidate.layout.density, candidate.layout.margin]), [["standard", "wide"], ["compact", "wide"], ["compact", "standard"], ["compact", "narrow"]]);
});

test("tightening is skipped when it cannot save a page, and when the automatic fit is turned off", () => {
  const thirty = plan(30);
  assert.equal(thirty.pages.length, 2);
  assert.equal(thirty.applied.fitted, false);
  assert.equal(thirty.applied.fontScale, 1);
  const manual = plan(20, {}, { fitOnePage: false });
  assert.equal(manual.pages.length, 2);
  assert.equal(manual.applied.fitted, false);
  const compactRequested = plan(5, {}, { density: "compact", fontSize: "small", margin: "narrow" });
  assert.equal(compactRequested.applied.density, "compact");
  assert.equal(compactRequested.applied.fontScale, 0.9);
  assert.ok(compactRequested.pages[0].used < plan(5).pages[0].used);
});

test("forty lines spread over two pages with the table header repeated and the totals kept with lines", () => {
  for (const notes of [false, true]) {
    const result = plan(40, { notes });
    assert.equal(result.pages.length, 2);
    assert.ok(result.pages.every((page) => page.tableHeader));
    assert.equal(itemIndexes(result.pages[0]).length + itemIndexes(result.pages[1]).length, 40);
    assert.deepEqual(itemIndexes(result.pages[1]).slice(0, 1), [itemIndexes(result.pages[0]).length]);
    assert.ok(itemIndexes(result.pages[1]).length >= 2, "the totals never sit alone on the last page");
    const [first, second] = result.pages, row = result.metrics.blankRowH;
    assert.ok(first.capacity - first.used < row || Math.abs(first.used - second.used) <= 2 * row, "the two pages share the lines unless the first is already full");
    assert.deepEqual(kinds(result.pages[1]).slice(-(notes ? 3 : 2)), notes ? ["totals", "notes", "bank"] : ["totals", "bank"]);
    assert.ok(!kinds(result.pages[0]).includes("blank"));
    assertWithinPages(result);
  }
});

test("whatever the length, the last page carries several lines with the totals, and every line appears once", () => {
  for (let count = 21; count <= 60; count++) {
    const result = plan(count, {}, { fitOnePage: false });
    const last = result.pages.at(-1)!;
    assert.ok(kinds(last).includes("totals") && kinds(last).includes("bank"));
    assert.ok(itemIndexes(last).length >= 2, `${count} lines left the totals nearly alone`);
    assert.deepEqual(result.pages.flatMap(itemIndexes), Array.from({ length: count }, (_, i) => i));
    assertWithinPages(result);
  }
  const fiftyOne = plan(51, {}, { fitOnePage: false });
  assert.equal(fiftyOne.pages.length, 3);
  assert.ok(itemIndexes(fiftyOne.pages[2]).length >= 8, "the last two pages are evened out");
});

test("a page break can be forced before a line or before the totals, and turns the automatic fit off", () => {
  const beforeTen = plan(12, {}, { pageBreakBefore: 10 });
  assert.equal(beforeTen.pages.length, 2);
  assert.equal(beforeTen.applied.fitted, false);
  assert.deepEqual(itemIndexes(beforeTen.pages[0]), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(itemIndexes(beforeTen.pages[1]), [9, 10, 11]);
  assert.ok(beforeTen.pages[1].tableHeader);
  const beforeTotals = plan(5, {}, { pageBreakBefore: 6 });
  assert.equal(beforeTotals.pages.length, 2);
  assert.deepEqual(itemIndexes(beforeTotals.pages[1]), []);
  assert.deepEqual(kinds(beforeTotals.pages[1]), ["totals", "bank"]);
  assert.equal(beforeTotals.pages[1].tableHeader, false);
  const beyond = plan(5, {}, { pageBreakBefore: 40 });
  assert.equal(beyond.pages.length, 1);
});

test("optional blocks change the plan: no bank block when hidden, a validity line for estimates", () => {
  const noBank = plan(5, { notes: true }, { showBank: false, showNotes: false });
  assert.deepEqual(kinds(noBank.pages[0]).filter((kind) => kind !== "item" && kind !== "blank"), ["totals"]);
  const estimate = plan(5, { notes: true, kind: "estimate" });
  assert.deepEqual(kinds(estimate.pages[0]).slice(-3), ["totals", "notes", "validity"]);
  const details = plan(20, { details: true });
  const detailBlocks = details.pages.flatMap((page) => page.blocks).filter((block): block is Extract<PlannedBlock, { kind: "item" }> => block.kind === "item" && block.lines.some((line) => line.muted));
  assert.equal(detailBlocks.length, 7);
  assert.ok(detailBlocks.every((block) => block.lines[0].muted === false));
  assertWithinPages(details);
});

test("very long lines and notes split across pages without dropping anything", () => {
  const long = input(3);
  long.items[1].details = Array.from({ length: 75 }, (_, i) => `内訳行${String(i + 1).padStart(3, "0")} 基本設計と仕様の確認`).join("\n");
  long.notes = "長い備考の表示確認\n".repeat(65);
  const result = planPdfPages(long, defaultPdfLayout, measure);
  assert.ok(result.pages.length >= 3);
  const detailLines = result.pages.flatMap((page) => page.blocks).flatMap((block) => block.kind === "item" && block.index === 1 ? block.lines.filter((line) => line.muted) : []);
  assert.equal(detailLines.length, 75);
  const noteLines = result.pages.flatMap((page) => page.blocks).flatMap((block) => block.kind === "notes" ? block.lines : []);
  assert.equal(noteLines.filter((line) => line.text).length, 65);
  assert.equal(result.pages.flatMap((page) => page.blocks).filter((block) => block.kind === "notes" && block.title).length, 1);
  assert.equal(kinds(result.pages.at(-1)!).at(-1), "bank");
  assertWithinPages(result);
});

test("layout choices round-trip through the query string and the stored form", () => {
  const chosen: ResolvedPdfLayout = { density: "compact", fontSize: "small", margin: "narrow", fitOnePage: false, showNotes: false, showBank: false, showSeal: false, pageBreakBefore: 3 };
  const query = pdfLayoutQuery(chosen);
  assert.equal(query, "density=compact&font=small&margin=narrow&fit=0&notes=0&bank=0&seal=0&break=3");
  assert.deepEqual(resolvePdfLayout(pdfLayoutFromQuery(new URLSearchParams(query))), chosen);
  assert.equal(pdfLayoutFromQuery(new URLSearchParams("v=2026-01-01")), undefined, "no layout keys means the saved layout applies");
  assert.deepEqual(resolvePdfLayout(pdfLayoutFromQuery(new URLSearchParams("density=huge&font=small&break=0"))), { ...defaultPdfLayout, fontSize: "small" });
  assert.equal(normalizePdfLayout(defaultPdfLayout), undefined);
  assert.deepEqual(normalizePdfLayout({ density: "standard", showSeal: false, pageBreakBefore: 2 }), { showSeal: false, pageBreakBefore: 2 });
  assert.ok(samePdfLayout(undefined, { density: "standard" }));
  assert.ok(!samePdfLayout(undefined, { density: "compact" }));
});
