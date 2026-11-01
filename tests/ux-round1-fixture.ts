import { fixture, timestamp } from "./document-fixture";
import type { BankTransaction } from "../src/lib/banking-types";

// Bank-only fixture for UX round 1 items 1 and 2; drafts are created through real UI actions.
export function uxRound1Fixture() {
  const data = fixture();
  data.appEdition = "JAPAN";
  data.projects = []; data.clients = []; data.vendors = []; data.issuedInvoices = []; data.receivedInvoices = [];
  data.mailDocuments = []; data.attachments = []; data.estimates = []; data.payments = [];
  data.bankAccounts = [{ id: "ux-bank", company: "JAPAN", officeCode: "synthetic", sourceId: "ux-bank", name: "合成UX普通預金", serviceName: "合成銀行", isManual: true, available: true, createdAt: timestamp, updatedAt: timestamp }];
  data.accountingCategories = ["雑費", "消耗品費"].map((name, i) => ({ id: `ux-category-${i}`, company: "JAPAN", name, group: "EXPENSE", available: true, createdAt: timestamp, updatedAt: timestamp }));
  const transaction = (id: string, title: string, patch: Partial<BankTransaction> = {}): BankTransaction => ({ id, company: "JAPAN", officeCode: "synthetic", sourceId: id, bankAccountId: "ux-bank", transactionDate: "2026-10-30", amount: 1000, side: "EXPENSE", content: `合成UX ${title}`, sourceMemo: "", sourceStatus: "", sourceMissing: false, categoryId: "ux-category-0", classificationSource: "AUTO", classificationConfidence: "INFERRED", classificationReason: "合成: 摘要からの推定（未確認）", reviewed: false, treatment: "NORMAL", memo: "", createdAt: timestamp, updatedAt: timestamp, ...patch });
  data.bankTransactions = [
    transaction("ux-01-manual", "01 メモを編集する明細", { classificationSource: "MANUAL", classificationReason: "合成: 人が科目を選択" }),
    transaction("ux-02-review", "02 確認済みにする明細", { classificationSource: "HISTORY", classificationConfidence: "HISTORY", classificationReason: "合成: 同じ口座と摘要の確認済み履歴" }),
    transaction("ux-03-prediction", "03 選択する自動候補", { categoryId: undefined, classificationSource: "UNASSIGNED", classificationConfidence: undefined, classificationReason: undefined }),
    transaction("ux-04-unselected", "04 選択しない自動候補", { categoryId: undefined, classificationSource: "UNASSIGNED", classificationConfidence: undefined, classificationReason: undefined }),
    transaction("ux-05-guess", "05 推測のまま確認済み", { classificationSource: "MANUAL", classificationConfidence: "GUESS", reviewed: true, classificationReason: "推測候補を内容確認のうえ確定: 合成用途の仮分類" }),
    transaction("ux-06-history", "06 過去実績のまま確認済み", { classificationSource: "MANUAL", classificationConfidence: "HISTORY", reviewed: true, classificationReason: "合成: 同じ摘要の過去実績" }),
    transaction("ux-07-rule", "07 ルールの根拠", { classificationSource: "RULE", classificationReason: "合成: 登録済みルールとの一致" }),
    transaction("ux-08-inferred", "08 推定の根拠"),
    transaction("ux-09-held", "09 保留中の過去実績", { classificationSource: "HISTORY", classificationConfidence: "HISTORY", classificationReason: "合成: 過去実績はあるが原本待ち", bookkeeping: { hold: { reason: "MISSING_DOCUMENT", question: "合成: 原本の到着を確認する" } } }),
    transaction("ux-10-missing", "10 元明細なし", { sourceMissing: true }),
    transaction("ux-11-excluded", "11 対象外", { treatment: "EXCLUDED", categoryId: undefined, classificationSource: "MANUAL" }),
    transaction("ux-12-split", "12 科目分割", { categoryId: undefined, classificationSource: "MANUAL", bookkeeping: { splits: [{ id: "ux-part-1", categoryId: "ux-category-0", amount: 500, memo: "" }, { id: "ux-part-2", categoryId: "ux-category-1", amount: 500, memo: "" }] } }),
  ];
  return data;
}
