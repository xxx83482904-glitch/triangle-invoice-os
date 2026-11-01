import type { CompanyScope } from "@/lib/company";

export function projectCreationValues(company: CompanyScope, input: { stage?: string; contractAmount?: number }) {
  return {
    stage: input.stage?.trim() || (company === "JAPAN" ? undefined : "制作资料"),
    contractAmount: input.contractAmount ?? (company === "JAPAN" ? undefined : 0),
  };
}

export function projectContractValue(project?: { company?: CompanyScope; contractAmount?: number }) {
  return project?.contractAmount ?? (project?.company === "JAPAN" ? null : 0);
}

export function projectStageLabel(company: CompanyScope, stage?: string) {
  return company === "JAPAN" && (!stage || stage === "制作资料") ? "段階未設定" : stage || "";
}

export function projectStageOptions(company: CompanyScope, options: Array<{ value: string; label: string }>, creating = false) {
  return company === "JAPAN" ? options.filter((option) => !creating || option.value !== "制作资料").map((option) => option.value === "制作资料" ? { ...option, label: "段階未設定" } : option) : options;
}

export function projectUninvoiced(contractAmount: number | null, invoicedAmount: number) {
  return contractAmount === null ? null : Math.max(contractAmount - invoicedAmount, 0);
}

export function projectContractSummary(rows: Array<{ contractAmount: number | null; invoicedAmount: number }>) {
  return rows.reduce((sum, row) => {
    const uninvoiced = projectUninvoiced(row.contractAmount, row.invoicedAmount);
    return { uninvoicedAmount: sum.uninvoicedAmount + (uninvoiced ?? 0), unsetContractCount: sum.unsetContractCount + Number(uninvoiced === null) };
  }, { uninvoicedAmount: 0, unsetContractCount: 0 });
}

// 要対応 means a deadline. Document review stays on the row and has its own filter.
// People who cannot see money get no deadlines, so document review remains their signal.
export function projectNeedsAction(items: Array<{ financial: boolean }>, showFinancials: boolean) {
  return items.some((item) => (showFinancials ? item.financial : !item.financial));
}

export function projectAttentionPriority(items: Array<{ financial: boolean; priority: number }>, showFinancials: boolean) {
  return items.filter((item) => showFinancials || !item.financial).reduce((highest, item) => Math.max(highest, item.priority), 0);
}
