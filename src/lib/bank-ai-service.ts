import "server-only";
import { z } from "zod";
import { authorizeBankAi, prepareBankAi, reserveBankAiUsage, validateBankAiResult, type PreparedBankAi } from "@/lib/bank-ai";
import { requestBankAi } from "@/lib/bank-ai-client";
import { bankAiScopeSchema } from "@/lib/bank-ai-types";
import { effectiveOcrConfig } from "@/lib/ocr-settings";
import { mutateData, readData } from "@/lib/store";
import type { CompanyScope } from "@/lib/company";

const requestSchema = z.object({ scope: bankAiScopeSchema, revision: z.string().regex(/^[a-f0-9]{64}$/), consent: z.literal(true) }).strict();
const dependencies = { read: readData, mutate: mutateData, config: effectiveOcrConfig, request: requestBankAi };

export async function runBankAiReview(userId: string, company: CompanyScope, input: unknown, deps = dependencies) {
  const request = requestSchema.parse(input), initial = await deps.read();
  authorizeBankAi(initial, userId, company);
  const config = await deps.config();
  if (!config.openAiApiKey) throw new Error("AIのAPIキーが未設定です。管理者がAI設定にOpenAI APIキーを登録してください。");
  let prepared: PreparedBankAi | undefined;
  // Only reserve usage inside the store lock. No remote request or raw financial data enters the audit log.
  await deps.mutate(userId, "BANK_AI_REQUEST", "BankAi", company, (data) => {
    authorizeBankAi(data, userId, company);
    prepared = prepareBankAi(data, company, request.scope);
    if (prepared.preview.revision !== request.revision) throw new Error("対象データが更新されています。画面を更新して再確認してください。");
    if (!prepared.banks.length || !prepared.invoices.length && !prepared.mails.length) throw new Error("対象の銀行明細・書類がありません。");
    const count = reserveBankAiUsage(data, company);
    return { company, count, scope: request.scope.mode, model: config.ocrAiModel, banks: prepared.banks.length, invoices: prepared.invoices.length, mails: prepared.mails.length };
  }, undefined, { undoable: false });
  if (!prepared) throw new Error("対象データを準備できませんでした。");
  const output = await deps.request(prepared.preview.payload, { apiKey: config.openAiApiKey, model: config.ocrAiModel });
  const current = await deps.read(); authorizeBankAi(current, userId, company);
  if (prepareBankAi(current, company, request.scope).preview.revision !== prepared.preview.revision) throw new Error("分析中に対象データが変更されました。古い結果は表示しません。画面を更新してください。");
  return validateBankAiResult(prepared, output, config.ocrAiModel);
}
