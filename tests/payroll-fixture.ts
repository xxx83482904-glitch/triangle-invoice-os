import { fixture, timestamp } from "./document-fixture";
import type { BankTransaction } from "../src/lib/banking-types";

export function payrollFixture() {
  const data = fixture(); data.appEdition = "JAPAN";
  data.projects = data.projects.filter((row) => row.company === "JAPAN");
  data.issuedInvoices = []; data.receivedInvoices = []; data.mailDocuments = []; data.attachments = [];
  data.bankAccounts = [{ id: "payroll-bank", company: "JAPAN", officeCode: "synthetic", sourceId: "bank", name: "合成給与口座", serviceName: "合成銀行", isManual: false, available: true, createdAt: timestamp, updatedAt: timestamp }];
  data.accountingCategories = [
    ["salary", "給与手当"], ["wage", "給料"], ["bonus", "賞与"], ["officer", "役員報酬"], ["retirement", "退職金"], ["commute", "通勤手当"],
    ["fee", "支払報酬"], ["withholding", "源泉所得税"], ["resident", "住民税"], ["insurance", "社会保険料"], ["welfare", "法定福利費"],
  ].map(([id, name]) => ({ id, name, company: "JAPAN", group: "EXPENSE", officeCode: "synthetic", sourceId: id, available: true, createdAt: timestamp, updatedAt: timestamp }));
  const row = (id: string, categoryId: string, amount: number, transactionDate: string, content: string): BankTransaction => ({ id, company: "JAPAN", officeCode: "synthetic", sourceId: id, bankAccountId: "payroll-bank", transactionDate, amount, side: "EXPENSE", content, categoryId, sourceMemo: "", sourceStatus: "none", sourceMissing: false, treatment: "NORMAL", classificationSource: "MANUAL", reviewed: true, memo: "合成データ", createdAt: timestamp, updatedAt: timestamp });
  data.bankTransactions = [
    row("salary-sep", "salary", 240000, "2025-09-25", "振込 合成アオイ 9月分"), row("salary-oct", "salary", 250000, "2025-10-25", "振込 合成アオイ 10月分"),
    row("officer-aug", "officer", 400000, "2026-08-25", "振込 合成ミドリ"), row("bonus", "bonus", 50000, "2025-12-25", "振込 合成アオイ"),
    row("retirement", "retirement", 60000, "2026-03-25", "振込 合成シロ"), row("commute", "commute", 10000, "2025-10-25", "振込 合成アオイ"), row("wage", "wage", 180000, "2026-04-25", "振込 合成アカネ"),
    row("external-fee", "fee", 55000, "2026-07-25", "振込 合成税理士事務所"), row("withholding", "withholding", 30000, "2026-07-10", "振込 合成税務署"), row("resident", "resident", 20000, "2026-07-10", "振込 合成区役所"),
    row("insurance", "insurance", 80000, "2026-07-31", "振込 合成年金事務所"), row("welfare", "welfare", 12000, "2026-07-31", "振込 合成福利先"),
    row("previous", "salary", 200000, "2024-10-25", "振込 合成アオイ"), row("older", "salary", 190000, "2023-10-25", "振込 合成アオイ"),
    row("recent-external", "fee", 60000, "2026-10-25", "振込 合成社労士事務所"),
    { ...row("split", "fee", 120000, "2026-06-25", "振込 合成ムラサキ"), bookkeeping: { splits: [{ id: "s1", categoryId: "salary", amount: 100000, memo: "合成給与" }, { id: "s2", categoryId: "fee", amount: 20000, memo: "合成外部報酬" }] } },
  ];
  return data;
}
