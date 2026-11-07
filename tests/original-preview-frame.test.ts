import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These previews open by themselves with the page. A bare iframe would load its PDF off screen,
// take focus and scroll the whole page to it, so they go through OnScreenPdfFrame.
for (const file of ["src/app/mail-sorter/ocr-documents-table.tsx"]) {
  test(`${file} embeds PDFs only once they are on screen`, () => {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<iframe\b/);
    assert.match(source, /<OnScreenPdfFrame\b/);
  });
}

// The original preview draws PDFs itself (pdf.js on canvas), so there is no embedded viewer to steal focus or scroll the page.
test("the original preview uses the in-app viewer, which never embeds an iframe or takes focus", () => {
  const preview = readFileSync("src/app/received-invoices/original-document-preview.tsx", "utf8");
  const viewer = readFileSync("src/components/app/zoomable-document.tsx", "utf8");
  assert.doesNotMatch(preview, /<iframe\b/);
  assert.match(preview, /<ZoomableDocument\b/);
  assert.doesNotMatch(viewer, /<iframe\b|autoFocus|\.focus\(/);
  assert.match(viewer, /new IntersectionObserver/);
});

test("the on-screen frame holds back the iframe until it intersects", () => {
  const source = readFileSync("src/components/app/on-screen-pdf-frame.tsx", "utf8");
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /\{onScreen \? <iframe\b/);
  assert.match(source, /hidden [^"]*md:block/);
});
