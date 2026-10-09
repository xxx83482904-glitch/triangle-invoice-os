import { z } from "zod";
import type { BankTransaction } from "@/lib/banking-types";
import type { CompanyScope } from "@/lib/company";

export const CLASSIFICATION_AI_BATCH_SIZE = 50;
export const classificationAiScopeSchema = z.object({
  ids: z.array(z.string().min(1).max(1000)).min(1).max(500).optional(),
  batch: z.number().int().min(0).max(10000),
}).strict();
export type ClassificationAiScope = z.infer<typeof classificationAiScopeSchema>;
export type ClassificationAiPayload = {
  company: CompanyScope;
  categories: Array<{ ref: string; name: string; group: string }>;
  transactions: Array<{ ref: string; date: string; content: string; amount: number; side: "INCOME" | "EXPENSE"; accountKind: "BANK" | "CARD" | "UNKNOWN"; allowedCategoryRefs: string[] }>;
};
export type ClassificationAiPreview = {
  scope: ClassificationAiScope; revision: string; payload: ClassificationAiPayload;
  total: number; scoped: number; protected: number; ruleCandidates: number;
};
export const classificationAiOutputSchema = z.object({
  decisions: z.array(z.object({
    bankRef: z.string().regex(/^B\d+$/), categoryRef: z.string().regex(/^C\d+$/).nullable(),
    confidence: z.enum(["high", "medium", "low", "unknown"]),
    reason: z.string().min(1).max(220), quote: z.string().max(120),
  }).strict()).max(CLASSIFICATION_AI_BATCH_SIZE),
}).strict();
export type ClassificationAiResult = { rows: BankTransaction[]; suggested: number; unresolved: number; model: string };
