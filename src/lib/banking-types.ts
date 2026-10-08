import type { CompanyScope } from "@/lib/company";

export type BankTreatment = "NORMAL" | "TRANSFER" | "EXCLUDED";
export type BankClassificationSource = "UNASSIGNED" | "RULE" | "MANUAL";
type BankEntity = { id: string; company: CompanyScope; createdAt: string; updatedAt: string };

export type BankAccount = BankEntity & {
  officeCode: string;
  sourceId: string;
  sourceSubId?: string;
  name: string;
  serviceName: string;
  isManual: boolean;
  available: boolean;
};

export type AccountingCategory = BankEntity & {
  name: string;
  group: string;
  parentId?: string;
  officeCode?: string;
  sourceId?: string;
  available: boolean;
  deletedAt?: string | null;
};

export type BankTransaction = BankEntity & {
  officeCode: string;
  sourceId: string;
  bankAccountId: string;
  transactionDate: string;
  amount: number;
  side: "INCOME" | "EXPENSE";
  content: string;
  sourceMemo: string;
  sourceStatus: string;
  sourceMissing: boolean;
  categoryId?: string;
  subCategoryId?: string;
  treatment: BankTreatment;
  classificationSource: BankClassificationSource;
  ruleId?: string;
  reviewed: boolean;
  memo: string;
};

export type BankRule = BankEntity & {
  name: string;
  keyword: string;
  match: "CONTAINS" | "EXACT";
  bankAccountId?: string;
  side: "ALL" | "INCOME" | "EXPENSE";
  categoryId?: string;
  subCategoryId?: string;
  treatment: BankTreatment;
  priority: number;
  enabled: boolean;
  deletedAt?: string | null;
};

export type BankSyncState = BankEntity & {
  officeCode: string;
  officeName: string;
  autoSync: boolean;
  status: "IDLE" | "RUNNING" | "SUCCESS" | "ERROR";
  runId?: string;
  startedAt?: string;
  lastSuccessAt?: string;
  rangeStart?: string;
  rangeEnd?: string;
  completedThrough?: string;
  requestMode?: "recent" | "all" | "range";
  imported: number;
  updated: number;
  error?: string;
};

export type BankEdit = {
  id: string;
  updatedAt: string;
  categoryId?: string;
  subCategoryId?: string;
  treatment: BankTreatment;
  reviewed: boolean;
  memo: string;
};

export type BankRuleInput = Omit<BankRule, "company" | "createdAt" | "id" | "updatedAt" | "deletedAt"> & { id?: string; updatedAt?: string };
export type CategoryInput = { id?: string; updatedAt?: string; name: string; group: string; parentId?: string };
export type BankFilters = {
  month: string;
  account: string;
  category: string;
  side: string;
  status: string;
  query: string;
  sort: string;
  page: number;
};
