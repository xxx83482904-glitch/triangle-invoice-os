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
  // Required when a GUESS classification is marked reviewed: the person confirms they looked at it.
  acknowledgeGuess?: boolean;
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
  // Transfer fee handled with this link: "payer" = deducted from an incoming transfer (counts toward the invoice),
  // "bank" = charged on top of an outgoing transfer (counts toward the bank row).
  fee?: { amount: number; categoryId?: string; borneBy: "payer" | "bank" };
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

// Fields a sync may rewrite. Identity fields invalidate review; meta fields are informational only.
export const BANK_SYNC_IDENTITY_FIELDS = ["bankAccountId", "transactionDate", "amount", "side", "content"] as const;
export const BANK_SYNC_META_FIELDS = ["sourceMemo", "sourceStatus"] as const;
export type BankSyncSourceField = (typeof BANK_SYNC_IDENTITY_FIELDS)[number] | (typeof BANK_SYNC_META_FIELDS)[number] | "sourceMissing";
export type BankSyncChangeKind = "CHANGED" | "META" | "MISSING" | "RESTORED";
export type BankSyncReviewSnapshot = Pick<BankTransaction, "reviewed" | "categoryId" | "subCategoryId" | "treatment" | "classificationSource" | "classificationConfidence" | "classificationReason" | "ruleId">;
export type BankSyncChange = {
  transactionId: string;
  kind: BankSyncChangeKind;
  fields: Array<{ key: BankSyncSourceField; before: string | number | boolean; after: string | number | boolean }>;
  reviewCleared: boolean;
  before?: BankSyncReviewSnapshot;
  afterUpdatedAt: string;
  restoredAt?: string;
};
export type BankSyncRun = BankEntity & {
  runId: string;
  officeCode: string;
  actorId: string;
  mode: "recent" | "all" | "range";
  status: "RUNNING" | "SUCCESS" | "ERROR";
  error?: string;
  rangeStart?: string;
  rangeEnd?: string;
  startedAt: string;
  finishedAt?: string;
  added: number;
  changed: number;
  metaOnly: number;
  missing: number;
  restored: number;
  reviewCleared: number;
  changes: BankSyncChange[];
  truncated: boolean;
};
