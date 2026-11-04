import { z } from "zod";
import { maxDocumentItems } from "@/lib/document-items";
import type { InvoicePdfLayout } from "@/lib/types";

// Layout choices for generated invoice and estimate PDFs, and the page plan built from them.
// Everything here is pure: the PDF renderer draws what `planPdfPages` decides, and the preview
// dialog serialises the same choices into the PDF route's query string.

export const pdfDensities = ["relaxed", "standard", "compact"] as const;
export const pdfFontSizes = ["small", "standard", "large"] as const;
export const pdfMargins = ["narrow", "standard", "wide"] as const;
export type PdfDensity = (typeof pdfDensities)[number];
export type PdfFontSize = (typeof pdfFontSizes)[number];
export type PdfMargin = (typeof pdfMargins)[number];

export const pdfDensityLabels: Record<PdfDensity, string> = { relaxed: "ゆったり", standard: "標準", compact: "詰める" };
export const pdfFontSizeLabels: Record<PdfFontSize, string> = { small: "小さめ", standard: "標準", large: "大きめ" };
export const pdfMarginLabels: Record<PdfMargin, string> = { narrow: "狭い", standard: "標準", wide: "広い" };

export type ResolvedPdfLayout = {
  density: PdfDensity; fontSize: PdfFontSize; margin: PdfMargin;
  fitOnePage: boolean; showNotes: boolean; showBank: boolean; showDueDate: boolean; showSeal: boolean;
  pageBreakBefore?: number;
};
export const defaultPdfLayout: ResolvedPdfLayout = { density: "standard", fontSize: "standard", margin: "standard", fitOnePage: true, showNotes: true, showBank: true, showDueDate: true, showSeal: true };

export const pdfLayoutSchema = z.object({
  density: z.enum(pdfDensities).optional(),
  fontSize: z.enum(pdfFontSizes).optional(),
  margin: z.enum(pdfMargins).optional(),
  fitOnePage: z.boolean().optional(),
  showNotes: z.boolean().optional(),
  showBank: z.boolean().optional(),
  showDueDate: z.boolean().optional(),
  showSeal: z.boolean().optional(),
  // 1-based line index; `items + 1` breaks before the totals block.
  pageBreakBefore: z.number().int().min(1).max(maxDocumentItems + 1).optional(),
}).strict();

const flagKeys = ["fitOnePage", "showNotes", "showBank", "showDueDate", "showSeal"] as const;

export function resolvePdfLayout(layout?: InvoicePdfLayout | null): ResolvedPdfLayout {
  const resolved: ResolvedPdfLayout = { ...defaultPdfLayout };
  if (!layout) return resolved;
  if (layout.density && pdfDensities.includes(layout.density)) resolved.density = layout.density;
  if (layout.fontSize && pdfFontSizes.includes(layout.fontSize)) resolved.fontSize = layout.fontSize;
  if (layout.margin && pdfMargins.includes(layout.margin)) resolved.margin = layout.margin;
  for (const key of flagKeys) if (typeof layout[key] === "boolean") resolved[key] = layout[key];
  if (Number.isInteger(layout.pageBreakBefore) && (layout.pageBreakBefore as number) >= 1) resolved.pageBreakBefore = layout.pageBreakBefore;
  return resolved;
}

// Only the choices that differ from the defaults are stored; a fully default layout is stored as nothing.
export function normalizePdfLayout(layout: InvoicePdfLayout | null | undefined): InvoicePdfLayout | undefined {
  const resolved = resolvePdfLayout(layout);
  const stored: InvoicePdfLayout = {};
  for (const key of ["density", "fontSize", "margin"] as const) if (resolved[key] !== defaultPdfLayout[key]) stored[key] = resolved[key] as never;
  for (const key of flagKeys) if (resolved[key] !== defaultPdfLayout[key]) stored[key] = resolved[key];
  if (resolved.pageBreakBefore) stored.pageBreakBefore = resolved.pageBreakBefore;
  return Object.keys(stored).length ? stored : undefined;
}

export function samePdfLayout(a: InvoicePdfLayout | null | undefined, b: InvoicePdfLayout | null | undefined) {
  return JSON.stringify(resolvePdfLayout(a)) === JSON.stringify(resolvePdfLayout(b));
}

const queryKeys = { density: "density", fontSize: "font", margin: "margin", fitOnePage: "fit", showNotes: "notes", showBank: "bank", showDueDate: "due", showSeal: "seal", pageBreakBefore: "break" } as const;

