import { normalizeBankSearch } from "@/lib/bank-search";

// Map normalized graphemes back to original UTF-16 offsets (including half-width kana).
export function bankSearchHighlights(text: string, query: string): Array<{ text: string; matched: boolean }> {
  const needle = normalizeBankSearch(query);
  if (!needle) return [{ text, matched: false }];
  const positions: Array<{ start: number; end: number }> = [];
  let normalized = "";
  for (const item of new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(text)) {
    const value = item.segment.normalize("NFKC").toLocaleLowerCase("ja");
    for (const char of value) {
      const space = /\s/.test(char);
      if (space && normalized.endsWith(" ")) { positions[positions.length - 1].end = item.index + item.segment.length; continue; }
      normalized += space ? " " : char;
      for (let index = 0; index < (space ? 1 : char.length); index++) positions.push({ start: item.index, end: item.index + item.segment.length });
    }
  }
  const parts: Array<{ text: string; matched: boolean }> = [];
  let cursor = 0;
  let index = normalized.indexOf(needle);
  while (index !== -1) {
    const start = positions[index].start, end = positions[index + needle.length - 1].end;
    if (start >= cursor) {
      if (start > cursor) parts.push({ text: text.slice(cursor, start), matched: false });
      parts.push({ text: text.slice(start, end), matched: true }); cursor = end;
    }
    index = normalized.indexOf(needle, index + needle.length);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), matched: false });
  return parts;
}
