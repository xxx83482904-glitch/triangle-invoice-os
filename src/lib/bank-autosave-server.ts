import { z, ZodError } from "zod";
import { assertBankAccess, bankDisplayRows, saveBankEdits } from "@/lib/banking";
import { bankEditFrom } from "@/lib/bank-workspace-drafts";
import type { BankAutosaveEdit, BankAutosaveResult } from "@/lib/bank-autosave";
import type { CompanyScope } from "@/lib/company";
import type { AppData, User } from "@/lib/types";

const patchSchema = z.object({
  categoryId: z.string().max(1000).optional(), subCategoryId: z.string().max(1000).optional(),
  treatment: z.enum(["NORMAL", "TRANSFER", "EXCLUDED"]).optional(), reviewed: z.boolean().optional(),
  memo: z.string().max(2000).optional(), classificationConfidence: z.enum(["GUESS", "HISTORY", "INFERRED"]).optional(),
  classificationReason: z.string().max(1000).optional(), acknowledgeGuess: z.boolean().optional(),
});

export function saveBankAutosaveEdits(data: AppData, user: Pick<User, "id" | "role">, company: CompanyScope, input: BankAutosaveEdit[], auditLogId: string): BankAutosaveResult {
  assertBankAccess(user, company);
  const edits = z.array(z.object({ id: z.string().min(1), updatedAt: z.string(), patch: z.unknown() })).min(1).max(100).parse(input);
  if (new Set(edits.map((edit) => edit.id)).size !== edits.length) throw new Error("明細が重複しています");
  const savedIds = new Set<string>();
  const failures: BankAutosaveResult["failures"] = [];
  for (const edit of edits) {
    const row = data.bankTransactions.find((row) => row.company === company && row.id === edit.id);
    try {
      if (!row) throw new Error("明細が見つかりません");
      // Only explicit fields may replace persisted values; display predictions are not consent.
      const patch = patchSchema.parse(edit.patch);
      saveBankEdits(data, user, company, [{ ...bankEditFrom(row), ...patch, id: row.id, updatedAt: edit.updatedAt }]);
      savedIds.add(row.id);
    } catch (error) {
      failures.push({ id: edit.id, kind: row && row.updatedAt !== edit.updatedAt ? "conflict" : "failed",
        error: error instanceof ZodError ? "入力内容を確認してください" : error instanceof Error ? error.message : "保存できませんでした" });
    }
  }
  return { rows: bankDisplayRows(data, data.bankTransactions.filter((row) => savedIds.has(row.id))), failures, auditLogId: savedIds.size ? auditLogId : undefined };
}
