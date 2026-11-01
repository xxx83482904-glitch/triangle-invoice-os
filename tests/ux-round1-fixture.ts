import { fixture, timestamp } from "./document-fixture";
import type { BankTransaction } from "../src/lib/banking-types";
import type { Project } from "../src/lib/types";

// Drafts are created through real UI actions. Dates are relative to the supplied preview day.
export function uxRound1Fixture(today = "2026-11-01") {
  const data = fixture();
  const templates = { client: data.clients[0], vendor: data.vendors[0], issued: data.issuedInvoices[0], received: data.receivedInvoices[0], mail: data.mailDocuments[0] };
  data.appEdition = "JAPAN";
  data.projects = []; data.clients = []; data.vendors = []; data.issuedInvoices = []; data.receivedInvoices = [];
  data.mailDocuments = []; data.attachments = []; data.estimates = []; data.payments = [];
  data.bankAccounts = [{ id: "ux-bank", company: "JAPAN", officeCode: "synthetic", sourceId: "ux-bank", name: "合成UX普通預金", serviceName: "合成 三菱UFJ銀行", isManual: true, available: true, createdAt: timestamp, updatedAt: timestamp }];
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
  const date = (offset: number) => new Date(Date.parse(today + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
  data.clients = [{ ...templates.client, companyName: "合成UX請求先" }];
  data.vendors = [{ ...templates.vendor, companyName: "合成UX支払先" }];
  const project = (id: string, name: string, patch: Partial<Project> = {}): Project => ({ id, name, company: "JAPAN", clientId: "client", managerId: "admin", memberIds: [], status: "IN_PROGRESS", createdAt: timestamp, updatedAt: timestamp, ...patch });
  data.projects = [
    project("ux-project-reference", "合成01 契約書なし・待機のみ（対応不要）", { status: "WAITING", stage: "制作资料", contractAmount: 50000 }),
    project("ux-project-unset", "合成02 契約金額・段階未設定（対応不要）"),
    project("ux-project-zero", "合成03 契約金額0円（対応不要）", { contractAmount: 0, stage: "設計" }),
    project("ux-project-overdue", "合成04 入金期限超過・一部入金", { contractAmount: 12000 }),
    project("ux-project-soon", "合成05 支払期限7日以内"),
    project("ux-project-review", "合成06 書類確認待ち"),
    project("ux-project-future", "合成07 期限8日先（対応不要）"),
    project("ux-project-paid", "合成08 全額支払済み（対応不要）"),
    project("ux-project-expense-overdue", "合成09 支払期限超過"),
    project("ux-project-income-soon", "合成10 入金期限7日以内"),
  ];
  data.issuedInvoices = [
    { ...templates.issued, id: "ux-issued-overdue", projectId: "ux-project-overdue", invoiceNumber: "SYN-OVERDUE", status: "ISSUED", needsReview: false, issueDate: date(-30), transactionDate: date(-30), dueDate: date(-1), originalFileName: "合成入金期限超過.pdf", fileUrl: "/api/files/ux-original.pdf" },
    { ...templates.issued, id: "ux-issued-review", projectId: "ux-project-review", invoiceNumber: "SYN-DRAFT", status: "DRAFT", dueDate: "", originalFileName: "合成確認待ち.pdf", fileUrl: undefined },
    { ...templates.issued, id: "ux-issued-future", projectId: "ux-project-future", invoiceNumber: "SYN-FUTURE", status: "ISSUED", needsReview: false, issueDate: today, transactionDate: today, dueDate: date(8), fileUrl: "/api/files/ux-original.pdf" },
    { ...templates.issued, id: "ux-issued-soon", projectId: "ux-project-income-soon", invoiceNumber: "SYN-SOON", status: "ISSUED", needsReview: false, issueDate: today, transactionDate: today, dueDate: date(3), fileUrl: "/api/files/ux-original.pdf" },
  ];
  data.receivedInvoices = [
    { ...templates.received, id: "ux-received-soon", projectId: "ux-project-soon", status: "SCHEDULED", mailProcessed: false, receivedDate: today, issueDate: date(-10), dueDate: date(7), originalFileName: "合成支払期限7日以内.pdf", fileUrl: "/api/files/ux-original.pdf", mimeType: "application/pdf" },
    { ...templates.received, id: "ux-received-review", projectId: "ux-project-review", status: "REVIEWING", mailProcessed: false, total: 0, subtotal: 0, receivedDate: today, issueDate: "", dueDate: "", originalFileName: "合成原本なし.pdf", fileUrl: "/api/files/ux-missing.pdf", mimeType: "application/pdf" },
    { ...templates.received, id: "ux-received-paid", projectId: "ux-project-paid", status: "PAID", receivedDate: today, issueDate: date(-10), dueDate: date(-1), fileUrl: "/api/files/ux-original.pdf" },
    { ...templates.received, id: "ux-received-overdue", projectId: "ux-project-expense-overdue", status: "SCHEDULED", receivedDate: today, issueDate: date(-10), dueDate: date(-1), fileUrl: "/api/files/ux-original.pdf" },
  ];
  data.payments = [
    { id: "ux-income-partial", type: "INCOME", issuedInvoiceId: "ux-issued-overdue", amount: 2000, paymentDate: date(-2), createdById: "admin", createdAt: timestamp, updatedAt: timestamp },
    { id: "ux-expense-paid", type: "EXPENSE", receivedInvoiceId: "ux-received-paid", amount: 8000, paymentDate: date(-2), createdById: "admin", createdAt: timestamp, updatedAt: timestamp },
  ];
  data.mailDocuments = [
    { ...templates.mail, id: "ux-mail-original", title: "合成 原本あり・未処理", senderName: "合成UX支払先", category: "INVOICE", mailProcessed: false, relatedReceivedInvoiceId: "ux-received-soon", fileUrl: "/api/files/ux-original.pdf", originalFileName: "合成原本.pdf" },
    { ...templates.mail, id: "ux-mail-missing", title: "合成 原本・受領請求書参照切れ・未処理", senderName: "合成UX支払先", category: "NOTICE", mailProcessed: false, relatedReceivedInvoiceId: "ux-missing-invoice", fileUrl: "/api/files/ux-missing.pdf", originalFileName: "合成原本なし.pdf" },
  ];
  return data;
}

// Deliberately stale request snapshots for synthetic-only conflict verification. No saved rows are changed.
export function uxRound1FeedbackCases(data: ReturnType<typeof uxRound1Fixture>) {
  const bank = data.bankTransactions.find((row) => row.id === "ux-01-manual")!;
  const received = data.receivedInvoices.find((row) => row.id === "ux-received-soon")!;
  const issued = data.issuedInvoices.find((row) => row.id === "ux-issued-overdue")!;
  const stale = (updatedAt: string) => new Date(Date.parse(updatedAt) - 1000).toISOString();
  return {
    bank: { ...bank, updatedAt: stale(bank.updatedAt), memo: "合成: 競合しても保持するメモ" },
    received: { id: received.id, fields: { expectedUpdatedAt: stale(received.updatedAt), projectId: received.projectId, vendorId: received.vendorId, issueDate: received.issueDate, dueDate: received.dueDate, subtotal: received.subtotal, taxTotal: received.taxTotal, total: received.total, memo: "合成: 競合しても保持する受領メモ" } },
    issued: { ...issued, needsReview: Boolean(issued.needsReview), updatedAt: stale(issued.updatedAt) },
    duplicateInvoiceNumber: issued.invoiceNumber,
    originals: { availableMail: "ux-mail-original", missingMail: "ux-mail-missing", availableReceived: "ux-received-soon", missingReceived: "ux-received-review" },
    uiSteps: ["2つのタブで同じ合成明細を開く。Aでメモを編集して保存プレビューを開き、Bで別のメモを保存。Aの確認して保存で競合表示と下書き保持を確認。", "発行請求書の新規作成で既存番号 SYN-OVERDUE を入力し、重複エラーと入力保持を確認。", "通信失敗はブラウザのOfflineで合成ファイルを取り込み、理由とファイル選択の保持を確認。オンラインへ戻して登録済みの内容を確認後に再試行。"],
  };
}
