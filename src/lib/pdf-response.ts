import { contentDispositionFileName } from "@/lib/files";
import type { RenderedPdf } from "@/lib/issued-invoice-pdf";

// The preview dialog reads the page count and the settings the automatic fit actually used from these headers.
export function pdfResponseHeaders(fileName: string, result: Pick<RenderedPdf, "pages" | "applied">) {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": contentDispositionFileName(fileName),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Pdf-Pages": String(result.pages),
    "X-Pdf-Applied": JSON.stringify(result.applied),
  };
}
