import type { ObligationKind, Vendor } from "@/lib/types";

export const obligationKindLabels: Record<ObligationKind | "UNSET", string> = {
  UNSET: "未設定（名前から推定）", TAX: "税金", SOCIAL_INSURANCE: "社会保険", NONE: "対象外",
};
// Party names only. Document text contains ordinary consumption-tax lines and payment instructions.
export const taxPartyPattern = /税務署|国税|都税|県税|府税|市税|区役所|市役所|町役場|役場|住民税|法人税|消費税|固定資産税|自動車税|事業税|源泉所得税|納税/;
export const insurancePartyPattern = /年金事務所|年金|健康保険|社会保険|厚生年金|労働保険|雇用保険|労災|国民健康保険|日本年金機構|協会けんぽ|ハローワーク/;
export const normalizeObligationParty = (name: string) => name.normalize("NFKC").replace(/\s+/g, "");
export type ObligationClassification = { kind: Exclude<ObligationKind, "NONE">; basis: "VENDOR" | "NAME"; evidence: string };

export function inferObligationKind(name: string): ObligationClassification | undefined {
  const normalized = normalizeObligationParty(name);
  const insurance = normalized.match(insurancePartyPattern)?.[0];
  if (insurance) return { kind: "SOCIAL_INSURANCE", basis: "NAME", evidence: insurance };
  const tax = normalized.match(taxPartyPattern)?.[0];
  if (tax) return { kind: "TAX", basis: "NAME", evidence: tax };
}

export function classifyObligationParty(name: string, vendor?: Pick<Vendor, "companyName" | "obligationKind">): ObligationClassification | undefined {
  if (vendor?.obligationKind === "NONE") return;
  if (vendor?.obligationKind === "TAX" || vendor?.obligationKind === "SOCIAL_INSURANCE") return { kind: vendor.obligationKind, basis: "VENDOR", evidence: vendor.companyName };
  return inferObligationKind(name);
}
