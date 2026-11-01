import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These previews open by themselves with the page. A bare iframe would load its PDF off screen,
// take focus and scroll the whole page to it, so they go through OnScreenPdfFrame.
for (const file of ["src/app/received-invoices/original-document-preview.tsx", "src/app/mail-sorter/ocr-documents-table.tsx"]) {
  test(`${file} embeds PDFs only once they are on screen`, () => {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<iframe\b/);
    assert.match(source, /<OnScreenPdfFrame\b/);
  });
}

test("the on-screen frame holds back the iframe until it intersects", () => {
  const source = readFileSync("src/components/app/on-screen-pdf-frame.tsx", "utf8");
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /\{onScreen \? <iframe\b/);
  assert.match(source, /hidden [^"]*md:block/);
});