// The preview and the download share one query string, so both go through the same plan.
export function pdfLayoutQuery(layout: InvoicePdfLayout | null | undefined) {
  const resolved = resolvePdfLayout(layout);
  const params = new URLSearchParams();
  params.set(queryKeys.density, resolved.density);
  params.set(queryKeys.fontSize, resolved.fontSize);
  params.set(queryKeys.margin, resolved.margin);
  for (const key of flagKeys) params.set(queryKeys[key], resolved[key] ? "1" : "0");
  if (resolved.pageBreakBefore) params.set(queryKeys.pageBreakBefore, String(resolved.pageBreakBefore));
  return params.toString();
}

// Returns nothing when the request carries no layout keys, so the saved layout applies.
export function pdfLayoutFromQuery(params: URLSearchParams): InvoicePdfLayout | undefined {
  if (!Object.values(queryKeys).some((key) => params.has(key))) return undefined;
  const flag = (key: string) => params.has(key) ? params.get(key) === "1" || params.get(key) === "true" : undefined;
  const pick = <T extends string>(key: string, values: readonly T[]) => { const value = params.get(key); return value && values.includes(value as T) ? (value as T) : undefined; };
  const breakAt = Number(params.get(queryKeys.pageBreakBefore));
  return {
    density: pick(queryKeys.density, pdfDensities), fontSize: pick(queryKeys.fontSize, pdfFontSizes), margin: pick(queryKeys.margin, pdfMargins),
    fitOnePage: flag(queryKeys.fitOnePage), showNotes: flag(queryKeys.showNotes), showBank: flag(queryKeys.showBank), showDueDate: flag(queryKeys.showDueDate), showSeal: flag(queryKeys.showSeal),
    pageBreakBefore: Number.isInteger(breakAt) && breakAt >= 1 && breakAt <= maxDocumentItems + 1 ? breakAt : undefined,
  };
}

// --- Page geometry -----------------------------------------------------------------------------

export const a4 = { width: 595.28, height: 841.89 } as const;
const densityPad: Record<PdfDensity, number> = { relaxed: 1.25, standard: 1, compact: 0.75 };
const densityLine: Record<PdfDensity, number> = { relaxed: 1.5, standard: 1.4, compact: 1.3 };
const densityHeader: Record<PdfDensity, number> = { relaxed: 1.04, standard: 1, compact: 0.92 };
export const pdfFontScales: Record<PdfFontSize, number> = { small: 0.9, standard: 1, large: 1.1 };
const fontScales = pdfFontScales;
const marginSizes: Record<PdfMargin, number> = { narrow: 22, standard: 32, wide: 44 };
// Body text is 10pt at scale 1; the automatic fit never goes below 8pt.
export const minimumFontScale = 0.8;
const minRuledRows = 8;

const round = (value: number) => Math.round(value * 100) / 100;

export type PdfMetrics = {
  pageWidth: number; pageHeight: number; margin: number; left: number; right: number; top: number; width: number;
  font: number; pad: number; headerScale: number; rowPad: number;
  contentBottom: number; footerY: number;
  s: (size: number) => number; lh: (size: number) => number; h: (offset: number) => number;
  columns: { descX: number; descWidth: number; detailsIndent: number; qtyRight: number; qtyWidth: number; unitRight: number; unitWidth: number; amountRight: number; amountWidth: number };
  tableHeaderH: number; blankRowH: number; totalsRowH: number; notesGap: number; notesTitleH: number; bankGap: number; validityH: number;
};

export function pdfMetrics(layout: Pick<ResolvedPdfLayout, "density" | "margin">, fontScale: number): PdfMetrics {
  const margin = marginSizes[layout.margin];
  const pad = densityPad[layout.density], lineFactor = densityLine[layout.density], headerScale = densityHeader[layout.density];
  const left = margin, right = a4.width - margin, top = margin, width = right - left;
  const s = (size: number) => round(size * fontScale);
  const lh = (size: number) => round(size * fontScale * lineFactor);
  const h = (offset: number) => round(top + offset * headerScale);
  const rowPad = round(4 * pad);
  return {
    pageWidth: a4.width, pageHeight: a4.height, margin, left, right, top, width, font: fontScale, pad, headerScale, rowPad,
    contentBottom: round(a4.height - margin - 26), footerY: round(a4.height - margin - 21), s, lh, h,
    columns: {
      descX: left + 3, descWidth: Math.round(width * 0.575), detailsIndent: 11,
      qtyRight: left + Math.round(width * 0.676), qtyWidth: Math.round(width * 0.088),
      unitRight: left + Math.round(width * 0.825), unitWidth: Math.round(width * 0.135),
      amountRight: right - 2, amountWidth: Math.round(width * 0.152),
    },
    tableHeaderH: round(16 * pad), blankRowH: round(lh(10) + 2 * rowPad), totalsRowH: round(lh(10) + 6 * pad),
    notesGap: round(18 * pad), notesTitleH: round(lh(9) + 3 * pad), bankGap: round(28 * pad), validityH: round(40 * fontScale),
  };
}

