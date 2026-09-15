import { z } from "zod";
import type { Estimate, TaxRate } from "@/lib/types";

export const estimateStatusLabels: Record<Estimate["status"], string> = {
  DRAFT: "下書き", SENT: "送付済み", ACCEPTED: "受注", DECLINED: "失注", CONVERTED: "請求書作成済み",
};
export const documentDateSchema = z.iso.date();
export const estimateSchema = z.object({
  id: z.string().min(1).optional(), updatedAt: z.string().min(1).optional(),
  projectId: z.string().min(1, "案件を選択してください"), clientId: z.string().min(1, "取引先を選択してください"),
  issueDate: documentDateSchema, validUntil: documentDateSchema,
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED"]),
  notes: z.string().max(10000).default(""), internalMemo: z.string().max(10000).default(""),
  items: z.array(z.object({
    description: z.string().trim().min(1, "明細の内容を入力してください").max(2000),
    quantity: z.number().positive().max(1000000), unitPrice: z.number().nonnegative().max(1000000000),
    taxRate: z.union([z.literal(10), z.literal(8), z.literal(0), z.literal(-1)]),
  })).min(1).max(100),
}).refine((v) => v.validUntil >= v.issueDate, { message: "有効期限は見積日以降にしてください", path: ["validUntil"] });
export type EstimateInput = z.input<typeof estimateSchema>;

export function estimateTotals(items: { quantity: number; unitPrice: number; taxRate: TaxRate }[]) {
  const amounts = items.map((item) => Math.round(item.quantity * item.unitPrice));
  const subtotal = amounts.reduce((sum, value) => sum + value, 0);
  const taxTotal = items.reduce((sum, item, index) => sum + (item.taxRate > 0 ? Math.round(amounts[index] * item.taxRate / 100) : 0), 0);
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}
