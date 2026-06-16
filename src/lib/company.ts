export type CompanyScope = "CHINA" | "JAPAN";

export const mailSorterCompany: CompanyScope = "JAPAN";

export const companyOptions: Array<{ label: string; shortLabel: string; value: CompanyScope }> = [
  { label: "中国支社", shortLabel: "中国", value: "CHINA" },
  { label: "日本本社", shortLabel: "日本", value: "JAPAN" },
];

export function companyFromParam(value?: string | null): CompanyScope {
  return value === "JAPAN" ? "JAPAN" : "CHINA";
}

export function projectCompany(project: { company?: CompanyScope | null }): CompanyScope {
  return project.company === "JAPAN" ? "JAPAN" : "CHINA";
}

export function matchesCompany(project: { company?: CompanyScope | null }, company: CompanyScope) {
  return projectCompany(project) === company;
}

export function partnerCompany(partner: { company?: CompanyScope | null }): CompanyScope {
  return partner.company === "JAPAN" ? "JAPAN" : "CHINA";
}

export function partnerMatchesCompany(partner: { company?: CompanyScope | null }, company: CompanyScope) {
  return partnerCompany(partner) === company;
}

export function companyClientId(company: CompanyScope) {
  return company === "JAPAN" ? "cli-japan" : "cli-china";
}
