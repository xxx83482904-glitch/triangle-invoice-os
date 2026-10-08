"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { runBankAiReview } from "@/lib/bank-ai-service";
import type { BankAiScope } from "@/lib/bank-ai-types";
import type { CompanyScope } from "@/lib/company";

export async function analyzeBankDocumentsAction(company: CompanyScope, input: { scope: BankAiScope; revision: string; consent: true }) {
  const user = await requireUser();
  try {
    const result = await runBankAiReview(user.id, company, input);
    return { success: true as const, result };
  } catch (error) {
    return { success: false as const, error: error instanceof z.ZodError ? "AIの入力・応答形式を確認できませんでした。自動更新は行っていません。" : error instanceof Error ? error.message : "AIの確認に失敗しました。通常の照合は利用できます。" };
  }
}
