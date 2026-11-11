import { z } from "zod";
import type { InvoicePdfText } from "@/lib/types";

export const documentSubjectSchema = z.string().trim().max(500, "件名は500文字以内で入力してください").optional();

// Share the PDF editor's subject, rather than storing two competing titles.
export function withDocumentSubject(text: InvoicePdfText | undefined, input: string | undefined): InvoicePdfText | undefined {
  const subject = documentSubjectSchema.parse(input);
  if (subject === undefined) return text;
  const next = { ...text };
  if (subject) next.subject = subject;
  else delete next.subject;
  return next;
}