// --- Page plan -------------------------------------------------------------------------------

export type PdfPlanItem = { description: string; details?: string; quantity: string; unitPrice: string; amount: string };
export type PdfPlanInput = { kind: "invoice" | "estimate"; recipient: string; subject: string; items: PdfPlanItem[]; totals: [string, string][]; notes?: string };
export type MeasureText = (text: string, size: number) => number;

export type PlannedText = { text: string; size: number; indent: number; muted: boolean; height: number };
export type PlannedBlock =
  | { kind: "item"; index: number; first: boolean; lines: PlannedText[]; height: number; quantity: string; unitPrice: string; amount: string }
  | { kind: "blank"; height: number }
  | { kind: "totals"; rows: [string, string][]; height: number }
  | { kind: "notes"; title: boolean; lines: PlannedText[]; height: number }
  | { kind: "bank"; height: number; box: boolean; due: boolean }
  | { kind: "validity"; height: number };
export type PlannedPage = { first: boolean; tableTop: number; capacity: number; tableHeader: boolean; blocks: PlannedBlock[]; used: number };
export type PdfHeaderPlan = { recipientLines: string[]; recipientY: number; recipientBottom: number; subjectLines: string[]; subjectY: number; subjectRule: number; tableTop: number };
export type AppliedPdfLayout = { density: PdfDensity; fontSize: PdfFontSize; margin: PdfMargin; fontScale: number; pages: number; fitted: boolean };
export type PdfPlan = { layout: ResolvedPdfLayout; metrics: PdfMetrics; header: PdfHeaderPlan; pages: PlannedPage[]; applied: AppliedPdfLayout };

export function wrapText(value: string, width: number, size: number, measure: MeasureText) {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let current = "";
    for (const char of paragraph) {
      if (current && measure(current + char, size) > width) { lines.push(current); current = ""; }
      current += char;
    }
    lines.push(current);
  }
  return lines;
}

// Tighter settings tried in order until the document fits on one page: density, then margins, then type size.
export function fitCandidates(layout: ResolvedPdfLayout): { layout: ResolvedPdfLayout; fontScale: number }[] {
  const base = fontScales[layout.fontSize];
  const candidates: { layout: ResolvedPdfLayout; fontScale: number }[] = [];
  let current = layout;
  for (const density of pdfDensities.slice(pdfDensities.indexOf(layout.density) + 1)) { current = { ...current, density }; candidates.push({ layout: current, fontScale: base }); }
  const narrower = [...pdfMargins].reverse();
  for (const margin of narrower.slice(narrower.indexOf(layout.margin) + 1)) { current = { ...current, margin }; candidates.push({ layout: current, fontScale: base }); }
  for (let scale = round(base - 0.05); scale >= minimumFontScale - 1e-6; scale = round(scale - 0.05)) candidates.push({ layout: current, fontScale: scale });
  return candidates;
}

// The chosen settings are kept unless tighter ones save a whole page; then the gentlest such settings win.
export function planPdfPages(input: PdfPlanInput, layout: ResolvedPdfLayout, measure: MeasureText): PdfPlan {
  const base = fontScales[layout.fontSize];
  const plan = buildPlan(input, layout, base, measure);
  if (plan.pages.length === 1 || !layout.fitOnePage || forcedBreakInside(layout, input.items.length)) return plan;
  let best = plan;
  for (const candidate of fitCandidates(layout)) {
    const attempt = buildPlan(input, candidate.layout, candidate.fontScale, measure);
    if (attempt.pages.length < best.pages.length) best = { ...attempt, layout, applied: { ...attempt.applied, fitted: true } };
    if (best.pages.length === 1) break;
  }
  return best;
}

