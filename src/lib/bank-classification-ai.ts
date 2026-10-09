import "server-only";
import { createHash } from "node:crypto";
import { authorizeBankAi, maskBankAiText } from "@/lib/bank-ai";
import { previewBankRules } from "@/lib/banking";
import { CLASSIFICATION_AI_BATCH_SIZE, classificationAiOutputSchema, classificationAiScopeSchema, type ClassificationAiPayload, type ClassificationAiPreview, type ClassificationAiResult } from "@/lib/bank-classification-ai-types";
import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";

export function prepareClassificationAi(data: AppData, userId: string, company: CompanyScope, rawScope: unknown) {
  const actor = authorizeBankAi(data, userId, company), scope = classificationAiScopeSchema.parse(rawScope);
  const rules = previewBankRules(data, actor, company, scope.ids);
  const ids = scope.ids ? new Set(scope.ids) : null;
  const scoped = data.bankTransactions.filter((row) => row.company === company && (!ids || ids.has(row.id)));
  const ruleRows = new Map(rules.rows.map((row) => [row.id, row]));
  const eligible = scoped.filter((row) => !row.reviewed && !row.sourceMissing && row.sourceStatus !== "excluded" && row.classificationSource !== "MANUAL" && !row.categoryId && row.treatment === "NORMAL");
  const candidates = eligible.filter((row) => !ruleRows.get(row.id)?.categoryId && (!ruleRows.has(row.id) || ruleRows.get(row.id)!.treatment === "NORMAL"))
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || a.id.localeCompare(b.id));
  const rows = candidates.slice(scope.batch * CLASSIFICATION_AI_BATCH_SIZE, (scope.batch + 1) * CLASSIFICATION_AI_BATCH_SIZE);
  if (scope.batch > 0 && !rows.length) throw new Error("対象範囲が変わりました。最初の範囲から再確認してください。");
  const offices = new Set(rows.map((row) => row.officeCode));
  const categories = data.accountingCategories.filter((row) => row.company === company && !row.parentId && row.available && !row.deletedAt && (!row.officeCode || offices.has(row.officeCode)))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (categories.length > 500) throw new Error("勘定科目が多すぎます。管理者が有効な科目を整理してください。");
  const accounts = new Map(data.bankAccounts.filter((row) => row.company === company).map((row) => [row.id, row]));
  const payload: ClassificationAiPayload = {
    company,
    categories: categories.map((row, i) => ({ ref: `C${i + 1}`, name: maskBankAiText(row.name, 150), group: maskBankAiText(row.group, 60) })),
    transactions: rows.map((row, i) => {
      const account = accounts.get(row.bankAccountId), service = account?.serviceName || "";
      const accountKind = account?.forecastSettings?.accountKind;
      return { ref: `B${i + 1}`, date: row.transactionDate, content: maskBankAiText(row.content, 240), amount: row.amount, side: row.side,
        accountKind: accountKind === "BANK" || accountKind === "CARD" ? accountKind : /カード|card|upsider/i.test(service) ? "CARD" : /銀行|bank/i.test(service) ? "BANK" : "UNKNOWN",
        allowedCategoryRefs: categories.flatMap((category, index) => !category.officeCode || category.officeCode === row.officeCode ? [`C${index + 1}`] : []),
      };
    }),
  };
  // Bind consent to exact records, eligible ordering and category definitions, not just visible text.
  const revision = createHash("sha256").update(JSON.stringify({ scope, payload, candidates: candidates.map((row) => [row.id, row.updatedAt]), categories: categories.map((row) => [row.id, row.updatedAt]), rows })).digest("hex");
  const preview: ClassificationAiPreview = { scope, revision, payload, total: candidates.length, scoped: scoped.length, protected: scoped.length - eligible.length, ruleCandidates: eligible.length - candidates.length };
  return { preview, rows, categories };
}

export function validateClassificationAi(prepared: ReturnType<typeof prepareClassificationAi>, raw: unknown, model: string): ClassificationAiResult {
  const output = classificationAiOutputSchema.parse(raw), { payload } = prepared.preview;
  const decisions = new Map(output.decisions.map((row) => [row.bankRef, row]));
  if (decisions.size !== output.decisions.length || decisions.size !== payload.transactions.length || output.decisions.some((row) => !payload.transactions.some((bank) => bank.ref === row.bankRef))) throw new Error("AIの明細参照を検証できませんでした。結果は保存していません。");
  let suggested = 0;
  const rows = prepared.rows.map((row, i) => {
    const bank = payload.transactions[i], decision = decisions.get(bank.ref)!;
    if (decision.categoryRef && !bank.allowedCategoryRefs.includes(decision.categoryRef)) throw new Error("AIの勘定科目を検証できませんでした。結果は保存していません。");
    const accepted = decision.categoryRef && ["high", "medium"].includes(decision.confidence);
    if (accepted && (!decision.quote.trim() || !bank.content.includes(decision.quote) || /\[(NUMBER|SECRET|ACCOUNT|EMAIL|URL)\]/.test(decision.quote))) throw new Error("AIの判断根拠を検証できませんでした。結果は保存していません。");
    const reason = maskBankAiText(decision.reason, 220);
    if (!accepted) return { ...row, classificationReason: `AI未判定: ${reason}` };
    const index = payload.categories.findIndex((category) => category.ref === decision.categoryRef);
    suggested++;
    return { ...row, categoryId: prepared.categories[index].id, subCategoryId: undefined, reviewed: false, classificationSource: "AUTO" as const, ruleId: undefined, classificationReason: `AI候補（${decision.confidence === "high" ? "確度高" : "要確認"}）: ${reason}` };
  });
  return { rows, suggested, unresolved: rows.length - suggested, model };
}
