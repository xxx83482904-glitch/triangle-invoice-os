import type { AppData } from "@/lib/types";

export function assertJapanData(data: AppData) {
  if (data.appEdition === "CHINA") throw new Error("中国版の保存先は日本版では使用できません");
  const scoped = [data.projects, data.clients, data.vendors, data.selectOptions, data.mailDocuments, data.mailFolders,
    data.bankAccounts, data.bankTransactions, data.accountingCategories, data.bankRules, data.bankSyncStates,
    data.bankReconciliations, data.bankTransfers || []];
  if (scoped.some((rows) => rows?.some((row) => row.company === "CHINA"))) {
    throw new Error("中国データの分離・移行が必要です。日本版への保存を中止しました");
  }
  const projectIds = new Set(data.projects.map((row) => row.id));
  if ([...data.issuedInvoices, ...data.receivedInvoices, ...data.estimates].some((row) => !projectIds.has(row.projectId))) {
    throw new Error("日本の案件に関連しない書類は保存できません");
  }
}
