import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashSync } from "bcryptjs";
import { fixture, timestamp, admin } from "./document-fixture";
import { mergeBankMasters, mergeBankTransactions, saveBankEdits, saveBankRule, sourceKey } from "../src/lib/banking";
import type { UserRole } from "../src/lib/types";
import { bankFiscalYear, saveBankOverview } from "../src/lib/bank-account-overview";
import { bankToday } from "../src/lib/banking";
import { recordBankCoverage, shiftForecastMonth } from "../src/lib/bank-forecast";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "triangle-banking-preview-"));
  const data = fixture(), office = "0000-0001";
  data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = data.issuedInvoices.filter((row) => data.projects.some((project) => project.id === row.projectId));
  data.users = (["ADMIN", "ACCOUNTING", "BILLING_EDITOR", "MAIL_EDITOR"] as UserRole[]).map((role) => ({ id: role === "ADMIN" ? "admin" : role.toLowerCase(), name: `Local test ${role}`, email: `${role.toLowerCase()}@example.invalid`, role, passwordHash: hashSync("local-banking-test-only", 10), createdAt: timestamp, updatedAt: timestamp }));
  mergeBankMasters(data, "JAPAN", office, [
    { id: "bank", name: "テスト銀行", serviceName: "テスト銀行", isManual: false },
    { id: "bank", subId: "branch", name: "テスト銀行 / 普通預金", serviceName: "テスト銀行", isManual: false },
    { id: "card", name: "テスト法人カード", serviceName: "テスト法人カード", isManual: false },
  ], [
    { id: "sales", name: "売上高", group: "INCOME", available: true },
    { id: "design", parentSourceId: "sales", name: "設計料", group: "INCOME", available: true },
    { id: "travel", name: "旅費交通費", group: "EXPENSE", available: true },
    { id: "supplies", name: "消耗品費", group: "EXPENSE", available: true },
    { id: "utility", name: "水道光熱費", group: "EXPENSE", available: true },
    { id: "fees", name: "支払手数料", group: "EXPENSE", available: true },
  ]);
  saveBankRule(data, admin, "JAPAN", { name: "電車代を交通費へ", keyword: "電車", match: "CONTAINS", side: "EXPENSE", categoryId: sourceKey("JAPAN", office, "category", "travel"), treatment: "NORMAL", priority: 100, enabled: true });
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    const items = Array.from({ length: month === "2026-09" ? 55 : 5 }, (_, i) => ({ id: `${month}-${i}`, date: `${month}-${String(i % 7 + 1).padStart(2, "0")}`, value: (i + 1) * 1250, side: i % 3 ? "EXPENSE" as const : "INCOME" as const, content: i % 3 ? `電車 テスト交通費 ${i}` : `設計料 テスト入金 ${i}`, memo: null, journalizing_status: "none", connected_account_id: i % 3 ? "card" : "bank", connected_sub_account_id: i % 3 ? null : "branch" }));
    mergeBankTransactions(data, "JAPAN", office, items, { start: `${month}-01`, end: `${month}-28` });
  }
  const first = data.bankTransactions[0];
  saveBankEdits(data, admin, "JAPAN", [{ id: first.id, updatedAt: first.updatedAt, categoryId: sourceKey("JAPAN", office, "category", "sales"), subCategoryId: sourceKey("JAPAN", office, "category", "design", "sales"), treatment: "NORMAL", reviewed: true, memo: "保存済みのテスト明細" }]);
  data.bankTransactions[1].treatment = "TRANSFER";
  data.bankTransactions[2].sourceMissing = true;
  const example = data.bankTransactions.find((row) => row.side === "EXPENSE")!;
  data.bankTransactions.push(
    { ...example, id: "auto-preview", sourceId: "auto-preview", transactionDate: "2026-10-08", content: "東京電力 電気料金", amount: 12500, categoryId: undefined, ruleId: undefined, classificationReason: undefined, classificationSource: "UNASSIGNED", treatment: "NORMAL", reviewed: false, memo: "" },
    { ...example, id: "unknown-preview", sourceId: "unknown-preview", transactionDate: "2026-10-08", content: "AMAZON テスト購入", amount: 3300, categoryId: undefined, ruleId: undefined, classificationReason: undefined, classificationSource: "UNASSIGNED", treatment: "NORMAL", reviewed: false, memo: "" },
  );
  if (process.argv.includes("--classification-pages")) {
    const candidate = data.bankTransactions.find((row) => row.id === "auto-preview")!;
    data.bankTransactions.push(...Array.from({ length: 151 }, (_, index) => ({ ...candidate, id: `candidate-${String(index).padStart(3, "0")}`, sourceId: `candidate-${index}`, content: `東京電力 テスト候補 ${String(index).padStart(3, "0")}` })));
  }
  if (process.argv.includes("--classification-labels")) {
    const base = data.bankTransactions.find((row) => row.id === "unknown-preview")!;
    const old = { ...base, id: "label-history-old", sourceId: "label-history-old", transactionDate: "2026-09-01", content: "テスト文具 継続購入", categoryId: sourceKey("JAPAN", office, "category", "supplies"), classificationSource: "MANUAL" as const, reviewed: true };
    data.bankTransactions.push(old,
      { ...base, id: "label-history-new", sourceId: "label-history-new", transactionDate: "2026-10-26", content: old.content },
      { ...old, id: "label-confirmed", sourceId: "label-confirmed", transactionDate: "2026-10-26", content: "確認済み テスト文具" },
      { ...base, id: "label-guess", sourceId: "label-guess", transactionDate: "2026-10-26", content: "用途不明 テスト購入" },
      { ...base, id: "label-inferred", sourceId: "label-inferred", transactionDate: "2026-10-26", content: "為替手数料 テスト" },
    );
  }
  if (process.argv.includes("--classification-ai")) {
    const candidate = data.bankTransactions.find((row) => row.id === "auto-preview")!;
    data.bankTransactions.push(...Array.from({ length: 54 }, (_, index) => ({ ...candidate, id: `ai-test-${String(index).padStart(3, "0")}`, sourceId: `ai-test-${index}`, transactionDate: "2026-10-09", content: `${["JRW SHINKANSEN", "エスライド", "テストコンビニ"][index % 3]} テスト ${String(index).padStart(3, "0")}` })));
  }
  if (process.argv.includes("--reconciliation")) {
    const account = data.bankAccounts.find((row) => row.sourceSubId === "branch")!;
    account.serviceName = "三菱UFJ銀行";
    account.name = "テスト 三菱UFJ銀行 / 普通預金";
    account.forecastSettings = { accountKind: "BANK", balanceMonth: "2026-10", minimumBalance: 0, incomePercent: 0, expensePercent: 0 };
    data.clients[0].companyName = "株式会社テストデザイン";
    data.vendors[0].companyName = "株式会社テスト制作";
    data.vendors[0].accountHolder = "カ）テストセイサク";
    data.projects[0].name = "青山ショールーム / 設計";
    data.issuedInvoices.forEach((row) => { row.status = "ISSUED"; row.needsReview = false; row.issueDate = "2026-09-01"; row.dueDate = "2026-09-30"; });
    data.issuedInvoices[0].total = 330000;
    data.issuedInvoices[1].total = 330000;
    data.receivedInvoices[0].status = "SCHEDULED";
    data.receivedInvoices[0].mailProcessed = false;
    data.mailDocuments[0].mailProcessed = false;
    data.receivedInvoices[0].total = 88000;
    data.receivedInvoices[0].issueDate = "2026-09-01";
    data.receivedInvoices[0].dueDate = "2026-09-30";
    data.receivedInvoices[0].originalFileName = "模型制作費.pdf";
    data.bankTransactions = [
      { id: "match-income", side: "INCOME" as const, amount: 330000, content: "テストデザイン INV-001" },
      { id: "match-expense", side: "EXPENSE" as const, amount: 87670, content: "振込 カ)テストセイサク" },
      { id: "match-unknown", side: "INCOME" as const, amount: 12000, content: "振込 タナカ" },
    ].map((row) => ({ ...example, ...row, bankAccountId: account.id, officeCode: account.officeCode, sourceId: row.id, transactionDate: "2026-09-30", sourceMissing: false, treatment: "NORMAL", reviewed: false, categoryId: undefined }));
  }
  if (process.argv.includes("--accounts")) {
    const today = bankToday(), month = today.slice(0, 7);
    const bank = data.bankAccounts.find((row) => row.sourceSubId === "branch")!;
    bank.name = "三菱UFJ銀行 / 六本木支店 普通 1238379（テスト）";
    bank.serviceName = "三菱UFJ銀行";
    const extra = [
      { id: "paypay", subId: "business", name: "PayPay銀行 / ビジネス営業部 普通 1237691（テスト）", serviceName: "PayPay銀行", isManual: false },
      { id: "mizuho", subId: "business", name: "みずほ銀行 / 青山支店 普通 1234567（テスト）", serviceName: "みずほ銀行", isManual: false },
    ];
    mergeBankMasters(data, "JAPAN", office, [...data.bankAccounts.map((row) => ({ id: row.sourceId, subId: row.sourceSubId, name: row.name, serviceName: row.serviceName, isManual: row.isManual })), ...extra], []);
    saveBankOverview(data, admin, "JAPAN", bank.id, bank.updatedAt, { kind: "BANK", balance: { amount: 3284500, asOf: `${month}-01`, currency: "JPY" } }, today);
    const paypay = data.bankAccounts.find((row) => row.sourceId === "paypay")!;
    saveBankOverview(data, admin, "JAPAN", paypay.id, paypay.updatedAt, { kind: "BANK", balance: { amount: 865200, asOf: `${month}-01`, currency: "JPY" } }, today);
    mergeBankTransactions(data, "JAPAN", office, [
      { id: "overview-income", connected_account_id: "bank", connected_sub_account_id: "branch", date: `${month}-02`, value: 1650000, side: "INCOME", content: "テストデザイン 設計料", journalizing_status: "none" },
      { id: "overview-expense", connected_account_id: "bank", connected_sub_account_id: "branch", date: `${month}-03`, value: 540000, side: "EXPENSE", content: "テスト制作 外注費", journalizing_status: "none" },
      { id: "overview-paypay", connected_account_id: "paypay", connected_sub_account_id: "business", date: `${month}-03`, value: 220000, side: "INCOME", content: "テスト商事 入金", journalizing_status: "none" },
    ], { start: `${month}-01`, end: `${month}-03` });
    data.bankSyncStates.push({ id: "overview-sync", company: "JAPAN", officeCode: office, officeName: "テスト会社", autoSync: false, status: "SUCCESS", imported: 3, updated: 0, createdAt: timestamp, updatedAt: timestamp, lastSuccessAt: new Date().toISOString() });
    recordBankCoverage(data.bankSyncStates[0], `${month}-01`, today, data.bankAccounts.map((row) => row.id));
    const previousStart = `${bankFiscalYear(today) - 2}-09`;
    const sample = data.bankTransactions.find((row) => row.bankAccountId === bank.id)!;
    for (let index = 0; index < 12; index++) {
      const fiscalMonth = shiftForecastMonth(previousStart, index);
      data.bankTransactions.push(...Array.from({ length: 8 }, (_, day) => ({ ...sample, id: `fiscal-${fiscalMonth}-${day}`, sourceId: `fiscal-${fiscalMonth}-${day}`, transactionDate: `${fiscalMonth}-${String(day + 1).padStart(2, "0")}`, sourceMissing: false, amount: 15000 * (day + 1), side: day % 2 ? "EXPENSE" as const : "INCOME" as const, content: `年度スクロール確認 テスト明細 ${fiscalMonth} ${day + 1}` })));
    }
  }
  await writeFile(path.join(root, "app-data.json"), JSON.stringify(data, null, 2));
  console.log(root);
}
void main();
