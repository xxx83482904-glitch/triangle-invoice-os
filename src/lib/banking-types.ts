import type { CompanyScope } from "@/lib/company";
import type { BankBookkeeping } from "@/lib/bank-bookkeeping";

export type BankTreatment = "NORMAL" | "TRANSFER" | "EXCLUDED";
export type BankClassificationSource = "UNASSIGNED" | "RULE" | "HISTORY" | "AUTO" | "MANUAL";
export type BankClassificationConfidence = "GUESS" | "HISTORY" | "INFERRED";
type BankEntity = { id: string; company: CompanyScope; createdAt: string; updatedAt: string };

export type BankAccount = BankEntity & {
  officeCode: string;
  sourceId: string;
  sourceSubId?: string;
  name: string;
  serviceName: string;
  isManual: boolean;
  available: boolean;
  forecastSettings?: BankForecastSettings;
  overviewSettings?: BankOverviewSettings;
};

export type BankOverviewSettings = {
  kind: "UNKNOWN" | "BANK" | "CARD" | "OTHER";
  balance?: { amount: number; asOf: string; currency: "JPY" };
  recordedAt: string;
};

export type BankForecastSettings = {
  accountKind: "UNKNOWN" | "BANK" | "CARD" | "OTHER";
  balanceMonth: string;
  openingBalance?: number;
  minimumBalance: number;
  incomePercent: number;
  expensePercent: number;
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
  classificationReason?: string;
  classificationConfidence?: BankClassificationConfidence;
  ruleId?: string;
  reviewed: boolean;
  memo: string;
  bookkeeping?: BankBookkeeping;
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
  coverage?: Array<{ start: string; end: string; accountIds: string[] }>;
};

export type BankEdit = {
  id: string;
  updatedAt: string;
  categoryId?: string;
  subCategoryId?: string;
  treatment: BankTreatment;
  reviewed: boolean;
  memo: string;
  classificationSource?: BankClassificationSource;
  classificationReason?: string;
  classificationConfidence?: BankClassificationConfidence;
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
  queryMode?: "contains" | "exact";
  excludeQuery?: string;
  sort: string;
  page: number;
  transaction?: string;
  analysisThrough?: string;
};

export type BankReconciliation = BankEntity & {
  transactionId: string;
  invoiceKind: "issued" | "received";
  invoiceId: string;
  paymentId: string;
  amount: number;
  createdPayment: boolean;
  bankEvidence: string;
  invoiceEvidence: string;
  paymentEvidence: string;
  note: string;
  confirmedById: string;
  reaffirmedAt?: string;
  reaffirmedById?: string;
  reaffirmedIssue?: string;
  deletedAt?: string | null;
};

export type BankTransfer = BankEntity & {
  outgoingId: string;
  incomingId: string;
  outgoingEvidence: string;
  incomingEvidence: string;
  previous: Array<BankEdit & { ruleId?: string }>;
  confirmedById: string;
  deletedAt?: string | null;
};