function buildPlan(input: PdfPlanInput, layout: ResolvedPdfLayout, fontScale: number, measure: MeasureText): PdfPlan {
  const m = pdfMetrics(layout, fontScale);
  const recipientLines = wrapText(input.recipient, 202, m.s(11), measure);
  const recipientY = m.h(150);
  const recipientBottom = round(recipientY + recipientLines.length * m.lh(11) + 5);
  const subjectLines = wrapText(input.subject, 276, m.s(9), measure);
  // Below the amount box on the right, and clear of the recipient on the left.
  const subjectY = round(Math.max(m.h(248), recipientBottom + 18 * m.pad));
  const subjectRule = round(subjectY + subjectLines.length * m.lh(9) + 4);
  const tableTop = round(Math.max(m.h(275), subjectRule + 20 * m.pad));
  const header: PdfHeaderPlan = { recipientLines, recipientY, recipientBottom, subjectLines, subjectY, subjectRule, tableTop };
  const nextTableTop = m.h(68);

  const pages: PlannedPage[] = [];
  const newPage = (): PlannedPage => {
    const first = pages.length === 0, top = first ? tableTop : nextTableTop;
    const page: PlannedPage = { first, tableTop: top, capacity: round(m.contentBottom - top - m.tableHeaderH), tableHeader: false, blocks: [], used: 0 };
    pages.push(page);
    return page;
  };
  let page = newPage();
  const remaining = () => round(page.capacity - page.used);
  const push = (block: PlannedBlock) => { page.blocks.push(block); page.used = round(page.used + block.height); };
  const rowHeight = (lines: PlannedText[]) => round(lines.reduce((sum, line) => sum + line.height, 0) + 2 * m.rowPad);
  const linesThatFit = (lines: PlannedText[], room: number) => {
    let used = 2 * m.rowPad, count = 0;
    for (const line of lines) { if (used + line.height > room + 1e-6) break; used += line.height; count++; }
    return count;
  };

  const items = input.items.map((item, index) => ({
    index, item,
    lines: [
      ...wrapText(item.description, m.columns.descWidth, m.s(10), measure).map((text): PlannedText => ({ text, size: m.s(10), indent: 3, muted: false, height: m.lh(10) })),
      ...(item.details ? wrapText(item.details, m.columns.descWidth - 8, m.s(9), measure).map((text): PlannedText => ({ text, size: m.s(9), indent: m.columns.detailsIndent, muted: true, height: m.lh(9) })) : []),
    ],
  }));
  const itemBlock = (entry: typeof items[number], lines: PlannedText[], first: boolean): PlannedBlock => ({ kind: "item", index: entry.index, first, lines, height: rowHeight(lines), ...entry.item });
  let split = false;
  for (const entry of items) {
    if (layout.pageBreakBefore === entry.index + 1 && page.blocks.length) page = newPage();
    let lines = entry.lines, first = true;
    while (lines.length) {
      const whole = rowHeight(lines);
      if (whole <= remaining() + 1e-6) { push(itemBlock(entry, lines, first)); break; }
      const fit = linesThatFit(lines, remaining());
      // A lone first line at the foot of a page reads badly; a page-high entry has no alternative.
      const part = fit >= 2 || (page.blocks.length === 0 && fit >= 1) ? fit : page.blocks.length === 0 ? 1 : 0;
      if (part > 0) { push(itemBlock(entry, lines.slice(0, part), first)); lines = lines.slice(part); first = false; split = true; }
      if (lines.length) page = newPage();
    }
  }

  const totals: PlannedBlock = { kind: "totals", rows: input.totals, height: round(input.totals.length * m.totalsRowH) };
  const notesLines = layout.showNotes && input.notes?.trim() ? wrapText(input.notes, m.width, m.s(9), measure).map((text): PlannedText => ({ text, size: m.s(9), indent: 0, muted: false, height: m.lh(9) })) : [];
  const notesBlock = (lines: PlannedText[], title: boolean): PlannedBlock => ({ kind: "notes", title, lines, height: round((title ? m.notesGap + m.notesTitleH : 0) + lines.reduce((sum, line) => sum + line.height, 0)) });
  const closing: PlannedBlock | null = input.kind === "invoice"
    ? layout.showBank || layout.showDueDate ? { kind: "bank", box: layout.showBank, due: layout.showDueDate, height: round(m.bankGap + closingBodyHeight(fontScale, layout.showBank, layout.showDueDate)) } : null
    : layout.showDueDate ? { kind: "validity", height: m.validityH } : null;
  const tail: PlannedBlock[] = [totals, ...(notesLines.length ? [notesBlock(notesLines, true)] : []), ...(closing ? [closing] : [])];
  const tailHeight = round(tail.reduce((sum, block) => sum + block.height, 0));
  const breakBeforeTail = layout.pageBreakBefore === input.items.length + 1;
  if (breakBeforeTail && page.blocks.length) page = newPage();
  // Totals, notes and payment details never sit alone: the last lines move over with them.
  const carryOver = (height: number, count = 2) => {
    const moved: PlannedBlock[] = [];
    while (moved.length < count && page.blocks.length > 1) {
      const last = page.blocks.at(-1)!;
      if (last.kind !== "item" && last.kind !== "notes") break;
      if (moved.reduce((sum, block) => sum + block.height, last.height) + height > round(m.contentBottom - nextTableTop - m.tableHeaderH)) break;
      page.blocks.pop(); page.used = round(page.used - last.height); moved.unshift(last);
    }
    page = newPage();
    for (const block of moved) push(block);
  };
  const place = (block: PlannedBlock) => { if (block.height > remaining() + 1e-6) { if (breakBeforeTail && block === totals) page = newPage(); else carryOver(block.height); } push(block); };
  if (tailHeight <= remaining() + 1e-6) for (const block of tail) push(block);
  else if (tailHeight <= round(m.contentBottom - nextTableTop - m.tableHeaderH)) { if (breakBeforeTail) page = newPage(); else carryOver(tailHeight); for (const block of tail) push(block); }
  else {
    place(totals);
    let lines = notesLines, title = true;
    while (lines.length) {
      const room = remaining();
      const whole = notesBlock(lines, title).height;
      if (whole <= room + 1e-6) { push(notesBlock(lines, title)); break; }
      const headroom = title ? m.notesGap + m.notesTitleH : 0;
      let count = 0, used = headroom;
      for (const line of lines) { if (used + line.height > room + 1e-6) break; used += line.height; count++; }
      if (count >= 2 || (page.blocks.length === 0 && count >= 1)) { push(notesBlock(lines.slice(0, count), title)); lines = lines.slice(count); title = false; }
      else if (page.blocks.length === 0) { push(notesBlock(lines.slice(0, 1), title)); lines = lines.slice(1); title = false; }
      if (lines.length) page = newPage();
    }
    if (closing) { if (closing.height > remaining() + 1e-6) { const popped = popNotesLines(page, 2); page = newPage(); if (popped) push(popped); } push(closing); }
  }

  const whole = !split && !forcedBreakInside(layout, input.items.length);
  if (pages.length >= 2 && whole) balanceLastPages(pages.at(-2)!, pages.at(-1)!);
  if (pages.length === 1) {
    const itemsEnd = page.blocks.findLastIndex((block) => block.kind === "item") + 1;
    const blanks = Math.min(Math.max(0, minRuledRows - input.items.length), Math.floor((remaining() + 1e-6) / m.blankRowH));
    const fill: PlannedBlock[] = Array.from({ length: blanks }, () => ({ kind: "blank", height: m.blankRowH }));
    page.blocks.splice(itemsEnd, 0, ...fill); page.used = round(page.used + blanks * m.blankRowH);
  }
  for (const entry of pages) entry.tableHeader = entry.blocks.some((block) => block.kind === "item" || block.kind === "blank");
  const applied: AppliedPdfLayout = { density: layout.density, fontSize: layout.fontSize, margin: layout.margin, fontScale, pages: pages.length, fitted: false };
  return { layout, metrics: m, header, pages, applied };
}

