"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { readData } from "@/lib/store";
import { prepareClassificationAi } from "@/lib/bank-classification-ai";
import { runClassificationAi } from "@/lib/bank-classification-ai-service";
import { effectiveOcrConfig } from "@/lib/ocr-settings";
import type { ClassificationAiScope } from "@/lib/bank-classification-ai-types";
import type { CompanyScope } from "@/lib/company";

const message = (error: unknown) => error instanceof z.ZodError ? "AI判定の入力・応答を検証できませんでした。結果は保存していません。" : error instanceof Error ? error.message : "AI判定に失敗しました。結果は保存していません。";

export async function prepareClassificationAiAction(company: CompanyScope, scope: ClassificationAiScope) {
  const user = await requireUser();
  try {
    const preview = prepareClassificationAi(await readData(), user.id, company, scope).preview;
    const config = await effectiveOcrConfig();
    return { success: true as const, preview, model: config.ocrAiModel, configured: Boolean(config.openAiApiKey) };
  } catch (error) { return { success: false as const, error: message(error) }; }
}

export async function classifyWithAiAction(company: CompanyScope, input: { scope: ClassificationAiScope; revision: string; model: string; consent: true }) {
  const user = await requireUser();
  try {
    return { success: true as const, result: await runClassificationAi(user.id, company, input) };
  } catch (error) { return { success: false as const, error: message(error) }; }
}
