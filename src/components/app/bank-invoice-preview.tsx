"use client";

import Link from "next/link";
import { ArrowUpRight, FileX2 } from "lucide-react";
import { OriginalDocumentPreview } from "@/app/received-invoices/original-document-preview";
import { Button } from "@/components/ui/button";
import type { CompanyScope } from "@/lib/company";

export type BankPreviewInvoice = {
  key: string; kind: "issued" | "received"; party: string; title: string; project: string; href: string;
  originalHref: string; originalName: string; originalMimeType: string; originalSource: "invoice" | "mail" | "generated" | "";
};

const sourceLabels = { invoice: "請求書の原本", mail: "郵便物のスキャン", generated: "発行請求書PDF", "": "" } as const;

// The invoice's original next to the bank row, so the amount and payee can be checked without leaving the screen.
// The pane size omits the heading because its parent row already shows it.
export function BankInvoicePreview({ company, invoice, size = "dialog" }: { company: CompanyScope; invoice: BankPreviewInvoice; size?: "dialog" | "pane" }) {
  const frame = size === "pane" ? "h-[28rem]" : "h-[62vh] min-h-72";
  return <section aria-label={`原本: ${invoice.party} / ${invoice.title}`} className="min-w-0 space-y-2">
    {size === "pane" ? invoice.originalSource ? <p className="text-xs text-muted-foreground">{sourceLabels[invoice.originalSource]}</p> : null : <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium">{invoice.party} / {invoice.title}</p>
        <p className="break-words text-xs text-muted-foreground">{invoice.project}{invoice.originalSource ? ` / ${sourceLabels[invoice.originalSource]}` : ""}</p>
      </div>
      <Button asChild variant="soft" size="sm" className="h-auto max-w-full whitespace-normal break-words py-2 text-left lg:h-auto lg:min-h-8 lg:py-1.5"><Link href={invoice.href} target="_blank" rel="noreferrer">書類<ArrowUpRight className="size-4" /></Link></Button>
    </div>}
    {invoice.originalHref
      ? <OriginalDocumentPreview key={invoice.originalHref} company={company} fileUrl={invoice.originalHref} fileName={invoice.originalName || "原本"} mimeType={invoice.originalMimeType || undefined} frameClassName={frame} />
      : <p role="status" className="flex items-center gap-2 rounded-lg border bg-muted p-4 text-sm text-muted-foreground"><FileX2 className="size-4 shrink-0" />原本が添付されていません。書類の画面で添付してください。</p>}
  </section>;
}
