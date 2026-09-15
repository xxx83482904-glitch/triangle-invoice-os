"use client";

import { InvoiceDropzone } from "@/components/app/invoice-dropzone";
import type { CompanyScope } from "@/lib/company";

export function ReceivedInvoiceDropzone({ company }: { company: CompanyScope }) {
  return <InvoiceDropzone key={company} kind="received" company={company} />;
}
