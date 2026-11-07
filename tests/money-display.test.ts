import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

// These identifiers retain monospace type; no monetary display or numeric input is exempt.
const identifierFonts: Record<string, RegExp> = {
  "app/guest-invoices/page.tsx": /\{invoice\.invoiceNumber\}/,
  "app/partners/page.tsx": /\{option\.value\}/,
  "app/users/agent-tokens.tsx": /value=\{state\.plain\}/,
  // Permit, shipment and invoice identifiers, including the grouped import candidates.
  "app/imports/shipment-form.tsx": /name="(?:permitNumber|blNumber|invoiceNumber)"/,
  "app/imports/shipment-candidates.tsx": /\{group\.(?:declarationNumber|blNumber|invoiceNumber)\}/,
};

const numberFormatExceptions: Record<string, string> = {
  "lib/format.ts": "The shared monetary and general number formatters.",
  "lib/issued-invoice-pdf.ts": "Customer-facing PDF amounts retain their existing format.",
  "lib/integrity.ts": "Diagnostic messages are also external API output, so their format is unchanged.",
};

test("src keeps monetary displays out of monospace fonts and local yen formatters", () => {
  const root = path.resolve("src");
  const errors: string[] = [];
  for (const relative of readdirSync(root, { recursive: true }).map(String)) {
    if (!/\.(?:[cm]?[jt]sx?|css)$/.test(relative)) continue;
    const name = relative.replaceAll("\\", "/");
    const source = readFileSync(path.join(root, relative), "utf8");
    if (name.endsWith(".css")) {
      for (const line of source.split(/\r?\n/)) if (line.includes("font-mono") && !(name === "app/globals.css" && line.trim().startsWith("--font-mono:"))) errors.push(`${name}: unexpected monospace style`);
      continue;
    }
    const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const allowedFonts: Array<[number, number]> = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === "yen.format" && !numberFormatExceptions[name]) errors.push(`${name}: render amounts with Money or formatMoney`);
      if (ts.isNewExpression(node) && node.expression.getText(tree) === "Intl.NumberFormat" && !numberFormatExceptions[name]) {
        const declaration = node.parent.getText(tree);
        if (/currency\s*:\s*["']JPY["']|\b(?:money|amount)\b/.test(declaration)) errors.push(`${name}: use the shared money formatter`);
      }
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === "className" && node.initializer?.getText(tree).includes("font-mono")) {
        const opening = node.parent.parent;
        const element = ts.isJsxOpeningElement(opening) ? opening.parent : opening;
        const content = element.getText(tree);
        if (!/<Money\b|type=["']number["']/.test(content) && identifierFonts[name]?.test(content)) allowedFonts.push([node.getStart(tree), node.end]);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const match of source.matchAll(/\bfont-mono\b/g)) if (!allowedFonts.some(([start, end]) => match.index >= start && match.index < end)) errors.push(`${name}: monospace is reserved for the listed identifiers`);
  }
  assert.deepEqual(errors, []);
});
