import { z } from "zod";
import type { Estimate } from "@/lib/types";
import { documentItemsSchema } from "@/lib/document-items";
export { documentItemTotals as estimateTotals } from "@/lib/document-items";

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
  items: documentItemsSchema,
}).refine((v) => v.validUntil >= v.issueDate, { message: "有効期限は見積日以降にしてください", path: ["validUntil"] });
export type EstimateInput = z.input<typeof estimateSchema>;
