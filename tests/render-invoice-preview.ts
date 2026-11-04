import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFParse } from "pdf-parse";
import { buildEstimatePdf, buildIssuedInvoicePdf } from "../src/lib/issued-invoice-pdf";
import { pdfLayoutFromQuery } from "../src/lib/invoice-pdf-layout";
import { invoicePdfFixture, invoicePdfCases } from "./invoice-pdf-fixture";
import type { Estimate } from "../src/lib/types";

// Renders the synthetic invoices as PDF and PNG so the layout can be inspected by eye.
// Usage: node --import tsx tests/render-invoice-preview.ts [outDir] [--layout "density=compact&font=small"]
async function main() {
  const args = process.argv.slice(2);
  const layoutIndex = args.indexOf("--layout");
  const layout = layoutIndex >= 0 ? pdfLayoutFromQuery(new URLSearchParams(args[layoutIndex + 1] || "")) : undefined;
  const root = args.find((arg, index) => !arg.startsWith("--") && !(layoutIndex >= 0 && index === layoutIndex + 1)) || path.join(os.tmpdir(), "triangle-invoice-pdf-preview");
  await mkdir(root, { recursive: true });
  const summary: Record<string, unknown>[] = [];
  for (const scenario of invoicePdfCases()) {
    const data = invoicePdfFixture(scenario.count, scenario);
    const invoice = data.issuedInvoices[0];
    const estimate: Estimate = { ...invoice, estimateNumber: `EST-${scenario.name}`, validUntil: "2026-03-31", status: "DRAFT", items: data.issuedInvoiceItems };
    for (const kind of ["invoice", "estimate"] as const) {
      const result = kind === "invoice" ? await buildIssuedInvoicePdf(invoice, data, layout) : await buildEstimatePdf(estimate, data, layout);
      const name = `${kind}-${scenario.name}`;
      await writeFile(path.join(root, `${name}.pdf`), result.pdf);
      const parser = new PDFParse({ data: result.pdf });
      try {
        const screenshots = await parser.getScreenshot({ desiredWidth: 1240 });
        for (const page of screenshots.pages) await writeFile(path.join(root, `${name}-${page.pageNumber}.png`), page.data);
      } finally { await parser.destroy(); }
      summary.push({ name, pages: result.pages, applied: result.applied });
    }
  }
  await writeFile(path.join(root, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ root, summary }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