// The payment box with its fee note, and the due date line, can each be left out on their own.
function closingBodyHeight(fontScale: number, box: boolean, due: boolean) {
  return round(((box ? 77 : 0) + (due ? 14 : 0)) * fontScale);
}

function forcedBreakInside(layout: ResolvedPdfLayout, itemCount: number) {
  return layout.pageBreakBefore !== undefined && layout.pageBreakBefore <= itemCount + 1;
}

function popNotesLines(page: PlannedPage, count: number): PlannedBlock | null {
  const last = page.blocks.at(-1);
  if (!last || last.kind !== "notes" || last.lines.length <= count) return null;
  const moved = last.lines.slice(-count), kept = last.lines.slice(0, -count);
  const movedHeight = round(moved.reduce((sum, line) => sum + line.height, 0));
  last.lines = kept; last.height = round(last.height - movedHeight); page.used = round(page.used - movedHeight);
  return { kind: "notes", title: false, lines: moved, height: movedHeight };
}

// The last two pages share their lines instead of leaving the final page nearly empty.
function balanceLastPages(first: PlannedPage, second: PlannedPage) {
  const itemBlocks = () => first.blocks.filter((block) => block.kind === "item");
  while (itemBlocks().length > 1) {
    const last = first.blocks.at(-1)!;
    if (last.kind !== "item") break;
    if (second.used + last.height > second.capacity + 1e-6) break;
    if (Math.abs(first.used - last.height - (second.used + last.height)) >= Math.abs(first.used - second.used)) break;
    first.blocks.pop(); first.used = round(first.used - last.height);
    second.blocks.unshift(last); second.used = round(second.used + last.height);
  }
}
