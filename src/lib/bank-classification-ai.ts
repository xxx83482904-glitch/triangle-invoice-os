import "server-only";
import { createHash } from "node:crypto";
import { authorizeBankAi, maskBankAiText } from "@/lib/bank-ai";
import { previewBankRules } from "@/lib/banking";
import { CLASSIFICATION_AI_BATCH_SIZE, classificationAiOutputSchema, classificationAiScopeSchema, type ClassificationAiPayload, type ClassificationAiPreview, type ClassificationAiResult } from "@/lib/bank-classification-ai-types";
import type { AppData } from "@/lib/types";
import type { CompanyScope } from "@/lib/company";

export function prepareClassificationAi(data: AppData, userId: string, company: CompanyScope, rawScope: unknown) {
  const actor = authorizeBankAi(data, userId, company), scope = classificationAiScopeSchema.parse(rawScope);
  const ids = scope.ids ? new Set(scope.ids) : null;
  const scoped = data.bankTransactions.filter((row) => row.company === company && (!ids || ids.has(row.id)));
  if (ids && ids.size !== scoped.length) throw new Error("明細が見つかりません。画面を更新してください");
  // Rule previews keep complete confirmed history while AI scopes can exceed 500 selected rows.
  const rules = previewBankRules(data, actor, company);
  const ruleRows = new Map(rules.rows.map((row) => [row.id, row]));
  const eligible = scoped.filter((row) => !row.reviewed && !row.sourceMissing && row.sourceStatus !== "excluded" && row.treatment === "NORMAL"
    && (scope.history ? row.classificationSource !== "RULE" && (row.classificationSource !== "MANUAL" || Boolean(row.classificationConfidence && row.classificationReason && !/^(手動選択|ルール:)/.test(row.classificationReason))) : row.classificationSource !== "MANUAL" && !row.categoryId));
  const candidates = eligible.filter((row) => scope.history ? ruleRows.get(row.id)?.classificationSource !== "RULE" : !ruleRows.get(row.id)?.categoryId && (!ruleRows.has(row.id) || ruleRows.get(row.id)!.treatment === "NORMAL"))
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
  if (payload.transactions.some((row) => !row.allowedCategoryRefs.length)) throw new Error("対象明細に使用できる勘定科目がありません。対象会社・事業者の有効な科目を登録してください。");
  const historyRows: AppData["bankTransactions"] = [];
  if (scope.history) {
    payload.history = [];
    const categoryRefs = new Map(categories.map((row, i) => [row.id, `C${i + 1}`]));
    const normalized = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
    for (const [index, row] of rows.entries()) {
      const historical = data.bankTransactions.filter((past) => past.id !== row.id && past.company === company && past.officeCode === row.officeCode && past.bankAccountId === row.bankAccountId && past.side === row.side
        && past.transactionDate < row.transactionDate && past.reviewed && !past.sourceMissing && past.sourceStatus !== "excluded" && past.treatment === "NORMAL"
        && categoryRefs.has(past.categoryId || "") && payload.transactions[index].allowedCategoryRefs.includes(categoryRefs.get(past.categoryId || "")!) && maskBankAiText(past.content, 240).replace(/\[[A-Z]+\]/g, "").trim().length > 2);
      // Conflicting confirmed categories must not teach a false rule.
      const categorySets = new Map<string, Set<string>>();
      for (const past of historical) { const key = normalized(past.content), set = categorySets.get(key) || new Set<string>(); set.add(past.categoryId!); categorySets.set(key, set); }
      const content = normalized(row.content);
      const similarity = (text: string) => {
        const value = normalized(text);
        if (value === content) return 10000;
        const pairs = new Set(Array.from({ length: Math.max(0, content.length - 1) }, (_, i) => content.slice(i, i + 2)));
        return [...pairs].filter((pair) => value.includes(pair)).length;
      };
      const seen = new Set<string>();
      const examples = historical.filter((past) => categorySets.get(normalized(past.content))?.size === 1)
        .sort((a, b) => similarity(b.content) - similarity(a.content) || b.transactionDate.localeCompare(a.transactionDate) || a.id.localeCompare(b.id))
        .filter((past) => { const key = normalized(past.content); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 5);
      for (const past of examples) {
        historyRows.push(past);
        payload.history.push({ ref: `H${payload.history.length + 1}`, bankRef: `B${index + 1}`, date: past.transactionDate, content: maskBankAiText(past.content, 240), amount: past.amount, categoryRef: categoryRefs.get(past.categoryId!)! });
      }
    }
  }
  // Bind consent to exact records, eligible ordering and category definitions, not just visible text.
  const revision = createHash("sha256").update(JSON.stringify({ scope, payload, candidates: candidates.map((row) => [row.id, row.updatedAt]), categories: categories.map((row) => [row.id, row.updatedAt]), rows, historyRows })).digest("hex");
  const preview: ClassificationAiPreview = { scope, revision, payload, total: candidates.length, scoped: scoped.length, protected: scoped.length - eligible.length, ruleCandidates: eligible.length - candidates.length };
  return { preview, rows, categories };
}

export function validateClassificationAi(prepared: ReturnType<typeof prepareClassificationAi>, raw: unknown, model: string): ClassificationAiResult {
  const output = classificationAiOutputSchema.parse(raw), { payload } = prepared.preview;
  const decisions = new Map(output.decisions.map((row) => [row.bankRef, row]));
  if (decisions.size !== output.decisions.length || decisions.size !== payload.transactions.length || output.decisions.some((row) => !payload.transactions.some((bank) => bank.ref === row.bankRef))) throw new Error("AIの明細参照を検証できませんでした。結果は保存していません。");
  let lowConfidence = 0;
  const rows = prepared.rows.map((row, i) => {
    const bank = payload.transactions[i], decision = decisions.get(bank.ref)!;
    if (!bank.allowedCategoryRefs.includes(decision.categoryRef)) throw new Error("AIの勘定科目を検証できませんでした。結果は保存していません。");
    const uncertain = decision.confidence === "low" || decision.confidence === "unknown";
    const history = decision.historyRef ? payload.history?.find((past) => past.ref === decision.historyRef && past.bankRef === bank.ref && past.categoryRef === decision.categoryRef) : undefined;
    if (decision.historyRef && !history) throw new Error("AIが参照した過去実績を検証できませんでした。結果は保存していません。");
    // Missing evidence is allowed only for explicitly uncertain proposals; fabricated evidence never is.
    if ((!uncertain && !decision.quote.trim()) || (decision.quote && (!bank.content.includes(decision.quote) || /\[(NUMBER|SECRET|ACCOUNT|EMAIL|URL)\]/.test(decision.quote)))) throw new Error("AIの判断根拠を検証できませんでした。結果は保存していません。");
    const reason = maskBankAiText(decision.reason, 220);
    const index = payload.categories.findIndex((category) => category.ref === decision.categoryRef);
    if (uncertain) lowConfidence++;
    return { ...row, categoryId: prepared.categories[index].id, subCategoryId: undefined, reviewed: false, classificationSource: history && !uncertain ? "HISTORY" as const : "AUTO" as const, classificationConfidence: uncertain ? "GUESS" as const : history ? "HISTORY" as const : "INFERRED" as const, ruleId: undefined, classificationReason: `AI候補（${uncertain ? "要確認・推定" : history ? `過去実績 ${history.date}` : decision.confidence === "high" ? "確度高" : "要確認"}）: ${reason}` };
  });
  return { rows, suggested: rows.length, lowConfidence, model };
}
