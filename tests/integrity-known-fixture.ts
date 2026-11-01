import { fixture, timestamp } from "./document-fixture";
import type { BankTransaction } from "../src/lib/banking-types";

export const integrityKnownToday = "2026-11-01";
export const knownBankRow = (id: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: "office", sourceId: id, bankAccountId: "bank", transactionDate: "2026-10-10", amount: 1000, side: "EXPENSE", content: `合成 ${id}`, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "MANUAL", reviewed: false, memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
export function integrityKnownFixture() {
  const data = fixture(); data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = []; data.receivedInvoices = []; data.mailDocuments = []; data.attachments = [];
  data.users = [{ id: "admin", name: "合成管理者", email: "admin@example.invalid", role: "ADMIN", passwordHash: "unused", createdAt: timestamp, updatedAt: timestamp }];
  data.bankAccounts = [{ id: "bank", company: "JAPAN", officeCode: "office", sourceId: "bank", name: "合成銀行 普通", serviceName: "合成銀行", available: true, isManual: false, createdAt: timestamp, updatedAt: timestamp }];
  data.accountingCategories = ["misc", "supplies"].map((id) => ({ id, company: "JAPAN" as const, officeCode: "office", name: id === "misc" ? "雑費" : "消耗品費", group: "EXPENSE", available: true, createdAt: timestamp, updatedAt: timestamp }));
  data.bankTransactions = [
    ...[1, 2, 3].map((index) => knownBankRow(`guess-${index}`, { reviewed: true, categoryId: "misc", classificationSource: "HISTORY", classificationConfidence: "GUESS", classificationReason: "合成: 摘要だけから推測", content: `合成用途不明 ${index}` })),
    knownBankRow("spread-1", { reviewed: true, categoryId: "misc", content: "合成複合サービス" }),
    knownBankRow("spread-2", { reviewed: true, categoryId: "supplies", content: "合成複合サービス" }),
    ...["口座振替 APアプラス", "振込 ｶ)ｱｯﾌﾟｻｲﾀﾞｰ", "UPSIDER", "アップサイダー", "振込 ＵＰＳＩＤＥＲ"].map((content, index) => knownBankRow(`settlement-${index}`, { treatment: "TRANSFER", reviewed: true, content, memo: "合成検証用の決済摘要", categoryId: "misc", classificationConfidence: "GUESS", classificationReason: "保存済み値" })),
    knownBankRow("other-transfer", { treatment: "TRANSFER", content: "振込 合成別会社" }),
    knownBankRow("upsider-refund", { treatment: "TRANSFER", side: "INCOME", content: "UPSIDER 返金" }),
    knownBankRow("upsider-fee", { treatment: "TRANSFER", content: "UPSIDER 手数料" }),
    knownBankRow("upsider-similar", { treatment: "TRANSFER", content: "UPSIDERショップ" }),
  ];
  data.bankTransfers = [];
  return data;
}
