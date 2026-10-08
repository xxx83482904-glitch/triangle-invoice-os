import { z } from "zod";

export const bankAiScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("transaction"), transactionId: z.string().min(1).max(1000) }).strict(),
  z.object({ mode: z.literal("month"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict(),
]);
export type BankAiScope = z.infer<typeof bankAiScopeSchema>;
export const bankAiOutputSchema = z.object({
  suggestions: z.array(z.object({
    bankRef: z.string().regex(/^B\d+$/),
    invoiceRefs: z.array(z.string().regex(/^I\d+$/)).max(5),
    mailRefs: z.array(z.string().regex(/^M\d+$/)).max(5),
    explanation: z.string().min(1).max(400),
    evidence: z.array(z.object({ ref: z.string().regex(/^[BIM]\d+$/), quote: z.string().min(2).max(100) }).strict()).min(2).max(12),
  }).strict()).max(12),
}).strict();

export type BankAiPayload = {
  company: "JAPAN" | "CHINA";
  banks: Array<{ ref: string; side: "INCOME" | "EXPENSE"; date: string; content: string; amount: number; remaining: number }>;
  invoices: Array<{ ref: string; kind: "issued" | "received"; title: string; party: string; project: string; date: string; dueDate: string; total: number; paid: number; unmatched: number; needsReview: boolean; stateMismatch: boolean; excerpt: string }>;
  mails: Array<{ ref: string; title: string; sender: string; category: string; month: string; processed: boolean; linked: boolean; invoiceRef: string | null; excerpt: string }>;
};
export type BankAiPreview = {
  scope: BankAiScope; revision: string; payload: BankAiPayload;
  totals: { banks: number; invoices: number; mails: number };
};
export type BankAiResult = {
  revision: string; model: string; generatedAt: string;
  suggestions: Array<{
    bank: { id: string; title: string; date: string; remaining: number; href: string };
    invoices: Array<{ key: string; title: string; href: string; unmatched: number }>;
    mails: Array<{ id: string; title: string; href: string; linked: boolean }>;
    explanation: string; evidence: Array<{ label: string; quote: string }>;
    invoiceAmount: number | null; difference: number | null; cautions: string[];
  }>;
};
